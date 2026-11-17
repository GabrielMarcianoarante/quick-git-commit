(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  // ---------- Ícones (SVG inline, sem dependências) ----------
  const ICONS = {
    refresh:
      '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    download:
      '<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>',
    upload:
      '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    branch:
      '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    commit: '<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>',
    undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert:
      '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    history: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
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

  function btn(label, o = {}) {
    return h(
      'button',
      {
        type: 'button',
        class: 'btn ' + (o.kind || 'secondary') + (o.grow ? ' grow' : '') + (o.small ? ' small' : ''),
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

  // ---------- Estado da interface ----------
  const saved = vscode.getState() || {};
  const ui = {
    type: saved.type || 'feat',
    message: saved.message || '',
    details: saved.details || '',
    base: saved.base || '',
    open: saved.open || {},
  };
  let state = null;
  const save = () => vscode.setState(ui);
  const post = (name, payload) => vscode.postMessage({ type: 'action', name, payload: payload || {} });

  const TYPES = [
    { id: 'feat', label: 'Novidade', hint: 'Uma funcionalidade nova' },
    { id: 'fix', label: 'Correção', hint: 'Conserto de um erro' },
    { id: 'docs', label: 'Documentação', hint: 'Textos e explicações' },
    { id: 'style', label: 'Estilo', hint: 'Formatação, sem mudar o comportamento' },
    { id: 'refactor', label: 'Reorganização', hint: 'Melhorar o código sem mudar o resultado' },
    { id: 'chore', label: 'Manutenção', hint: 'Tarefas de rotina e configurações' },
  ];

  const KINDS = {
    modified: 'Alterado',
    added: 'Novo',
    untracked: 'Novo',
    deleted: 'Excluído',
    renamed: 'Renomeado',
    typechange: 'Tipo mudou',
  };

  // ---------- Inicialização (partes estáticas) ----------
  function initStatic() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));
    $('btnRefresh').append(icon('refresh'));
    $('btnNewBranch').append(icon('plus'));
    $('btnRefresh').addEventListener('click', () => post('refresh'));
    $('btnNewBranch').addEventListener('click', () => post('newBranch'));

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
    const pills = $('typePills');
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
      if (e.key === 'Enter' && !$('btnCommit').disabled) sendCommit(false);
    });
    $('detailsInput').addEventListener('input', (e) => {
      ui.details = e.target.value;
      save();
    });

    $('btnCommit').append(icon('check'), h('span', { text: 'Salvar commit' }));
    $('btnCommitPush').append(icon('upload'), h('span', { text: 'Salvar e enviar' }));
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
      p.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function sendCommit(push) {
    post('commit', { type: ui.type, message: ui.message, details: ui.details, push });
  }

  // ---------- Renderização ----------
  function render() {
    if (!state) return;
    const ok = state.isRepo;
    $('main').classList.toggle('hidden', !ok);
    $('top').classList.toggle('hidden', !ok);
    $('notRepo').classList.toggle('hidden', ok);
    if (!ok) {
      renderNotRepo();
      $('banner').replaceChildren();
      return;
    }
    renderHeader();
    renderBanner();
    renderSync();
    renderFiles();
    renderCommit();
    renderUpdate();
    renderHistory();
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
        h('p', {
          text: 'Git guarda o histórico do seu projeto e permite voltar atrás se algo der errado. Você pode começar agora, é só um clique.',
        }),
        btn('Começar a usar Git', { icon: 'check', kind: 'primary', onclick: () => post('init') })
      );
    }
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
  }

  function renderBanner() {
    const b = $('banner');
    b.replaceChildren();
    const op = state.operation;
    const hasConflicts = state.conflicts.length > 0;
    if (op === 'none' && !hasConflicts) return;

    const titles = {
      rebase: 'Atualização (rebase) pausada',
      merge: 'Atualização (merge) pausada',
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
            btn('Resolvido', { icon: 'check', small: true, kind: 'primary', onclick: () => post('resolve', { path: f }) })
          )
        );
      }
      card.append(list);
    } else {
      card.append(h('p', { text: 'Todos os conflitos foram resolvidos. Clique em "Continuar" para terminar.' }));
    }
    if (op !== 'none') {
      card.append(
        h(
          'div',
          { class: 'row' },
          btn('Continuar', { icon: 'check', kind: 'primary', grow: true, disabled: hasConflicts, onclick: () => post('continueOp') }),
          btn('Cancelar tudo', { icon: 'x', grow: true, onclick: () => post('abortOp') })
        )
      );
    }
    b.append(card);
  }

  function renderSync() {
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
        btn('Conectar à nuvem', { icon: 'cloud', kind: 'primary', onclick: () => post('addRemote') })
      );
      return;
    }
    if (!s.upstream) {
      body.append(
        h('p', { text: 'A branch "' + s.branch + '" ainda só existe no seu computador.' }),
        btn('Publicar na nuvem', { icon: 'upload', kind: 'primary', onclick: () => post('push') })
      );
      return;
    }

    let status;
    if (s.ahead === 0 && s.behind === 0) {
      status = h('div', { class: 'status ok' }, icon('check'), h('span', { text: 'Tudo sincronizado com a nuvem' }));
    } else if (s.ahead > 0 && s.behind > 0) {
      status = h(
        'div',
        { class: 'status warn' },
        icon('alert'),
        h('span', {
          text:
            'Você tem ' + s.ahead + ' ' + plural(s.ahead, 'commit novo', 'commits novos') + ' e a nuvem tem ' + s.behind + ' ' + plural(s.behind, 'novidade', 'novidades') + '. Os dois lados seguiram caminhos diferentes.',
        })
      );
    } else if (s.behind > 0) {
      status = h('div', { class: 'status info' }, icon('download'), h('span', { text: 'A nuvem tem ' + s.behind + ' ' + plural(s.behind, 'novidade', 'novidades') + ' que você ainda não tem.' }));
    } else {
      status = h('div', { class: 'status info' }, icon('upload'), h('span', { text: 'Você tem ' + s.ahead + ' ' + plural(s.ahead, 'commit', 'commits') + ' para enviar.' }));
    }
    body.append(status, h('div', { class: 'muted', text: 'Conectada a ' + s.upstream }));
    body.append(
      h(
        'div',
        { class: 'row' },
        btn('Buscar', { icon: 'search', grow: true, title: 'Só confere se há novidades. Não mexe nos seus arquivos.', onclick: () => post('fetch') }),
        btn('Trazer' + (s.behind ? ' (' + s.behind + ')' : ''), { icon: 'download', grow: true, kind: s.behind ? 'primary' : 'secondary', disabled: s.behind === 0, title: 'Baixa as novidades da nuvem para o seu computador.', onclick: () => post('pull') }),
        btn('Enviar' + (s.ahead ? ' (' + s.ahead + ')' : ''), { icon: 'upload', grow: true, kind: s.ahead && !s.behind ? 'primary' : 'secondary', disabled: s.ahead === 0, title: 'Envia os seus commits para a nuvem.', onclick: () => post('push') })
      ),
      h('p', { class: 'hint', text: 'Buscar só confere se há novidades. Trazer baixa as novidades. Enviar manda os seus commits.' })
    );
  }

  function renderFiles() {
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
        h('span', { text: 'Marcar tudo' }),
        h('span', { class: 'muted', text: files.filter((f) => f.staged).length + ' de ' + files.length + ' marcados' })
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
          h('span', { class: 'kind ' + f.kind, text: KINDS[f.kind] || 'Alterado' }),
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
            h('button', { type: 'button', class: 'iconBtn danger', title: 'Descartar alterações', 'aria-label': 'Descartar alterações de ' + f.path, onclick: () => post('discard', { path: f.path }) }, icon('undo'))
          )
        )
      );
    }
  }

  function renderCommit() {
    const stagedCount = state.files.filter((f) => f.staged).length;
    const msg = ui.message.trim();
    const blocked = state.operation !== 'none' || state.conflicts.length > 0;
    const can = stagedCount > 0 && msg.length > 0 && !blocked;
    $('btnCommit').disabled = !can;
    $('btnCommitPush').disabled = !can || state.detached;
    const len = ui.message.length;
    const counter = $('msgCount');
    counter.textContent = len + '/72';
    counter.classList.toggle('over', len > 72);

    let hint = '';
    if (blocked) hint = 'Termine a atualização em andamento antes de fazer um novo commit.';
    else if (state.files.length === 0) hint = 'Quando você mudar algum arquivo, ele aparece aqui.';
    else if (stagedCount === 0) hint = 'Marque na lista acima os arquivos que entram neste commit.';
    else if (!msg) hint = 'Escreva uma descrição curta do que você fez.';
    else hint = stagedCount + ' ' + plural(stagedCount, 'arquivo marcado', 'arquivos marcados') + '. Será salvo como "' + ui.type + ': ' + msg + '".';
    $('commitHint').textContent = hint;
  }

  function candidateBases() {
    const remote = state.branches.remote.filter((b) => b !== state.upstream || true);
    const local = state.branches.local.filter((b) => b !== state.branch);
    return { remote, local };
  }

  function renderUpdate() {
    const { remote, local } = candidateBases();
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
    body.append(
      h(
        'div',
        { class: 'option' },
        h('div', { class: 'optionTitle' }, icon('commit'), h('span', { text: 'Rebase' }), h('span', { class: 'tag good', text: 'recomendado' })),
        h('p', { class: 'hint', text: 'Coloca os seus commits por cima das novidades, deixando o histórico em linha reta. Ótimo para branches só suas.' }),
        btn('Atualizar com Rebase', { icon: 'refresh', kind: 'primary', disabled: off, onclick: () => post('update', { mode: 'rebase', base: ui.base }) })
      ),
      h(
        'div',
        { class: 'option' },
        h('div', { class: 'optionTitle' }, icon('merge'), h('span', { text: 'Merge' })),
        h('p', { class: 'hint', text: 'Mistura as novidades na sua branch e pode criar um commit de junção. Mais seguro se outras pessoas usam a mesma branch.' }),
        btn('Atualizar com Merge', { icon: 'merge', disabled: off, onclick: () => post('update', { mode: 'merge', base: ui.base }) })
      )
    );
    if (all.length === 0) {
      body.prepend(h('p', { class: 'hint', text: 'Ainda não há outra branch para trazer novidades.' }));
    }
  }

  function commitRow(c, kind) {
    const refs = h('div', { class: 'refs' });
    for (const r of c.refs) {
      refs.append(h('span', { class: 'ref ' + (r.kind === 'tag' ? 'rtag' : r.kind) + (r.head ? ' head' : ''), text: r.name }));
    }
    if (c.unpushed) refs.append(h('span', { class: 'tag warn', text: 'não enviado' }));
    return h(
      'li',
      { class: 'commit ' + (kind || '') + (c.merge ? ' merge' : '') },
      h('span', { class: 'dot' }),
      h(
        'div',
        { class: 'cbody' },
        h('div', { class: 'subject', title: c.subject, text: c.subject }),
        h('div', { class: 'meta', text: c.short + ' · ' + c.author + ' · ' + c.date }),
        refs.children.length ? refs : null
      )
    );
  }

  function renderHistory() {
    const body = $('historyBody');
    body.replaceChildren();
    $('historyBadge').replaceChildren();

    if (state.incoming.length) {
      body.append(
        h('div', { class: 'groupTitle' }, icon('download'), h('span', { text: 'Na nuvem, ainda não aqui (' + state.incoming.length + ')' })),
        h('ul', { class: 'timeline' }, state.incoming.map((c) => commitRow(c, 'incoming')))
      );
    }

    if (!state.history.length) {
      body.append(h('div', { class: 'empty' }, icon('history'), h('span', { text: 'Ainda não há commits. Salve o primeiro acima!' })));
      return;
    }

    const head = h('div', { class: 'groupTitle' }, icon('history'), h('span', { text: 'Seus commits' }));
    body.append(head);
    if (state.canUndoCommit) {
      body.append(btn('Desfazer último commit', { icon: 'undo', small: true, title: 'Desfaz o commit mais recente, mantendo as suas alterações.', onclick: () => post('undoCommit') }));
    }
    body.append(h('ul', { class: 'timeline' }, state.history.map((c) => commitRow(c, ''))));
  }

  // ---------- Mensagens da extensão ----------
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'state') {
      state = m.state;
      render();
    } else if (m.type === 'busy') {
      $('busy').classList.toggle('hidden', !m.on);
      $('busyText').textContent = m.label || '';
    } else if (m.type === 'committed') {
      ui.message = '';
      ui.details = '';
      $('msgInput').value = '';
      $('detailsInput').value = '';
      save();
    }
  });

  initStatic();
  vscode.postMessage({ type: 'ready' });
})();
