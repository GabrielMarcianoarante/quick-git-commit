(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const Graph = window.QGCGraph;

  // Configurações vindas da extensão (idioma, prefixos, limite, ação padrão).
  let CFG = (() => {
    try { return JSON.parse(decodeURIComponent(document.body.dataset.cfg || '')); } catch { return {}; }
  })();
  let MAXLEN = typeof CFG.maxLen === 'number' ? CFG.maxLen : 72;
  // Inglês: traduz o painel; textos do usuário (commits, arquivos, branches) ficam como estão.
  if (window.QGCI18N) window.QGCI18N.start(CFG.lang, '.subject,.fileName,.cmsg,.repoName,.cfile,.refs,.ref,.rtag,#branchSelect option,#baseSelect option,.chipTxt');
  const announce = (t) => { const a = $('announcer'); if (a) a.textContent = t || ''; };

  // ---------- Ícones (SVG inline, sem dependências) ----------
  const ICONS = {
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    download: '<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>',
    upload: '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    commit: '<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>',
    undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    history: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  };

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  // ---------- Helpers de DOM (sempre textContent: nada de innerHTML com dados do usuário) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM é permitido pela CSP; setAttribute('style') não é
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid);
    }
    return el;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }

  function btn(label, o = {}) {
    return h(
      'button',
      {
        type: 'button',
        class: 'btn ' + (o.kind || 'secondary') + (o.grow ? ' grow' : '') + (o.small ? ' small' : '') + (o.mono ? ' mono' : ''),
        title: o.title,
        disabled: !!o.disabled,
        onclick: o.onclick,
      },
      o.icon ? icon(o.icon) : null,
      label ? h('span', { text: label }) : null
    );
  }

  const plural = (n, one, many) => (n === 1 ? one : many);
  const basenameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const dirOf = (p) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));

  // ---------- Modo Simples / Avançado ----------
  // Simples: nomes amigáveis, com o comando real só como dica.
  // Avançado: o comando Git real em destaque, com o nome amigável como dica.
  const LABELS = {
    simple: {
      secSync: 'Sincronizar com a nuvem',
      secChanges: 'Minhas alterações',
      secUpdate: 'Atualizar minha branch',
      secHistory: 'Histórico',
      fetch: 'Buscar',
      pull: 'Trazer',
      push: 'Enviar',
      fetchTip: 'Só confere se há novidades. Não mexe nos seus arquivos. (git fetch)',
      pullTip: 'Baixa as novidades da nuvem para o seu computador. (git pull)',
      pushTip: 'Envia os seus commits para a nuvem. (git push)',
      commit: 'Salvar commit',
      commitPush: 'Salvar e enviar',
      rebase: 'Atualizar com Rebase',
      merge: 'Atualizar com Merge',
      undo: 'Desfazer último commit',
      undoTip: 'Desfaz o commit mais recente, mantendo as suas alterações. (git reset --soft HEAD~1)',
      publish: 'Publicar na nuvem',
      connect: 'Conectar à nuvem',
      markAll: 'Marcar tudo',
      baseLabel: 'Trazer novidades de:',
      kinds: { modified: 'Alterado', added: 'Novo', untracked: 'Novo', deleted: 'Excluído', renamed: 'Renomeado', typechange: 'Tipo mudou' },
      statusLetters: { M: 'Alterado', A: 'Novo', D: 'Excluído', R: 'Renomeado', C: 'Copiado', T: 'Tipo mudou' },
    },
    advanced: {
      secSync: 'fetch · pull · push',
      secChanges: 'Working tree e index',
      secUpdate: 'rebase · merge',
      secHistory: 'git log --graph',
      fetch: 'fetch',
      pull: 'pull',
      push: 'push',
      fetchTip: 'git fetch: só confere se há novidades, sem alterar seus arquivos.',
      pullTip: 'git pull: baixa e integra as novidades da nuvem.',
      pushTip: 'git push: manda os seus commits para a nuvem.',
      commit: 'git commit',
      commitPush: 'commit + push',
      rebase: 'git rebase',
      merge: 'git merge',
      undo: 'git reset --soft HEAD~1',
      undoTip: 'Desfazer último commit, mantendo as alterações no index.',
      publish: 'git push -u origin',
      connect: 'git remote add origin',
      markAll: 'git add -A',
      baseLabel: 'Base (rebase/merge):',
      kinds: { modified: 'M', added: 'A', untracked: '??', deleted: 'D', renamed: 'R', typechange: 'T' },
      statusLetters: { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', T: 'T' },
    },
  };

  // ---------- Estado da interface ----------
  const saved = vscode.getState() || {};
  const ui = {
    type: saved.type || 'feat',
    message: saved.message || '',
    details: saved.details || '',
    base: saved.base || '',
    open: saved.open || {},
    mode: saved.mode === 'advanced' ? 'advanced' : 'simple',
    expanded: saved.expanded || '',
    guide: false,
    settings: saved.settings === true,
  };
  let state = null;
  const detailsCache = Object.create(null);
  const save = () => {
    const { guide, ...persist } = ui;
    vscode.setState(persist);
  };
  const post = (name, payload) => vscode.postMessage({ type: 'action', name, payload: payload || {} });
  const T = () => LABELS[ui.mode];
  const advanced = () => ui.mode === 'advanced';

  const DEFAULT_TYPES = [
    { id: 'feat', label: 'Novidade', hint: 'Uma funcionalidade nova' },
    { id: 'fix', label: 'Correção', hint: 'Conserto de um erro' },
    { id: 'docs', label: 'Documentação', hint: 'Textos e explicações' },
    { id: 'style', label: 'Estilo', hint: 'Formatação, sem mudar o comportamento' },
    { id: 'refactor', label: 'Reorganização', hint: 'Melhorar o código sem mudar o resultado' },
    { id: 'chore', label: 'Manutenção', hint: 'Tarefas de rotina e configurações' },
  ];
  // Prefixos configuráveis: os conhecidos mantêm rótulo e dica; os personalizados usam o próprio nome.
  const TYPES = (CFG.types && CFG.types.length ? CFG.types : DEFAULT_TYPES).map(
    (c) => DEFAULT_TYPES.find((d) => d.id === c.id) || { id: c.id, label: c.id, hint: c.description || '' }
  );

  // ---------- Inicialização (partes estáticas) ----------
  function initStatic() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));
    $('btnRefresh').append(icon('refresh'));
    $('btnGuide').append(icon('help'));
    $('btnSettings').append(icon('settings'));
    $('btnSettings').addEventListener('click', () => {
      ui.settings = !ui.settings;
      save();
      render();
    });
    $('btnNewBranch').append(icon('plus'));
    $('btnRefresh').addEventListener('click', () => post('refresh'));
    $('btnGuide').addEventListener('click', () => {
      ui.guide = !ui.guide;
      render();
    });
    $('btnNewBranch').addEventListener('click', () => post('newBranch'));

    document.querySelectorAll('.segBtn').forEach((b) =>
      b.addEventListener('click', () => {
        ui.mode = b.dataset.mode === 'advanced' ? 'advanced' : 'simple';
        save();
        render();
      })
    );

    $('branchSelect').addEventListener('change', (e) => {
      const v = e.target.value;
      if (state && v && v !== state.branch) post('checkout', { branch: v });
    });

    // Seções recolhíveis lembram se estavam abertas.
    document.querySelectorAll('details.section').forEach((d) => {
      const key = d.dataset.key;
      if (key in ui.open) d.open = !!ui.open[key];
      d.addEventListener('toggle', () => {
        ui.open[key] = d.open;
        save();
      });
    });

    // Tipos de commit como "pílulas".
    if (!TYPES.some((t) => t.id === ui.type)) ui.type = TYPES[0].id;
    const pills = $('typePills');
    pills.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      const els = [...pills.querySelectorAll('.pill')];
      const i = els.findIndex((p) => p.dataset.id === ui.type);
      const n = els[(i + k + els.length) % els.length];
      n.click();
      n.focus();
    });
    for (const t of TYPES) {
      pills.append(
        h(
          'button',
          {
            type: 'button',
            class: 'pill',
            role: 'radio',
            'data-id': t.id,
            title: t.hint,
            onclick: () => {
              ui.type = t.id;
              save();
              renderPills();
              if (state && state.isRepo) renderCommit();
            },
          },
          h('span', { class: 'pillLabel', text: t.label }),
          h('span', { class: 'pillCode', text: t.id })
        )
      );
    }
    renderPills();

    $('msgInput').value = ui.message;
    $('detailsInput').value = ui.details;
    $('msgInput').addEventListener('input', (e) => {
      ui.message = e.target.value;
      save();
      renderCommit();
    });
    $('msgInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      // Enter = ação padrão; Ctrl/Cmd+Enter = commit e enviar; Shift+Enter = só commit.
      const push = e.shiftKey ? false : e.ctrlKey || e.metaKey ? true : CFG.defaultAction === 'commitAndPush';
      if (!$(push ? 'btnCommitPush' : 'btnCommit').disabled) sendCommit(push);
    });
    $('detailsInput').addEventListener('input', (e) => {
      ui.details = e.target.value;
      save();
    });

    applyDefaultAction();
    $('btnCommit').addEventListener('click', () => sendCommit(false));
    $('btnCommitPush').addEventListener('click', () => sendCommit(true));

    $('baseSelect').addEventListener('change', (e) => {
      ui.base = e.target.value;
      save();
      renderUpdate();
    });
  }

  function renderPills() {
    document.querySelectorAll('#typePills .pill').forEach((p) => {
      const on = p.dataset.id === ui.type;
      p.classList.toggle('active', on);
      p.classList.toggle('codeOnly', advanced());
      p.setAttribute('aria-checked', on ? 'true' : 'false');
      p.tabIndex = on ? 0 : -1;
    });
  }

  function sendCommit(push) {
    post('commit', { type: ui.type, message: ui.message, details: ui.details, push });
  }

  // ---------- Renderização ----------
  function applyDefaultAction() {
    const push = CFG.defaultAction === 'commitAndPush';
    $('btnCommit').classList.toggle('primary', !push);
    $('btnCommit').classList.toggle('secondary', push);
    $('btnCommitPush').classList.toggle('primary', push);
    $('btnCommitPush').classList.toggle('secondary', !push);
  }

  // ---------- Aba de configurações (dentro do painel) ----------
  function renderSettings() {
    const set = (key, value) => post('setSetting', { key, value });
    const focusId = document.activeElement && document.activeElement.id;

    const seg = (label, value, opts, key) =>
      h('div', { class: 'seg setSeg', role: 'radiogroup', 'aria-label': label },
        opts.map(([v, t]) =>
          h('button', { type: 'button', role: 'radio', class: 'segBtn' + (v === value ? ' active' : ''), 'aria-checked': v === value ? 'true' : 'false', text: t, onclick: () => set(key, v) })
        ));

    // Prefixos como "chips": remover com ×, adicionar digitando e apertando Enter.
    const ids = (CFG.types || []).map((t) => t.id);
    const newType = h('input', { id: 'setNewType', type: 'text', placeholder: 'novo prefixo', 'aria-label': 'novo prefixo', autocomplete: 'off', spellcheck: 'false' });
    const addType = () => {
      const extra = newType.value.split(/[,\s]+/).filter(Boolean);
      if (!extra.length) return;
      set('commitTypes', ids.concat(extra).join(','));
      newType.value = '';
    };
    newType.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addType(); } });
    const chips = h('div', { class: 'chips' },
      ids.map((id) =>
        h('span', { class: 'chip' },
          h('span', { class: 'chipTxt', text: id }),
          ids.length > 1
            ? h('button', { type: 'button', class: 'chipX', title: 'Remover prefixo ' + id, 'aria-label': 'Remover prefixo ' + id, onclick: () => set('commitTypes', ids.filter((x) => x !== id).join(',')) }, icon('x'))
            : null)));

    const max = h('input', { id: 'setMax', class: 'numInput', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: String(MAXLEN), 'aria-label': 'Limite da mensagem' });
    max.addEventListener('change', () => set('messageMaxLength', max.value.trim()));

    const askOn = CFG.askBranch !== false;
    const ask = h('button', { id: 'setAsk', class: 'switch' + (askOn ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': askOn ? 'true' : 'false', 'aria-label': 'Perguntar pela branch' }, h('span', { class: 'knob' }));
    ask.addEventListener('click', () => {
      const v = ask.getAttribute('aria-checked') !== 'true';
      ask.setAttribute('aria-checked', String(v));
      ask.classList.toggle('on', v);
      set('askBranch', v);
    });

    const row = (label, hint, control, o) => {
      o = o || {};
      return h('div', { class: 'setRow' + (o.stack ? ' stack' : '') },
        h('div', { class: 'setText' }, h(o.id ? 'label' : 'div', { class: 'setLabel', for: o.id, text: label }), hint ? h('div', { class: 'hint', text: hint }) : null),
        control);
    };
    const group = (title, ...rows) => h('section', { class: 'setGroup' }, h('h3', { class: 'setHead', text: title }), ...rows);

    $('settings').replaceChildren(
      h('div', { class: 'setTop' },
        h('button', { class: 'iconBtn', type: 'button', title: 'Voltar', 'aria-label': 'Voltar', onclick: () => { ui.settings = false; save(); render(); } }, icon('back')),
        h('h2', { id: 'setTitle', class: 'setTitle', text: 'Configurações' })),
      group('Geral',
        row('Idioma', null, seg('Idioma', CFG.language || 'auto', [['auto', 'Automático'], ['pt-BR', 'Português'], ['en', 'English']], 'language'), { stack: true })),
      group('Commit',
        row('Prefixos', 'Toque em × para remover. Digite um novo e aperte Enter.',
          h('div', { class: 'setStack' }, chips, h('div', { class: 'addRow' }, newType, h('button', { class: 'btn secondary', type: 'button', text: 'Adicionar', onclick: addType }))),
          { stack: true }),
        row('Limite da mensagem', '0 = sem limite', h('div', { class: 'numRow' }, max, h('span', { class: 'hint', text: 'caracteres' })), { id: 'setMax' }),
        row('Ação padrão ao commitar', 'Perguntar: o commit rápido pergunta, e o Enter no painel faz só o commit.',
          seg('Ação padrão ao commitar', CFG.defaultAction || 'ask', [['ask', 'Perguntar'], ['commit', 'Só commit'], ['commitAndPush', 'Commit e enviar']], 'defaultAction'),
          { stack: true })),
      group('Commit rápido',
        row('Perguntar pela branch', 'Antes do commit rápido, escolher manter, trocar ou criar uma branch.', ask, { id: 'setAsk' })),
      h('div', { class: 'setFoot' },
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary grow', type: 'button', text: 'Restaurar padrões', onclick: () => post('resetSettings') }),
          h('button', { class: 'btn secondary grow', type: 'button', text: 'Mais opções no VS Code', onclick: () => post('openVsSettings') })),
        h('p', { class: 'hint', text: 'As alterações são salvas automaticamente.' }))
    );
    if (focusId && $(focusId)) $(focusId).focus();
  }

  function applySettingsView() {
    const on = ui.settings;
    $('btnSettings').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('settings').classList.toggle('hidden', !on);
    if (on) {
      ['top', 'onboard', 'notRepo', 'main', 'banner'].forEach((id) => $(id).classList.add('hidden'));
      renderSettings();
    } else {
      $('banner').classList.remove('hidden');
    }
  }

  function render() {
    if (state) renderMain();
    if (!state || !state.isRepo) $('repoName').textContent = 'Quick Git';
    applySettingsView();
  }

  function renderMain() {
    if (!state) return;
    const ok = state.isRepo;
    const ob = state.onboarding;
    const showGuide = !!ob && (!ob.done || ui.guide);

    document.querySelectorAll('.segBtn').forEach((b) => {
      const on = b.dataset.mode === ui.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    document.body.classList.toggle('advanced', advanced());

    $('onboard').classList.toggle('hidden', !showGuide);
    if (showGuide) renderOnboarding(ob);

    $('main').classList.toggle('hidden', !ok);
    $('top').classList.toggle('hidden', !ok);
    $('notRepo').classList.toggle('hidden', ok || showGuide);
    if (!ok) {
      if (!showGuide) renderNotRepo();
      $('banner').replaceChildren();
      return;
    }
    renderPills();
    renderLabels();
    renderHeader();
    renderBanner();
    renderSync();
    renderFiles();
    renderCommit();
    renderUpdate();
    renderHistory();
  }

  function renderLabels() {
    const t = T();
    const setTitle = (id, text) => {
      const span = $(id).querySelector('.sTitle');
      for (const n of Array.from(span.childNodes)) if (n.nodeType === 3) n.remove();
      span.append(document.createTextNode(text));
    };
    setTitle('secSync', t.secSync);
    setTitle('secChanges', t.secChanges);
    setTitle('secUpdate', t.secUpdate);
    setTitle('secHistory', t.secHistory);
    $('baseLabel').textContent = t.baseLabel;

    const c = $('btnCommit');
    const cp = $('btnCommitPush');
    c.replaceChildren(icon('check'), h('span', { text: t.commit }));
    cp.replaceChildren(icon('upload'), h('span', { text: t.commitPush }));
    c.classList.toggle('mono', advanced());
    cp.classList.toggle('mono', advanced());

    $('modeHint').textContent = advanced()
      ? 'Modo Avançado: os botões mostram o comando Git real.'
      : 'Modo Simples: nomes fáceis, com o comando real na dica do botão.';
  }

  function renderNotRepo() {
    const box = $('notRepo');
    box.replaceChildren();
    if (state.error) {
      box.append(
        h('div', { class: 'cardTitle' }, icon('alert'), h('span', { text: 'Algo deu errado' })),
        h('p', { text: state.error }),
        btn('Tentar de novo', { icon: 'refresh', kind: 'primary', onclick: () => post('refresh') })
      );
    } else if (!state.hasFolder) {
      box.append(
        h('div', { class: 'cardTitle' }, icon('folder'), h('span', { text: 'Nenhuma pasta aberta' })),
        h('p', { text: 'Abra a pasta do seu projeto para usar o painel: menu Arquivo > Abrir Pasta.' })
      );
    } else {
      box.append(
        h('div', { class: 'cardTitle' }, icon('branch'), h('span', { text: 'Esta pasta ainda não usa Git' })),
        h('p', { text: 'Git guarda o histórico do seu projeto e permite voltar atrás se algo der errado. Você pode começar agora, é só um clique.' }),
        btn(advanced() ? 'git init' : 'Começar a usar Git', { icon: 'check', kind: 'primary', mono: advanced(), onclick: () => post('init') })
      );
    }
  }

  // ---------- Guia inicial ----------
  function renderOnboarding(ob) {
    const box = $('onboard');
    box.replaceChildren();

    const steps = [
      {
        icon: 'terminal',
        title: 'Git instalado',
        done: !!ob.gitVersion,
        text: ob.gitVersion ? 'Versão ' + ob.gitVersion + ' encontrada.' : 'Não encontrei o Git neste computador. Instale e reinicie o VS Code.',
        action: ob.gitVersion ? null : btn('Baixar o Git', { icon: 'download', small: true, kind: 'primary', onclick: () => post('ob.openGit') }),
      },
      {
        icon: 'user',
        title: 'Seu nome e e-mail',
        done: !!(ob.userName && ob.userEmail),
        text: ob.userName && ob.userEmail ? ob.userName + ' <' + ob.userEmail + '>' : 'O Git precisa saber quem é você para assinar os seus commits.',
        action: btn(ob.userName && ob.userEmail ? 'Alterar' : 'Configurar', { icon: 'user', small: true, kind: ob.userName && ob.userEmail ? 'secondary' : 'primary', disabled: !ob.gitVersion, onclick: () => post('ob.identity') }),
      },
      {
        icon: 'folder',
        title: 'Repositório nesta pasta',
        done: ob.isRepo,
        text: ob.isRepo ? 'Esta pasta já usa Git.' : ob.hasFolder ? 'Esta pasta ainda não usa Git. Crie o repositório para começar a guardar o histórico.' : 'Abra a pasta do seu projeto para continuar.',
        action: ob.isRepo ? null : ob.hasFolder ? btn(advanced() ? 'git init' : 'Criar repositório', { icon: 'check', small: true, kind: 'primary', mono: advanced(), disabled: !ob.gitVersion, onclick: () => post('init') }) : btn('Abrir pasta', { icon: 'folder', small: true, kind: 'primary', onclick: () => post('ob.openFolder') }),
      },
      {
        icon: 'github',
        title: 'Conta do GitHub',
        done: ob.github.signedIn,
        optional: true,
        text: ob.github.signedIn ? 'Conectado como ' + ob.github.login + '.' : 'Opcional. Entre para enviar o seu projeto ao GitHub sem digitar senha.',
        action: ob.github.signedIn ? null : btn('Entrar com GitHub', { icon: 'github', small: true, kind: 'primary', onclick: () => post('ob.github') }),
      },
      {
        icon: 'cloud',
        title: 'Repositório online',
        done: ob.hasRemote,
        optional: true,
        text: ob.hasRemote ? 'Este projeto já está ligado a um repositório online.' : 'Opcional. Crie um repositório no GitHub agora ou cole o endereço de um que você já tenha.',
        action: ob.hasRemote
          ? null
          : h(
              'span',
              { class: 'stepBtns' },
              btn('Criar no GitHub', { icon: 'github', small: true, kind: 'primary', disabled: !ob.isRepo, title: ob.isRepo ? undefined : 'Crie o repositório local antes.', onclick: () => post('ob.createRepo') }),
              btn('Colar URL', { icon: 'cloud', small: true, disabled: !ob.isRepo, onclick: () => post('addRemote') })
            ),
      },
    ];

    const required = steps.filter((s) => !s.optional);
    const requiredDone = required.every((s) => s.done);
    const doneCount = steps.filter((s) => s.done).length;

    const list = h('ol', { class: 'steps' });
    steps.forEach((s, i) => {
      list.append(
        h(
          'li',
          { class: 'step' + (s.done ? ' done' : '') },
          h('span', { class: 'stepMark', 'aria-hidden': 'true' }, s.done ? icon('check') : h('span', { text: String(i + 1) })),
          h(
            'div',
            { class: 'stepBody' },
            h('div', { class: 'stepTitle' }, icon(s.icon), h('span', { text: s.title }), s.optional ? h('span', { class: 'tag soft', text: 'opcional' }) : null),
            h('p', { class: 'hint', text: s.text }),
            s.action
          )
        )
      );
    });

    const finish = ob.done
      ? btn('Fechar guia', { icon: 'x', small: true, onclick: () => { ui.guide = false; render(); } })
      : btn(requiredDone ? 'Concluir' : 'Pular por enquanto', { icon: 'check', kind: requiredDone ? 'primary' : 'secondary', small: true, onclick: () => { ui.guide = false; post('ob.finish'); } });

    box.append(
      h(
        'div',
        { class: 'card guide' },
        h('div', { class: 'cardTitle' }, icon('help'), h('span', { text: ob.done ? 'Guia inicial' : 'Bem-vindo ao Quick Git' })),
        h('p', { text: ob.done ? 'Confira ou refaça a configuração quando quiser.' : 'Vamos deixar tudo pronto em poucos passos. Você pode pular e voltar depois no ícone de ajuda.' }),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(doneCount) }, h('div', { class: 'bar', style: 'width:' + Math.round((doneCount / steps.length) * 100) + '%' })),
        h('div', { class: 'muted', text: doneCount + ' de ' + steps.length + ' passos' }),
        list,
        h('div', { class: 'row' }, finish)
      )
    );
  }

  function renderHeader() {
    $('repoName').textContent = state.repoName;
    const sel = $('branchSelect');
    sel.replaceChildren();
    if (state.detached) {
      sel.append(h('option', { value: '', text: '(sem branch)', selected: true }));
    }
    for (const b of state.branches.local) {
      sel.append(h('option', { value: b, text: b }));
    }
    sel.value = state.detached ? '' : state.branch;
    sel.disabled = state.operation !== 'none';
    $('btnNewBranch').disabled = state.operation !== 'none';
    $('btnNewBranch').title = advanced() ? 'git checkout -b' : 'Criar nova branch';
  }

  function renderBanner() {
    const b = $('banner');
    b.replaceChildren();
    const op = state.operation;
    const hasConflicts = state.conflicts.length > 0;
    if (op === 'none' && !hasConflicts) return;

    const titles = {
      rebase: advanced() ? 'rebase em andamento' : 'Atualização (rebase) pausada',
      merge: advanced() ? 'merge em andamento' : 'Atualização (merge) pausada',
      none: 'Arquivos em conflito',
    };
    const card = h('div', { class: 'card warn' }, h('div', { class: 'cardTitle' }, icon('alert'), h('span', { text: titles[op] })));
    if (hasConflicts) {
      card.append(
        h('p', {
          text: 'Estes arquivos foram mudados por você e por outra pessoa ao mesmo tempo. Abra cada um, escolha o que deve ficar e clique em "Resolvido".',
        })
      );
      const list = h('div', { class: 'conflicts' });
      for (const f of state.conflicts) {
        list.append(
          h(
            'div',
            { class: 'conflict' },
            h('span', { class: 'fileName', title: f }, h('span', { class: 'base', text: basenameOf(f) }), h('span', { class: 'dir', text: dirOf(f) })),
            btn('Abrir', { icon: 'open', small: true, onclick: () => post('openFile', { path: f }) }),
            btn('Resolvido', { icon: 'check', small: true, kind: 'primary', title: advanced() ? 'git add <arquivo>' : undefined, onclick: () => post('resolve', { path: f }) })
          )
        );
      }
      card.append(list);
    } else {
      card.append(h('p', { text: 'Todos os conflitos foram resolvidos. Clique em "Continuar" para terminar.' }));
    }
    if (op !== 'none') {
      const cont = op === 'rebase' ? 'git rebase --continue' : 'git commit';
      const abort = op === 'rebase' ? 'git rebase --abort' : 'git merge --abort';
      card.append(
        h(
          'div',
          { class: 'row' },
          btn(advanced() ? cont : 'Continuar', { icon: 'check', kind: 'primary', grow: true, mono: advanced(), disabled: hasConflicts, onclick: () => post('continueOp') }),
          btn(advanced() ? abort : 'Cancelar tudo', { icon: 'x', grow: true, mono: advanced(), onclick: () => post('abortOp') })
        )
      );
    }
    b.append(card);
  }

  function renderSync() {
    const t = T();
    const body = $('syncBody');
    const badge = $('syncBadge');
    body.replaceChildren();
    badge.replaceChildren();
    const s = state;

    if (s.upstream) {
      if (s.ahead) badge.append(h('span', { class: 'pill-count up', title: s.ahead + ' para enviar', text: '↑' + s.ahead }));
      if (s.behind) badge.append(h('span', { class: 'pill-count down', title: s.behind + ' para trazer', text: '↓' + s.behind }));
    }

    if (s.detached) {
      body.append(h('p', { class: 'hint', text: 'Você está fora de uma branch. Escolha uma branch no topo para sincronizar.' }));
      return;
    }
    if (!s.hasRemote) {
      body.append(
        h('p', { text: 'Este projeto ainda só existe no seu computador. Conecte-o a um repositório online (GitHub, GitLab...) para guardar e compartilhar seu trabalho.' }),
        h(
          'div',
          { class: 'row' },
          btn(t.connect, { icon: 'cloud', kind: 'primary', mono: advanced(), grow: true, onclick: () => post('addRemote') }),
          btn('Guia', { icon: 'help', onclick: () => { ui.guide = true; render(); } })
        )
      );
      return;
    }
    if (!s.upstream) {
      body.append(
        h('p', { text: 'A branch "' + s.branch + '" ainda só existe no seu computador.' }),
        btn(t.publish, { icon: 'upload', kind: 'primary', mono: advanced(), onclick: () => post('push') })
      );
      return;
    }

    let status;
    if (s.ahead === 0 && s.behind === 0) {
      status = h('div', { class: 'status ok' }, icon('check'), h('span', { text: 'Tudo sincronizado com a nuvem' }));
    } else if (s.ahead > 0 && s.behind > 0) {
      status = h('div', { class: 'status warn' }, icon('alert'), h('span', { text: 'Você tem ' + s.ahead + ' ' + plural(s.ahead, 'commit novo', 'commits novos') + ' e a nuvem tem ' + s.behind + ' ' + plural(s.behind, 'novidade', 'novidades') + '. Os dois lados seguiram caminhos diferentes.' }));
    } else if (s.behind > 0) {
      status = h('div', { class: 'status info' }, icon('download'), h('span', { text: 'A nuvem tem ' + s.behind + ' ' + plural(s.behind, 'novidade', 'novidades') + ' que você ainda não tem.' }));
    } else {
      status = h('div', { class: 'status info' }, icon('upload'), h('span', { text: 'Você tem ' + s.ahead + ' ' + plural(s.ahead, 'commit', 'commits') + ' para enviar.' }));
    }
    body.append(status, h('div', { class: 'muted', text: 'Conectada a ' + s.upstream + (advanced() ? '  (ahead ' + s.ahead + ', behind ' + s.behind + ')' : '') }));
    body.append(
      h(
        'div',
        { class: 'row' },
        btn(t.fetch, { icon: 'search', grow: true, mono: advanced(), title: t.fetchTip, onclick: () => post('fetch') }),
        btn(t.pull + (s.behind ? ' (' + s.behind + ')' : ''), { icon: 'download', grow: true, mono: advanced(), kind: s.behind ? 'primary' : 'secondary', disabled: s.behind === 0, title: t.pullTip, onclick: () => post('pull') }),
        btn(t.push + (s.ahead ? ' (' + s.ahead + ')' : ''), { icon: 'upload', grow: true, mono: advanced(), kind: s.ahead && !s.behind ? 'primary' : 'secondary', disabled: s.ahead === 0, title: t.pushTip, onclick: () => post('push') })
      ),
      h('p', { class: 'hint', text: advanced() ? 'fetch consulta, pull traz e integra, push envia.' : 'Buscar só confere se há novidades. Trazer baixa as novidades. Enviar manda os seus commits.' })
    );
  }

  function renderFiles() {
    const t = T();
    const list = $('filesList');
    list.replaceChildren();
    const files = state.files;
    const badge = $('changesBadge');
    badge.replaceChildren();
    if (files.length) badge.append(h('span', { class: 'pill-count', text: String(files.length) }));

    if (!files.length) {
      list.append(h('div', { class: 'empty' }, icon('check'), h('span', { text: 'Nenhuma alteração. Está tudo salvo!' })));
      return;
    }

    const allStaged = files.every((f) => f.staged && !f.partial);
    const someStaged = files.some((f) => f.staged);
    const chkAll = h('input', { type: 'checkbox', id: 'chkAll', 'aria-label': 'Marcar todos os arquivos' });
    chkAll.checked = allStaged;
    chkAll.indeterminate = !allStaged && someStaged;
    chkAll.addEventListener('change', () => post(chkAll.checked ? 'stageAll' : 'unstageAll'));
    list.append(
      h(
        'label',
        { class: 'fileHead' },
        chkAll,
        h('span', { class: advanced() ? 'mono' : '', text: t.markAll }),
        h('span', { class: 'muted', text: files.filter((f) => f.staged).length + ' de ' + files.length + (advanced() ? ' staged' : ' marcados') })
      )
    );

    for (const f of files) {
      const chk = h('input', { type: 'checkbox', 'aria-label': 'Incluir ' + f.path + ' no commit' });
      chk.checked = f.staged && !f.partial;
      chk.indeterminate = f.partial;
      chk.addEventListener('change', () => post(chk.checked ? 'stage' : 'unstage', { paths: [f.path] }));
      list.append(
        h(
          'div',
          { class: 'file' },
          chk,
          h('span', { class: 'kind ' + f.kind, text: t.kinds[f.kind] || 'Alterado' }),
          h(
            'button',
            { type: 'button', class: 'fileName', title: f.path + ' (clique para ver as mudanças)', onclick: () => post(f.kind === 'untracked' ? 'openFile' : 'openDiff', { path: f.path }) },
            h('span', { class: 'base', text: basenameOf(f.path) }),
            h('span', { class: 'dir', text: dirOf(f.path) })
          ),
          h(
            'span',
            { class: 'fileActions' },
            h('button', { type: 'button', class: 'iconBtn', title: 'Ver o que mudou', 'aria-label': 'Ver o que mudou em ' + f.path, onclick: () => post(f.kind === 'untracked' ? 'openFile' : 'openDiff', { path: f.path }) }, icon(f.kind === 'untracked' ? 'open' : 'eye')),
            h('button', { type: 'button', class: 'iconBtn danger', title: advanced() ? 'git restore / git clean' : 'Descartar alterações', 'aria-label': 'Descartar alterações de ' + f.path, onclick: () => post('discard', { path: f.path }) }, icon('undo'))
          )
        )
      );
    }
  }

  function renderCommit() {
    const stagedCount = state.files.filter((f) => f.staged).length;
    const msg = ui.message.trim();
    const blocked = state.operation !== 'none' || state.conflicts.length > 0;
    const tooLong = MAXLEN > 0 && ui.message.length > MAXLEN;
    const can = stagedCount > 0 && msg.length > 0 && !blocked && !tooLong;
    $('btnCommit').disabled = !can;
    $('btnCommitPush').disabled = !can || state.detached;
    const len = ui.message.length;
    const counter = $('msgCount');
    counter.textContent = MAXLEN > 0 ? len + '/' + MAXLEN : String(len);
    counter.classList.toggle('over', tooLong);
    $('msgInput').setAttribute('aria-invalid', tooLong ? 'true' : 'false');

    let hint = '';
    if (blocked) hint = 'Termine a atualização em andamento antes de fazer um novo commit.';
    else if (tooLong) hint = `A mensagem passa de ${MAXLEN} caracteres (${ui.message.length}).`;
    else if (state.files.length === 0) hint = 'Quando você mudar algum arquivo, ele aparece aqui.';
    else if (stagedCount === 0) hint = 'Marque na lista acima os arquivos que entram neste commit.';
    else if (!msg) hint = 'Escreva uma descrição curta do que você fez.';
    else if (advanced()) hint = 'git commit -m "' + ui.type + ': ' + msg + '"  (' + stagedCount + ' ' + plural(stagedCount, 'arquivo', 'arquivos') + ' no index)';
    else hint = stagedCount + ' ' + plural(stagedCount, 'arquivo marcado', 'arquivos marcados') + '. Será salvo como "' + ui.type + ': ' + msg + '".';
    $('commitHint').textContent = hint;
  }

  function renderUpdate() {
    const t = T();
    const remote = state.branches.remote;
    const local = state.branches.local.filter((b) => b !== state.branch);
    const all = [...remote, ...local];
    if (!all.includes(ui.base)) {
      const prefer = ['origin/main', 'origin/master', 'origin/develop', 'main', 'master', 'develop'];
      ui.base = prefer.find((p) => all.includes(p)) || all[0] || '';
      save();
    }
    const sel = $('baseSelect');
    sel.replaceChildren();
    if (remote.length) {
      const g = h('optgroup', { label: 'Na nuvem' });
      remote.forEach((b) => g.append(h('option', { value: b, text: b })));
      sel.append(g);
    }
    if (local.length) {
      const g = h('optgroup', { label: 'No seu computador' });
      local.forEach((b) => g.append(h('option', { value: b, text: b })));
      sel.append(g);
    }
    sel.value = ui.base;
    sel.disabled = all.length === 0;

    const body = $('updateBody');
    body.replaceChildren();
    const off = !ui.base || state.detached || state.operation !== 'none' || !state.hasCommits;
    const rebaseLabel = advanced() ? t.rebase + ' ' + (ui.base || '<base>') : t.rebase;
    const mergeLabel = advanced() ? t.merge + ' ' + (ui.base || '<base>') : t.merge;
    body.append(
      h(
        'div',
        { class: 'option' },
        h('div', { class: 'optionTitle' }, icon('commit'), h('span', { text: 'Rebase' }), h('span', { class: 'tag good', text: 'recomendado' })),
        h('p', { class: 'hint', text: 'Coloca os seus commits por cima das novidades, deixando o histórico em linha reta. Ótimo para branches só suas.' }),
        btn(rebaseLabel, { icon: 'refresh', kind: 'primary', mono: advanced(), disabled: off, onclick: () => post('update', { mode: 'rebase', base: ui.base }) })
      ),
      h(
        'div',
        { class: 'option' },
        h('div', { class: 'optionTitle' }, icon('merge'), h('span', { text: 'Merge' })),
        h('p', { class: 'hint', text: 'Mistura as novidades na sua branch e pode criar um commit de junção. Mais seguro se outras pessoas usam a mesma branch.' }),
        btn(mergeLabel, { icon: 'merge', mono: advanced(), disabled: off, onclick: () => post('update', { mode: 'merge', base: ui.base }) })
      )
    );
    if (all.length === 0) {
      body.prepend(h('p', { class: 'hint', text: 'Ainda não há outra branch para trazer novidades.' }));
    }
  }

  // ---------- Histórico com gráfico ----------
  const GW = 14; // largura de cada coluna do gráfico
  const GPAD = 6;

  function graphCell(row, lanes, c) {
    const width = GPAD * 2 + lanes * GW;
    const X = (i) => GPAD + Graph.clamp(i) * GW + GW / 2;
    const svg = svgEl('svg', { class: 'gsvg', width, height: '100%', viewBox: '0 0 ' + width + ' 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const line = (x1, y1, x2, y2, color) => {
      const my = (y1 + y2) / 2;
      const d = x1 === x2 ? 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 : 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2;
      svg.append(svgEl('path', { d, stroke: color, class: 'gline', fill: 'none' }));
    };
    row.pass.forEach((i) => line(X(i), 0, X(i), 100, Graph.colorOf(i)));
    row.top.forEach((i) => line(X(i), 0, X(row.col), 50, Graph.colorOf(i)));
    row.bottom.forEach((i) => line(X(row.col), 50, X(i), 100, Graph.colorOf(i)));

    const dot = h('span', { class: 'gdot' + (c.merge ? ' merge' : '') + (c.head ? ' head' : '') });
    dot.style.left = X(row.col) - 5 + 'px';
    dot.style.background = Graph.colorOf(row.col);
    const cell = h('div', { class: 'gutter', style: 'width:' + width + 'px' }, svg, dot);
    return cell;
  }

  function commitRow(c, row, lanes) {
    const t = T();
    const refs = h('div', { class: 'refs' });
    for (const r of c.refs) {
      refs.append(h('span', { class: 'ref ' + (r.kind === 'tag' ? 'rtag' : r.kind) + (r.head ? ' head' : ''), text: r.name }));
    }
    if (c.unpushed) refs.append(h('span', { class: 'tag warn', text: advanced() ? 'ahead' : 'não enviado' }));
    if (c.incoming) refs.append(h('span', { class: 'tag info', text: advanced() ? 'behind' : 'só na nuvem' }));

    const open = ui.expanded === c.hash;
    const head = h(
      'button',
      {
        type: 'button',
        class: 'chead',
        'aria-expanded': open ? 'true' : 'false',
        title: 'Clique para ver os arquivos alterados',
        onclick: () => toggleCommit(c.hash),
      },
      h('div', { class: 'subject', text: c.subject }),
      h('div', { class: 'meta', text: c.short + ' · ' + c.author + ' · ' + c.date }),
      refs.children.length ? refs : null
    );

    const body = h('div', { class: 'cbody' }, head);
    if (open) body.append(detailsPanel(c));
    return h('li', { class: 'commit' + (open ? ' open' : '') + (c.incoming ? ' incoming' : '') + (c.head ? ' isHead' : '') }, graphCell(row, lanes, c), body);
  }

  function detailsPanel(c) {
    const d = detailsCache[c.hash];
    const box = h('div', { class: 'cdetails' });
    if (!d) {
      box.append(h('div', { class: 'muted', text: 'Carregando...' }));
      return box;
    }
    if (advanced()) box.append(h('div', { class: 'mono muted', text: 'git show ' + c.short + '   (' + c.hash + ')' }));
    if (d.body) box.append(h('p', { class: 'cmsg', text: d.body }));
    const n = d.files.length;
    box.append(
      h(
        'div',
        { class: 'cstats' },
        h('span', { text: n + ' ' + plural(n, 'arquivo alterado', 'arquivos alterados') }),
        h('span', { class: 'plus', text: '+' + d.insertions }),
        h('span', { class: 'minus', text: '−' + d.deletions })
      )
    );
    if (c.merge) box.append(h('div', { class: 'muted', text: 'Commit de junção: mostrando as mudanças em relação à primeira branch.' }));
    const list = h('div', { class: 'cfiles' });
    const letters = T().statusLetters;
    for (const f of d.files) {
      const cls = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'renamed', T: 'modified' }[f.status] || 'modified';
      list.append(
        h(
          'button',
          { type: 'button', class: 'cfile', title: f.oldPath ? f.oldPath + ' → ' + f.path : f.path, onclick: () => post('openCommitDiff', { hash: c.hash, path: f.path }) },
          h('span', { class: 'kind ' + cls, text: letters[f.status] || f.status }),
          h('span', { class: 'base', text: basenameOf(f.path) }),
          h('span', { class: 'dir', text: f.oldPath ? basenameOf(f.oldPath) + ' → ' : dirOf(f.path) })
        )
      );
    }
    if (!n) list.append(h('div', { class: 'muted', text: 'Este commit não alterou arquivos.' }));
    box.append(list);
    return box;
  }

  function toggleCommit(hash) {
    ui.expanded = ui.expanded === hash ? '' : hash;
    save();
    if (ui.expanded && !detailsCache[hash]) post('commitDetails', { hash });
    renderHistory();
  }

  function renderHistory() {
    const body = $('historyBody');
    body.replaceChildren();
    $('historyBadge').replaceChildren();

    if (!state.history.length) {
      body.append(h('div', { class: 'empty' }, icon('history'), h('span', { text: 'Ainda não há commits. Salve o primeiro acima!' })));
      return;
    }

    if (state.canUndoCommit) {
      body.append(btn(T().undo, { icon: 'undo', small: true, mono: advanced(), title: T().undoTip, onclick: () => post('undoCommit') }));
    }
    body.append(h('p', { class: 'hint', text: 'Cada linha colorida é uma branch. Clique em um commit para ver o que mudou.' }));

    const { rows, lanes } = Graph.layoutGraph(state.history);
    const ul = h('ul', { class: 'timeline' });
    state.history.forEach((c, i) => ul.append(commitRow(c, rows[i], lanes)));
    body.append(ul);

    // Se a lista de commits mudou e o aberto não existe mais, fecha.
    if (ui.expanded && !state.history.some((c) => c.hash === ui.expanded)) {
      ui.expanded = '';
      save();
    }
    if (ui.expanded && !detailsCache[ui.expanded]) post('commitDetails', { hash: ui.expanded });
  }

  // ---------- Mensagens da extensão ----------
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'state') {
      state = m.state;
      render();
    } else if (m.type === 'config') {
      CFG = { ...CFG, ...m.cfg };
      MAXLEN = typeof CFG.maxLen === 'number' ? CFG.maxLen : 72;
      applyDefaultAction();
      if (state && state.isRepo) renderCommit();
      if (ui.settings) renderSettings();
    } else if (m.type === 'busy') {
      $('busy').classList.toggle('hidden', !m.on);
      $('busyText').textContent = m.label || '';
      announce(m.on ? m.label : '');
    } else if (m.type === 'committed') {
      ui.message = '';
      ui.details = '';
      $('msgInput').value = '';
      $('detailsInput').value = '';
      announce('Commit salvo ✔');
      save();
    } else if (m.type === 'commitDetails') {
      const keys = Object.keys(detailsCache);
      if (keys.length > 80) delete detailsCache[keys[0]];
      detailsCache[m.details.hash] = m.details;
      if (state && state.isRepo) renderHistory();
    } else if (m.type === 'openGuide') {
      ui.guide = true;
      render();
    }
  });

  initStatic();
  applySettingsView();
  vscode.postMessage({ type: 'ready' });
})();
