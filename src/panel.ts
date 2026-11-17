import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getConfig, settingsPayload } from './config';
import { currentLang, tr, ui } from './i18n';
import {
  git,
  isHash,
  readCommitDetails,
  gitOk,
  getRepoRoot,
  getSync,
  currentOperation,
  listBranches,
  readState,
  readStatus,
  FileEntry,
} from './git';

export const DIFF_SCHEME = 'qgc-git';
const ONBOARDING_KEY = 'quickGitCommit.onboardingDone';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;

/** Traduz erros comuns do Git para uma linguagem que qualquer pessoa entende. */
function friendly(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('git não encontrado')) {
    return raw;
  }
  if (
    m.includes('authentication failed') ||
    m.includes('could not read username') ||
    m.includes('terminal prompts disabled') ||
    m.includes('permission denied') ||
    m.includes('invalid username or password')
  ) {
    return 'Não consegui entrar na sua conta do repositório online. Faça login (GitHub no VS Code ou Git Credential Manager) e tente de novo.';
  }
  if (m.includes('could not resolve host') || m.includes('unable to access') || m.includes('network is unreachable')) {
    return 'Não consegui falar com o servidor. Verifique sua internet e tente novamente.';
  }
  if (m.includes('please tell me who you are') || m.includes('unable to auto-detect email')) {
    return 'O Git ainda não sabe quem é você. Rode no terminal: git config --global user.name "Seu Nome" e git config --global user.email "voce@email.com".';
  }
  if (m.includes('would be overwritten') || m.includes('your local changes')) {
    return 'Você tem alterações que seriam sobrescritas. Faça um commit (ou desfaça essas alterações) antes de continuar.';
  }
  if (m.includes('nothing to commit')) {
    return 'Não há nada para salvar no commit.';
  }
  if (m.includes('not possible to fast-forward') || m.includes('diverging branches')) {
    return 'Sua branch e a da nuvem seguiram caminhos diferentes. Use "Atualizar minha branch" (Rebase ou Merge).';
  }
  if (m.includes('no remote') || m.includes("'origin' does not appear to be a git repository")) {
    return 'Esta pasta ainda não está ligada a um repositório online. Use "Conectar à nuvem".';
  }
  const first = raw.trim().split('\n').slice(0, 4).join('\n');
  return first.length > 400 ? first.slice(0, 400) + '…' : first;
}

/** Entrega o conteúdo de um arquivo em um commit/índice, para o editor de diferenças. */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const q = JSON.parse(uri.query) as { root: string; ref: 'HEAD' | 'index' | 'none' | 'rev'; file: string; rev?: string };
      if (q.ref === 'none') {
        return '';
      }
      let spec = q.ref === 'HEAD' ? `HEAD:${q.file}` : `:${q.file}`;
      if (q.ref === 'rev') {
        if (!isHash(q.rev)) {
          return '';
        }
        spec = `${q.rev}:${q.file}`;
      }
      return await git(q.root, ['show', spec], { raw: true });
    } catch {
      return '';
    }
  }
}

export class QuickGitViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'quickGitCommit.panel';

  private view?: vscode.WebviewView;
  private htmlKey = '';
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private lastJson = '';
  private timer?: NodeJS.Timeout;
  private poll?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
    private readonly globalState: vscode.Memento
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const schedule = (): void => this.scheduleRefresh();
    this.disposables.push(
      watcher,
      watcher.onDidChange(schedule),
      watcher.onDidCreate(schedule),
      watcher.onDidDelete(schedule),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) {
          schedule();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
          schedule();
        }
      })
    );
    // Rede de segurança: commits feitos fora do painel (terminal etc.) aparecem sozinhos.
    this.poll = setInterval(() => {
      if (this.view?.visible && this.pending === 0) {
        void this.refresh();
      }
    }, 8000);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.poll) {
      clearInterval(this.poll);
    }
    this.disposables.forEach((d) => d.dispose());
  }

  // ---------- Webview ----------

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.refresh(true);
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
    const i18nJs = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'i18n.js'));
    const payload = settingsPayload();
    this.htmlKey = payload.lang + JSON.stringify(payload.types);
    const lang = payload.lang;
    const cfg = encodeURIComponent(JSON.stringify(payload));
    const graphJs = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'graph.js'));
    return /* html */ `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'pt-BR'}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
  <title>Quick Git</title>
</head>
<body data-cfg="${cfg}">
  <div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="busy" class="busy hidden" role="status" aria-live="polite">
    <div class="spinner"></div>
    <div id="busyText"></div>
  </div>

  <div id="app">
    <div class="repoLine bar">
      <span id="repoName" class="repoName"></span>
      <span class="topTools">
        <button id="btnGuide" class="iconBtn" type="button" title="Guia inicial" aria-label="Abrir o guia inicial"></button>
        <button id="btnSettings" class="iconBtn" type="button" title="Configurações" aria-label="Abrir configurações" aria-pressed="false"></button>
        <button id="btnRefresh" class="iconBtn" type="button" title="Atualizar a tela" aria-label="Atualizar a tela"></button>
      </span>
    </div>
    <div id="settings" class="settings hidden"></div>
    <header id="top" class="top">
      <div class="modeRow">
        <div class="seg" role="radiogroup" aria-label="Modo de exibição">
          <button id="modeSimple" class="segBtn" type="button" role="radio" data-mode="simple">Simples</button>
          <button id="modeAdvanced" class="segBtn" type="button" role="radio" data-mode="advanced">Avançado</button>
        </div>
        <p id="modeHint" class="hint modeHint"></p>
      </div>
      <div class="branchRow">
        <span class="branchIcon" data-icon="branch"></span>
        <select id="branchSelect" aria-label="Branch atual" title="Trocar de branch"></select>
        <button id="btnNewBranch" class="iconBtn" type="button" title="Criar nova branch" aria-label="Criar nova branch"></button>
      </div>
    </header>

    <div id="onboard" class="hidden"></div>
    <div id="notRepo" class="card hidden"></div>
    <div id="banner"></div>

    <main id="main" class="hidden">
      <details class="section" data-key="sync" open>
        <summary id="secSync"><span class="sTitle" data-icon="cloud">Sincronizar com a nuvem</span><span id="syncBadge" class="badges"></span></summary>
        <div id="syncBody" class="sBody"></div>
      </details>

      <details class="section" data-key="changes" open>
        <summary id="secChanges"><span class="sTitle" data-icon="file">Minhas alterações</span><span id="changesBadge" class="badges"></span></summary>
        <div class="sBody">
          <div id="filesList"></div>
          <div class="commitForm">
            <div class="label">1. Que tipo de mudança é essa?</div>
            <div id="typePills" class="pills" role="radiogroup" aria-label="Tipo do commit"></div>
            <label class="label" for="msgInput">2. Descreva o que você fez</label>
            <input id="msgInput" type="text" aria-describedby="msgCount commitHint" placeholder="ex.: adiciona tela de login" autocomplete="off" spellcheck="true">
            <div class="counter"><span id="msgCount">0/72</span></div>
            <textarea id="detailsInput" rows="2" placeholder="Detalhes (opcional)" aria-label="Detalhes opcionais"></textarea>
            <div id="commitHint" class="hint"></div>
            <div class="row">
              <button id="btnCommit" class="btn primary grow" type="button"></button>
              <button id="btnCommitPush" class="btn secondary grow" type="button"></button>
            </div>
          </div>
        </div>
      </details>

      <details class="section" data-key="update">
        <summary id="secUpdate"><span class="sTitle" data-icon="merge">Atualizar minha branch</span></summary>
        <div class="sBody">
          <p class="hint">Traga para a sua branch as novidades de outra (por exemplo, a <b>main</b>), sem perder o seu trabalho.</p>
          <label id="baseLabel" class="label" for="baseSelect">Trazer novidades de:</label>
          <select id="baseSelect" aria-label="Branch de origem das novidades"></select>
          <div id="updateBody"></div>
        </div>
      </details>

      <details class="section" data-key="history" open>
        <summary id="secHistory"><span class="sTitle" data-icon="history">Histórico</span><span id="historyBadge" class="badges"></span></summary>
        <div class="sBody">
          <div id="historyBody"></div>
        </div>
      </details>
    </main>
  </div>
  <script nonce="${nonce}" src="${i18nJs}"></script>
  <script nonce="${nonce}" src="${graphJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  /** Recarrega o painel (idioma/configurações mudaram). */
  reload(): void {
    if (this.view) {
      this.view.webview.html = this.html(this.view.webview);
    }
  }

  /** Executa uma ação do painel (fetch, pull, push) por comando/atalho. */
  action(name: string): void {
    void this.onMessage({ type: 'action', name });
  }

  /** Configuração mudou (painel ou settings.json): idioma/prefixos recarregam o painel; o resto é aplicado ao vivo. */
  onConfigChanged(): void {
    if (!this.view) {
      return;
    }
    const p = settingsPayload();
    if (p.lang + JSON.stringify(p.types) !== this.htmlKey) {
      this.reload();
    } else {
      this.post({ type: 'config', cfg: p });
    }
  }

  private async setSetting(key: string, value: unknown): Promise<void> {
    let v: unknown;
    if (key === 'language' && ['auto', 'pt-BR', 'en'].includes(String(value))) {
      v = String(value);
    } else if (key === 'defaultAction' && ['ask', 'commit', 'commitAndPush'].includes(String(value))) {
      v = String(value);
    } else if (key === 'askBranch') {
      v = value === true;
    } else if (key === 'messageMaxLength') {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0 || n > 500) {
        void ui.warn('Limite inválido. Use um número de 0 a 500.');
        this.onConfigChanged();
        return;
      }
      v = n;
    } else if (key === 'commitTypes') {
      const ids = String(value).split(/[,\s]+/).filter(Boolean);
      const valid = ids.filter((id, i) => /^[A-Za-z0-9][\w.-]*$/.test(id) && ids.indexOf(id) === i);
      if (valid.length === 0 || ids.some((id) => !/^[A-Za-z0-9][\w.-]*$/.test(id))) {
        void ui.warn('Informe pelo menos um prefixo válido (letras, números, ponto, hífen).');
        this.onConfigChanged();
        return;
      }
      const old = getConfig().types;
      v = valid.map((id) => {
        const d = old.find((t) => t.id === id)?.description;
        return d ? { label: id, description: d } : id;
      });
    } else {
      return;
    }
    await vscode.workspace.getConfiguration('quickGitCommit').update(key, v, vscode.ConfigurationTarget.Global);
  }

  private async resetSettings(): Promise<void> {
    const ok = await ui.warn(
      'Restaurar as configurações padrão?',
      { modal: true, detail: 'Seus prefixos, limite e idioma voltam ao original.' },
      'Restaurar'
    );
    if (ok !== 'Restaurar') {
      return;
    }
    const c = vscode.workspace.getConfiguration('quickGitCommit');
    for (const k of ['language', 'commitTypes', 'messageMaxLength', 'askBranch', 'defaultAction']) {
      await c.update(k, undefined, vscode.ConfigurationTarget.Global);
    }
    this.toast('Configurações restauradas ✔');
  }

  /** Marca arquivos para o commit (menu de contexto do Explorer/editor). */
  async stageUris(uris: vscode.Uri[]): Promise<void> {
    const root = await this.getRoot();
    if (!root) {
      void ui.error('Quick Git: abra uma pasta que seja um repositório Git.');
      return;
    }
    const paths = uris
      .filter((u) => u.scheme === 'file')
      .map((u) => path.relative(root, u.fsPath).split(path.sep).join('/'))
      .filter((p) => p && !p.startsWith('..'));
    if (paths.length === 0) {
      void ui.info('Nenhum arquivo para marcar.');
      return;
    }
    void this.enqueue(undefined, async (r) => {
      await this.doStage(r, paths, true);
      this.toast('Arquivo marcado para o commit ✔');
    });
  }

  private post(message: Payload): void {
    void this.view?.webview.postMessage(message);
  }

  // ---------- Atualização de estado ----------

  private scheduleRefresh(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      if (this.pending === 0) {
        void this.refresh();
      }
    }, 700);
  }

  async refresh(force = false): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      const folders = vscode.workspace.workspaceFolders;
      let state: Payload;
      const root = await this.getRoot();
      if (!root) {
        state = { isRepo: false, hasFolder: !!folders?.length, folderName: folders?.[0]?.name };
      } else {
        state = await readState(root);
      }
      state.onboarding = await this.onboardingInfo(root, !!folders?.length);
      const json = JSON.stringify(state);
      if (!force && json === this.lastJson) {
        return;
      }
      this.lastJson = json;
      this.post({ type: 'state', state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`Erro ao ler o estado: ${message}`);
      const state: Payload = { isRepo: false, hasFolder: true, error: friendly(message) };
      state.onboarding = await this.onboardingInfo(undefined, true).catch(() => undefined);
      this.lastJson = '';
      this.post({ type: 'state', state });
    }
  }

  private async getRoot(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    const fromEditor = folders.length > 1 && active ? vscode.workspace.getWorkspaceFolder(active) : undefined;
    const folder = fromEditor ?? folders[0];
    return getRepoRoot(folder.uri.fsPath);
  }

  // ---------- Execução de ações (uma por vez) ----------

  private enqueue(label: string | undefined, fn: (root: string) => Promise<void>): Promise<void> {
    this.pending++;
    const job = this.chain
      .then(async () => {
        let root: string | undefined;
        try {
          root = await this.getRoot();
        } catch (e) {
          this.showError(e);
          return;
        }
        if (!root) {
          void ui.warn('Quick Git: abra uma pasta que seja um repositório Git.');
          return;
        }
        if (label) {
          this.post({ type: 'busy', on: true, label });
        }
        try {
          await fn(root);
        } catch (e) {
          this.showError(e);
        } finally {
          if (label) {
            this.post({ type: 'busy', on: false });
          }
          await this.refresh(true);
        }
      })
      .finally(() => {
        this.pending--;
      });
    this.chain = job;
    return job;
  }

  private showError(e: unknown): void {
    const raw = e instanceof Error ? e.message : String(e);
    this.output.appendLine(`ERRO: ${raw}`);
    void ui.error(`Quick Git: ${friendly(raw)}`, 'Ver detalhes').then((pick) => {
      if (pick) {
        this.output.show(true);
      }
    });
  }

  private toast(text: string): void {
    void ui.info(`Quick Git: ${tr(text)}`);
  }

  private async onMessage(msg: Payload): Promise<void> {
    if (msg.type === 'ready') {
      await this.refresh(true);
      return;
    }
    if (msg.type !== 'action') {
      return;
    }
    const p: Payload = msg.payload ?? {};
    switch (msg.name) {
      case 'setSetting':
        await this.setSetting(String(p.key), p.value);
        break;
      case 'resetSettings':
        await this.resetSettings();
        break;
      case 'openVsSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'quickGitCommit');
        break;
      case 'refresh':
        await this.refresh(true);
        break;
      case 'init':
        await this.initRepo();
        break;
      case 'fetch':
        void this.enqueue('Verificando novidades na nuvem...', (r) => this.doFetch(r));
        break;
      case 'pull':
        void this.enqueue('Trazendo novidades...', (r) => this.doPull(r));
        break;
      case 'push':
        void this.enqueue('Enviando para a nuvem...', (r) => this.doPush(r));
        break;
      case 'addRemote':
        void this.enqueue(undefined, async (r) => void (await this.addRemote(r)));
        break;
      case 'checkout':
        void this.enqueue('Trocando de branch...', (r) => this.doCheckout(r, String(p.branch ?? '')));
        break;
      case 'newBranch':
        await this.newBranch();
        break;
      case 'stage':
        void this.enqueue(undefined, (r) => this.doStage(r, p.paths, true));
        break;
      case 'unstage':
        void this.enqueue(undefined, (r) => this.doStage(r, p.paths, false));
        break;
      case 'stageAll':
        void this.enqueue(undefined, (r) => this.doStageAll(r, true));
        break;
      case 'unstageAll':
        void this.enqueue(undefined, (r) => this.doStageAll(r, false));
        break;
      case 'discard':
        void this.enqueue(undefined, (r) => this.doDiscard(r, String(p.path ?? '')));
        break;
      case 'openFile':
        void this.enqueue(undefined, (r) => this.openFile(r, String(p.path ?? '')));
        break;
      case 'openDiff':
        void this.enqueue(undefined, (r) => this.openDiff(r, String(p.path ?? '')));
        break;
      case 'commit':
        void this.enqueue('Salvando commit...', (r) => this.doCommit(r, p));
        break;
      case 'update':
        void this.enqueue('Atualizando sua branch...', (r) => this.doUpdate(r, p));
        break;
      case 'resolve':
        void this.enqueue(undefined, (r) => this.doResolve(r, String(p.path ?? '')));
        break;
      case 'continueOp':
        void this.enqueue('Continuando...', (r) => this.doContinue(r));
        break;
      case 'abortOp':
        void this.enqueue('Cancelando...', (r) => this.doAbort(r));
        break;
      case 'undoCommit':
        void this.enqueue('Desfazendo commit...', (r) => this.doUndoCommit(r));
        break;
      case 'commitDetails':
        void this.enqueue(undefined, (r) => this.sendCommitDetails(r, String(p.hash ?? '')));
        break;
      case 'openCommitDiff':
        void this.enqueue(undefined, (r) => this.openCommitDiff(r, String(p.hash ?? ''), String(p.path ?? '')));
        break;
      case 'ob.identity':
        await this.setIdentity();
        break;
      case 'ob.github':
        await this.githubSignIn();
        break;
      case 'ob.createRepo':
        void this.enqueue('Criando repositório no GitHub...', (r) => this.createGithubRepo(r));
        break;
      case 'ob.finish':
        await this.globalState.update(ONBOARDING_KEY, true);
        await this.refresh(true);
        break;
      case 'ob.openGit':
        void vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
        break;
      case 'ob.openFolder':
        void vscode.commands.executeCommand('workbench.action.files.openFolder');
        break;
      default:
        break;
    }
  }

  // ---------- Ações ----------

  private async initRepo(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      return;
    }
    const pick = await ui.info(
      'Criar um repositório Git nesta pasta?',
      { modal: true, detail: 'Isso começa o controle de versões do seu projeto. Nada é enviado para a internet.' },
      'Criar repositório'
    );
    if (!pick) {
      return;
    }
    try {
      try {
        await git(folder, ['init', '-b', 'main']);
      } catch {
        await git(folder, ['init']);
      }
      this.toast('Repositório criado ✔');
    } catch (e) {
      this.showError(e);
    }
    await this.refresh(true);
  }

  private async doFetch(root: string): Promise<void> {
    const remotes = await git(root, ['remote']);
    if (!remotes.trim()) {
      throw new Error('no remote');
    }
    await git(root, ['fetch', '--all', '--prune']);
    vscode.window.setStatusBarMessage('Quick Git: novidades verificadas ✔', 3000);
  }

  /** Pede a URL e liga o projeto a um repositório online. Retorna o nome do remoto. */
  private async addRemote(root: string): Promise<string | undefined> {
    const url = await ui.input({
      title: 'Conectar à nuvem',
      prompt: 'Cole o endereço (URL) do repositório online (GitHub, GitLab...)',
      placeHolder: 'https://github.com/usuario/projeto.git',
      ignoreFocusOut: true,
      validateInput: (v) => (!v.trim() ? 'Cole o endereço do repositório.' : /\s/.test(v.trim()) ? 'O endereço não pode ter espaços.' : undefined),
    });
    if (!url) {
      return undefined;
    }
    const remotes = (await git(root, ['remote'])).split('\n').filter(Boolean);
    if (remotes.includes('origin')) {
      await git(root, ['remote', 'set-url', 'origin', url.trim()]);
    } else {
      await git(root, ['remote', 'add', 'origin', url.trim()]);
    }
    this.toast('Conectado à nuvem ✔');
    return 'origin';
  }

  private async doPush(root: string): Promise<void> {
    const sync0 = await getSync(root);
    if (!sync0.branch) {
      throw new Error('Você está fora de uma branch (HEAD solto). Escolha uma branch para enviar.');
    }
    let remotes = (await git(root, ['remote'])).split('\n').filter(Boolean);
    if (remotes.length === 0) {
      const added = await this.addRemote(root);
      if (!added) {
        return;
      }
      remotes = [added];
    }
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];

    if (!sync0.upstream) {
      await git(root, ['push', '-u', remote, sync0.branch]);
      this.toast('Branch publicada na nuvem ✔');
      return;
    }

    // Confere a situação real da nuvem antes de enviar.
    try {
      await git(root, ['fetch', '--prune']);
    } catch {
      /* sem rede: o push abaixo mostrará o erro adequado */
    }
    const s = await getSync(root);
    if (s.ahead === 0 && s.behind === 0) {
      this.toast('Nada para enviar: tudo já está na nuvem ✔');
      return;
    }
    if (s.ahead === 0 && s.behind > 0) {
      this.toast('Você não tem commits novos para enviar. A nuvem tem novidades: clique em "Trazer".');
      return;
    }
    if (s.behind > 0) {
      const choice = await ui.warn(
        'A versão na nuvem é diferente da sua.',
        {
          modal: true,
          detail:
            'Isso acontece quando outra pessoa enviou commits, ou depois de um Rebase.\n\n' +
            '• Atualizar primeiro (recomendado): traz as novidades e depois você envia.\n' +
            '• Substituir a nuvem: a nuvem passa a ficar igual à sua branch. Commits que só existem lá serão perdidos.',
        },
        'Atualizar primeiro',
        'Substituir a nuvem (forçar)'
      );
      if (choice === 'Atualizar primeiro') {
        await this.doPull(root);
      } else if (choice === 'Substituir a nuvem (forçar)') {
        await git(root, ['push', '--force-with-lease']);
        this.toast('Nuvem atualizada com a sua versão ✔');
      }
      return;
    }
    await git(root, ['push']);
    this.toast('Commits enviados para a nuvem ✔');
  }

  private async doPull(root: string): Promise<void> {
    const s0 = await getSync(root);
    if (!s0.upstream) {
      throw new Error('Esta branch ainda não existe na nuvem. Use "Publicar na nuvem" primeiro.');
    }
    await git(root, ['fetch', '--prune']);
    const s = await getSync(root);
    if (s.behind === 0) {
      this.toast('Você já está com tudo atualizado ✔');
      return;
    }
    if (s.ahead === 0) {
      await git(root, ['pull', '--ff-only', '--autostash']);
      this.toast(`Novidades trazidas (${s.behind}) ✔`);
      return;
    }
    const choice = await ui.warn(
      'Você e a nuvem têm commits diferentes.',
      {
        modal: true,
        detail:
          'Como você prefere juntar os dois lados?\n\n' +
          '• Rebase (recomendado): seus commits ficam por cima das novidades, em linha reta.\n' +
          '• Merge: junta os dois lados e cria um commit de junção. Mais seguro se outras pessoas usam esta branch.',
      },
      'Usar Rebase',
      'Usar Merge'
    );
    if (choice === 'Usar Rebase') {
      await this.integrate(root, 'rebase', '@{u}');
    } else if (choice === 'Usar Merge') {
      await this.integrate(root, 'merge', '@{u}');
    }
  }

  /** Rebase ou merge; se houver conflitos, deixa o painel guiar a resolução. */
  private async integrate(root: string, mode: 'rebase' | 'merge', target: string): Promise<void> {
    try {
      if (mode === 'rebase') {
        await git(root, ['rebase', '--autostash', target]);
      } else {
        await git(root, ['merge', '--no-edit', target]);
      }
      this.toast('Pronto! Sua branch foi atualizada ✔');
    } catch (e) {
      if ((await currentOperation(root)) !== 'none') {
        void ui.warn(
          'Quick Git: encontrei conflitos. Resolva os arquivos listados no painel e clique em "Continuar".'
        );
        return;
      }
      throw e;
    }
  }

  private async doCheckout(root: string, branch: string): Promise<void> {
    if ((await currentOperation(root)) !== 'none') {
      throw new Error('Termine ou cancele a atualização em andamento antes de trocar de branch.');
    }
    const branches = await listBranches(root);
    if (!branches.local.includes(branch)) {
      return;
    }
    await git(root, ['checkout', branch]);
  }

  private async newBranch(): Promise<void> {
    const root = await this.getRoot().catch(() => undefined);
    if (!root) {
      return;
    }
    const name = await ui.input({
      title: 'Nova branch',
      prompt: 'Dê um nome para a nova branch (uma "linha de trabalho" separada)',
      placeHolder: 'feat/minha-feature',
      validateInput: async (value) => {
        const v = value.trim();
        if (!v) {
          return 'Informe um nome.';
        }
        return (await gitOk(root, ['check-ref-format', '--branch', v])) ? undefined : 'Nome inválido (evite espaços e caracteres especiais).';
      },
    });
    if (!name) {
      return;
    }
    void this.enqueue('Criando branch...', async (r) => {
      await git(r, ['checkout', '-b', name.trim()]);
      this.toast(`Branch "${name.trim()}" criada ✔`);
    });
  }

  private async validPaths(root: string, paths: unknown): Promise<string[]> {
    if (!Array.isArray(paths)) {
      return [];
    }
    const known = new Set((await readStatus(root)).map((f) => f.path));
    return paths.filter((p): p is string => typeof p === 'string' && known.has(p));
  }

  private async gitPaths(root: string, base: string[], paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += 100) {
      await git(root, [...base, '--', ...paths.slice(i, i + 100)]);
    }
  }

  private async doStage(root: string, rawPaths: unknown, stage: boolean): Promise<void> {
    const paths = await this.validPaths(root, rawPaths);
    if (paths.length === 0) {
      return;
    }
    if (stage) {
      await this.gitPaths(root, ['add', '-A'], paths);
    } else if (await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD'])) {
      await this.gitPaths(root, ['restore', '--staged'], paths);
    } else {
      await this.gitPaths(root, ['rm', '--cached', '-r', '-q'], paths);
    }
  }

  private async doStageAll(root: string, stage: boolean): Promise<void> {
    if (stage) {
      await git(root, ['add', '-A']);
    } else if (await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD'])) {
      await git(root, ['restore', '--staged', '.']);
    } else {
      await gitOk(root, ['rm', '--cached', '-r', '-q', '.']);
    }
  }

  private async doDiscard(root: string, file: string): Promise<void> {
    const entry = (await readStatus(root)).find((f) => f.path === file && !f.conflict);
    if (!entry) {
      return;
    }
    const isNew = entry.kind === 'untracked' || entry.index === 'A';
    const pick = await ui.warn(
      `Descartar as alterações de "${entry.path}"?`,
      {
        modal: true,
        detail: isNew
          ? 'Este arquivo é novo: ele será APAGADO do seu computador. Não dá para recuperar.'
          : 'Tudo o que você mudou neste arquivo será desfeito e ele volta ao último commit. Não dá para recuperar.',
      },
      'Descartar'
    );
    if (pick !== 'Descartar') {
      return;
    }
    if (entry.kind === 'untracked') {
      await git(root, ['clean', '-f', '--', entry.path]);
    } else if (entry.index === 'A') {
      await git(root, ['rm', '-f', '--', entry.path]);
    } else {
      await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', entry.path]);
    }
  }

  private async openFile(root: string, file: string): Promise<void> {
    const known = (await readStatus(root)).some((f) => f.path === file);
    if (!known) {
      return;
    }
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) {
      this.toast('Este arquivo foi excluído, então não há o que abrir.');
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(abs));
  }

  private async openDiff(root: string, file: string): Promise<void> {
    const entry: FileEntry | undefined = (await readStatus(root)).find((f) => f.path === file);
    if (!entry) {
      return;
    }
    const abs = path.join(root, file);
    if (entry.kind === 'untracked') {
      await vscode.window.showTextDocument(vscode.Uri.file(abs));
      return;
    }
    const mk = (ref: 'HEAD' | 'index' | 'none'): vscode.Uri =>
      vscode.Uri.from({ scheme: DIFF_SCHEME, path: '/' + file, query: JSON.stringify({ root, ref, file }) });

    const base = path.basename(file);
    const stagedOnly = entry.staged && !entry.partial;
    let left: vscode.Uri;
    let right: vscode.Uri;
    let title: string;
    if (stagedOnly) {
      left = mk('HEAD');
      right = mk('index');
      title = `${base} (antes ↔ marcado para o commit)`;
    } else {
      left = mk('index');
      right = fs.existsSync(abs) ? vscode.Uri.file(abs) : mk('none');
      title = `${base} (antes ↔ agora)`;
    }
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  private async doCommit(root: string, p: Payload): Promise<void> {
    const type = String(p.type ?? '');
    const message = String(p.message ?? '').replace(/\s+/g, ' ').trim();
    const details = String(p.details ?? '').trim();
    const conf = getConfig();
    if (!conf.types.some((t) => t.id === type)) {
      throw new Error('Tipo de commit inválido.');
    }
    if (!message) {
      throw new Error('Escreva uma mensagem para o commit.');
    }
    if (conf.maxLen > 0 && message.length > conf.maxLen) {
      throw new Error(`A mensagem passa de ${conf.maxLen} caracteres (${message.length}).`);
    }
    if ((await currentOperation(root)) !== 'none') {
      throw new Error('Termine a atualização em andamento (botão "Continuar") antes de fazer um novo commit.');
    }
    const files = await readStatus(root);
    if (!files.some((f) => f.staged && !f.conflict)) {
      throw new Error('Marque pelo menos um arquivo para incluir no commit.');
    }
    const args = ['commit', '-m', `${type}: ${message}`];
    if (details) {
      args.push('-m', details);
    }
    await git(root, args);
    this.post({ type: 'committed' });
    if (p.push) {
      await this.doPush(root);
    } else {
      this.toast(`Commit salvo: ${type}: ${message}`);
    }
  }

  private async doUpdate(root: string, p: Payload): Promise<void> {
    const mode = p.mode === 'merge' ? 'merge' : 'rebase';
    const base = String(p.base ?? '');
    const branches = await listBranches(root);
    if (!base || ![...branches.local, ...branches.remote].includes(base)) {
      throw new Error('Escolha de qual branch trazer as novidades.');
    }
    if ((await currentOperation(root)) !== 'none') {
      throw new Error('Já existe uma atualização em andamento. Termine ou cancele antes.');
    }
    const detail =
      mode === 'rebase'
        ? `Seus commits serão reaplicados por cima de "${base}", deixando o histórico em linha reta.\n\n` +
          'Atenção: o histórico da sua branch é reescrito. Se ela já foi enviada para a nuvem, depois será preciso um envio forçado. ' +
          'Se aparecer conflito, você resolve pelo painel e pode cancelar a qualquer momento.'
        : `As novidades de "${base}" serão misturadas na sua branch, e pode ser criado um commit de junção.\n\n` +
          'É a opção mais segura quando a branch já foi enviada ou outras pessoas a usam. Se aparecer conflito, você resolve pelo painel.';
    const pick = await ui.warn(
      mode === 'rebase' ? `Atualizar com Rebase a partir de "${base}"?` : `Atualizar com Merge a partir de "${base}"?`,
      { modal: true, detail },
      'Continuar'
    );
    if (pick !== 'Continuar') {
      return;
    }
    try {
      await git(root, ['fetch', '--prune']);
    } catch {
      /* sem rede ou sem remoto: segue com o que já existe localmente */
    }
    await this.integrate(root, mode, base);
  }

  private async doResolve(root: string, file: string): Promise<void> {
    const state = await readState(root);
    if (!state.conflicts.includes(file)) {
      return;
    }
    await git(root, ['add', '--', file]);
  }

  private async doContinue(root: string): Promise<void> {
    const op = await currentOperation(root);
    const status = await readStatus(root);
    if (status.some((f) => f.conflict)) {
      throw new Error('Ainda há arquivos em conflito. Resolva todos e marque como resolvidos.');
    }
    try {
      if (op === 'rebase') {
        await git(root, ['rebase', '--continue']);
      } else if (op === 'merge') {
        await git(root, ['commit', '--no-edit']);
      } else {
        return;
      }
      this.toast('Pronto! Sua branch foi atualizada ✔');
    } catch (e) {
      if ((await currentOperation(root)) !== 'none' && (await readStatus(root)).some((f) => f.conflict)) {
        void ui.warn('Quick Git: há mais conflitos para resolver no próximo passo.');
        return;
      }
      throw e;
    }
  }

  private async doAbort(root: string): Promise<void> {
    const op = await currentOperation(root);
    if (op === 'none') {
      return;
    }
    const pick = await ui.warn(
      'Cancelar a atualização?',
      {
        modal: true,
        detail: 'Sua branch volta exatamente ao que era antes de você começar. Nenhum trabalho é perdido.',
      },
      'Cancelar atualização'
    );
    if (pick !== 'Cancelar atualização') {
      return;
    }
    await git(root, op === 'rebase' ? ['rebase', '--abort'] : ['merge', '--abort']);
    this.toast('Atualização cancelada. Tudo voltou como era ✔');
  }

  private async doUndoCommit(root: string): Promise<void> {
    const state = await readState(root);
    if (!state.canUndoCommit) {
      throw new Error('Só é possível desfazer commits que ainda não foram enviados para a nuvem.');
    }
    const lastSubject = await git(root, ['log', '-1', '--format=%s']).catch(() => '');
    const pick = await ui.warn(
      'Desfazer o último commit?',
      {
        modal: true,
        detail: `"${lastSubject}" deixa de ser um commit, mas as alterações continuam nos seus arquivos, prontas para um novo commit.`,
      },
      'Desfazer commit'
    );
    if (pick !== 'Desfazer commit') {
      return;
    }
    await git(root, ['reset', '--soft', 'HEAD~1']);
    this.toast('Commit desfeito. Suas alterações continuam aqui ✔');
  }

  /** Reabre o guia inicial no painel (comando e botão do topo). */
  openGuide(): void {
    this.post({ type: 'openGuide' });
  }

  // ---------- Detalhes de um commit ----------

  private async sendCommitDetails(root: string, hash: string): Promise<void> {
    if (!isHash(hash)) {
      return;
    }
    const details = await readCommitDetails(root, hash);
    this.post({ type: 'commitDetails', details });
  }

  private async openCommitDiff(root: string, hash: string, file: string): Promise<void> {
    if (!isHash(hash)) {
      return;
    }
    const details = await readCommitDetails(root, hash);
    const entry = details.files.find((f) => f.path === file);
    if (!entry) {
      return;
    }
    const parent = await git(root, ['rev-parse', '--verify', '-q', `${hash}^1`]).catch(() => '');
    const mk = (rev: string | undefined, name: string): vscode.Uri =>
      vscode.Uri.from({
        scheme: DIFF_SCHEME,
        path: '/' + name,
        query: JSON.stringify({ root, ref: rev ? 'rev' : 'none', rev, file: name }),
      });
    const leftName = entry.oldPath ?? entry.path;
    const left = entry.status === 'A' || !parent ? mk(undefined, leftName) : mk(parent, leftName);
    const right = entry.status === 'D' ? mk(undefined, entry.path) : mk(hash, entry.path);
    const short = hash.slice(0, 7);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file)} (antes ↔ ${short})`);
  }

  // ---------- Guia inicial (onboarding) ----------

  private async onboardingInfo(root: string | undefined, hasFolder: boolean): Promise<Payload> {
    const cwd = root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const gitVersion = await git(cwd, ['--version'])
      .then((v) => v.replace(/^git version\s*/, ''))
      .catch(() => null);
    const cfg = async (key: string): Promise<string> => (gitVersion ? git(cwd, ['config', key]).catch(() => '') : '');
    const [userName, userEmail] = await Promise.all([cfg('user.name'), cfg('user.email')]);

    let login: string | undefined;
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
      login = session?.account.label;
    } catch {
      login = undefined;
    }

    let hasRemote = false;
    if (root) {
      hasRemote = (await git(root, ['remote']).catch(() => '')).trim() !== '';
    }
    return {
      done: this.globalState.get<boolean>(ONBOARDING_KEY, false),
      gitVersion,
      userName,
      userEmail,
      hasFolder,
      isRepo: !!root,
      hasRemote,
      github: { signedIn: !!login, login },
    };
  }

  private async setIdentity(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    try {
      const currentName = await git(cwd, ['config', 'user.name']).catch(() => '');
      const currentEmail = await git(cwd, ['config', 'user.email']).catch(() => '');
      const name = await ui.input({
        title: 'Seu nome (1/2)',
        prompt: 'Este nome aparece nos commits que você faz',
        value: currentName,
        placeHolder: 'Maria Silva',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : 'Informe seu nome.'),
      });
      if (!name) {
        return;
      }
      const email = await ui.input({
        title: 'Seu e-mail (2/2)',
        prompt: 'Use o mesmo e-mail da sua conta do GitHub para os commits aparecerem no seu perfil',
        value: currentEmail,
        placeHolder: 'voce@email.com',
        ignoreFocusOut: true,
        validateInput: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : 'Informe um e-mail válido.'),
      });
      if (!email) {
        return;
      }
      await git(cwd, ['config', '--global', 'user.name', name.trim()]);
      await git(cwd, ['config', '--global', 'user.email', email.trim()]);
      this.toast('Nome e e-mail salvos ✔');
    } catch (e) {
      this.showError(e);
    }
    await this.refresh(true);
  }

  private async githubSignIn(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
      this.toast(`Conectado ao GitHub como ${session.account.label} ✔`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(raw)) {
        this.showError(e);
      }
    }
    await this.refresh(true);
  }

  private async createGithubRepo(root: string): Promise<void> {
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    const name = await ui.input({
      title: 'Nome do repositório no GitHub',
      prompt: 'Letras, números, hífen, ponto e sublinhado',
      value: path.basename(root).replace(/[^A-Za-z0-9._-]+/g, '-'),
      ignoreFocusOut: true,
      validateInput: (v) => (/^[A-Za-z0-9._-]{1,100}$/.test(v.trim()) ? undefined : 'Use apenas letras, números, hífen, ponto e sublinhado.'),
    });
    if (!name) {
      return;
    }
    const visibility = await ui.pick(
      [
        { label: '$(lock) Privado', description: 'Só você (e quem você convidar) vê', value: true },
        { label: '$(globe) Público', description: 'Qualquer pessoa pode ver', value: false },
      ],
      { title: 'Quem pode ver este repositório?', ignoreFocusOut: true }
    );
    if (!visibility) {
      return;
    }

    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'quick-git-commit-vscode',
      },
      body: JSON.stringify({ name: name.trim(), private: visibility.value }),
    });
    if (response.status === 422) {
      throw new Error('Você já tem um repositório com esse nome no GitHub. Escolha outro nome.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('O GitHub não autorizou a criação. Entre novamente na sua conta e tente de novo.');
    }
    if (!response.ok) {
      throw new Error(`O GitHub respondeu com erro ${response.status}. Tente novamente em instantes.`);
    }
    const created = (await response.json()) as { clone_url: string; html_url: string };

    const remotes = (await git(root, ['remote'])).split('\n').filter(Boolean);
    if (remotes.includes('origin')) {
      await git(root, ['remote', 'set-url', 'origin', created.clone_url]);
    } else {
      await git(root, ['remote', 'add', 'origin', created.clone_url]);
    }

    const branch = await git(root, ['branch', '--show-current']);
    const hasCommits = await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD']);
    if (hasCommits && branch) {
      await git(root, ['push', '-u', 'origin', branch]);
      this.toast(`Repositório criado e enviado: ${created.html_url} ✔`);
    } else {
      this.toast('Repositório criado e conectado ✔ Faça o primeiro commit e clique em "Enviar".');
    }
  }
}
