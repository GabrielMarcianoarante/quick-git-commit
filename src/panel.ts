import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { getConfig, settingsPayload } from './config';
import { currentLang, tr, ui } from './i18n';
import { getAvailableUpdate, ignoreAvailableUpdate, onDidChangeUpdate, openUpdatePage } from './updateCheck';
import { isMissingWorkflowScope, resolveMissingWorkflowScope } from './githubScope';
import {
  git,
  isHash,
  isSafeBranch,
  redact,
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
  if (isMissingWorkflowScope(raw)) {
    return 'O GitHub bloqueou o envio: falta a permissão "workflow" na sua conta conectada. Tente "Enviar" de novo para autorizar.';
  }
  if (m.includes('protected branch') || m.includes('gh006') || m.includes('pre-receive hook declined') || m.includes('remote rejected')) {
    return 'A nuvem recusou o envio: esta branch é protegida ou você não tem permissão para escrever nela. Crie uma branch sua e abra um Pull Request.';
  }
  if (m.includes('error: 403') || m.includes('returned error: 403') || m.includes('access denied') || m.includes('not allowed')) {
    return 'Você não tem permissão para acessar/alterar esta branch ou repositório (acesso negado). Peça acesso ao responsável pelo repositório.';
  }
  if (m.includes('repository not found') || m.includes('error: 404')) {
    return 'Repositório não encontrado ou sem acesso para a sua conta. Confirme o endereço e peça acesso, se necessário.';
  }
  if (m.includes('did not match any') || m.includes('invalid reference')) {
    return 'Essa branch não existe mais neste computador nem na nuvem. Atualize a lista (verificar novidades) e tente de novo.';
  }
  if (m.includes('already checked out') || m.includes('is already used by worktree')) {
    return 'Essa branch já está aberta em outra pasta de trabalho (worktree). Feche-a lá ou escolha outra branch.';
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
      const q = JSON.parse(uri.query) as { root: string; ref: 'HEAD' | 'index' | 'none' | 'rev' | 'ours' | 'theirs'; file: string; rev?: string };
      if (q.ref === 'none') {
        return '';
      }
      let spec = q.ref === 'HEAD' ? `HEAD:${q.file}` : `:${q.file}`;
      if (q.ref === 'ours') {
        spec = `:2:${q.file}`;
      } else if (q.ref === 'theirs') {
        spec = `:3:${q.file}`;
      }
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
    this.disposables.push(onDidChangeUpdate((u) => this.post({ type: 'update', update: u })));
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
    const nonce = randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, 'x');
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
    <div id="updateBanner"></div>
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
            <label class="label" for="scopeInput">Escopo <span class="muted">(opcional)</span></label>
            <input id="scopeInput" type="text" list="scopeSuggestions" placeholder="ex.: login, api, painel" autocomplete="off" spellcheck="false" aria-label="Escopo do commit">
            <datalist id="scopeSuggestions"></datalist>
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

      <details class="section" data-key="branches">
        <summary id="secBranches"><span class="sTitle" data-icon="branch">Branches</span><span id="branchesBadge" class="badges"></span></summary>
        <div class="sBody">
          <div class="row"><button id="btnPR" class="btn primary grow" type="button"></button><button id="btnCleanMerged" class="btn secondary grow" type="button"></button></div>
          <div id="branchesList"></div>
        </div>
      </details>

      <details class="section" data-key="stashes" open>
        <summary id="secStashes"><span class="sTitle" data-icon="folder">Stashes</span><span id="stashesBadge" class="badges"></span></summary>
        <div class="sBody">
          <div class="row"><button id="btnStashSave" class="btn primary grow" type="button"></button></div>
          <div id="stashesList"></div>
        </div>
      </details>

      <details class="section" data-key="recovery">
        <summary id="secRecovery"><span class="sTitle" data-icon="undo">Recuperação</span><span id="recoveryBadge" class="badges"></span></summary>
        <div class="sBody">
          <p class="hint">Escolha um momento perdido para criar uma branch segura. Cada item mostra o que aconteceu e não altera a sua branch atual.</p>
          <div id="recoveryList"></div>
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
    if (isMissingWorkflowScope(raw)) {
      // O usuário resolve aqui mesmo: autoriza a permissão e o envio é refeito.
      void resolveMissingWorkflowScope(
        () => this.enqueue('Enviando para a nuvem...', (r) => this.doPush(r)),
        () => this.output.show(true)
      );
      return;
    }
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
      this.post({ type: 'update', update: getAvailableUpdate() });
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
      case 'openUpdate':
        await openUpdatePage();
        break;
      case 'ignoreUpdate':
        await ignoreAvailableUpdate(this.globalState);
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
      case 'renameBranch':
        await this.renameBranch(String(p.branch ?? ''));
        break;
      case 'deleteBranch':
        await this.deleteBranch(String(p.branch ?? ''));
        break;
      case 'cleanMerged':
        await this.cleanMerged();
        break;
      case 'openPR':
        await this.openPR(String(p.branch ?? ''));
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
        void this.enqueue('Aplicando resolução...', (r) => this.doResolve(r, String(p.path ?? ''), String(p.choice ?? '')));
        break;
      case 'compareConflict':
        void this.enqueue(undefined, (r) => this.openConflictDiff(r, String(p.path ?? '')));
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
      case 'amendCommit':
        void this.enqueue('Editando o último commit...', (r) => this.doAmendCommit(r));
        break;
      case 'revertCommit':
        void this.commitOp('revert', String(p.hash ?? ''));
        break;
      case 'cherryPickCommit':
        void this.commitOp('cherry-pick', String(p.hash ?? ''));
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
      case 'stashSave':
        void this.enqueue('Guardando alterações...', (r) => this.doStashSave(r));
        break;
      case 'stashApply':
        void this.enqueue('Recuperando stash...', (r) => this.doStash(r, String(p.stash ?? ''), 'apply'));
        break;
      case 'stashPop':
        void this.enqueue('Recuperando e removendo stash...', (r) => this.doStash(r, String(p.stash ?? ''), 'pop'));
        break;
      case 'stashDrop':
        void this.enqueue('Excluindo stash...', (r) => this.doStash(r, String(p.stash ?? ''), 'drop'));
        break;
      case 'reflogRecover':
        void this.enqueue('Recuperando ponto do histórico...', (r) => this.doReflogRecover(r, String(p.hash ?? '')));
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
      if (await currentOperation(root) !== 'none') {
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
    if (!(await isSafeBranch(root, branch))) {
      throw new Error('Nome de branch inválido.');
    }
    const branches = await listBranches(root);
    if (branches.local.includes(branch)) {
      await git(root, ['checkout', branch, '--']);
      return;
    }
    // Branch que só existe na nuvem (ex.: criada por outra pessoa): cria a cópia local ligada a ela.
    const remote = branches.remote.find((r) => r === branch);
    if (remote && !remote.endsWith('/HEAD')) {
      const local = remote.slice(remote.indexOf('/') + 1);
      if (branches.local.includes(local)) {
        await git(root, ['checkout', local]);
      } else {
        await git(root, ['checkout', '-b', local, '--track', remote]);
      }
      this.toast(`Você está na branch "${local}" ✔`);
      return;
    }
    throw new Error(`pathspec '${branch}' did not match any branch`);
  }

  // ---------- Branches: renomear, apagar, limpar mescladas, abrir Pull Request ----------
  private protectedBranch(name: string): boolean {
    return ['main', 'master', 'develop', 'dev', 'trunk'].includes(name);
  }

  private async baseBranch(root: string): Promise<string> {
    const head = await git(root, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']).catch(() => '');
    if (head.trim()) return head.trim().replace(/^origin\//, '');
    const { local, remote } = await listBranches(root);
    return ['main', 'master', 'develop'].find((b) => local.includes(b) || remote.includes(`origin/${b}`)) ?? 'main';
  }

  private async renameBranch(branch: string): Promise<void> {
    const root = await this.getRoot().catch(() => undefined);
    if (!root || !(await isSafeBranch(root, branch))) return;
    const name = await ui.input({
      title: 'Renomear branch',
      prompt: `Novo nome para a branch "${branch}"`,
      value: branch,
      validateInput: async (v) => {
        const t = v.trim();
        if (!t) return 'Informe um nome.';
        if (t === branch) return undefined;
        if (!(await gitOk(root, ['check-ref-format', '--branch', t]))) return 'Nome inválido (evite espaços e caracteres especiais).';
        return (await gitOk(root, ['rev-parse', '--verify', '-q', `refs/heads/${t}`])) ? 'Já existe uma branch com esse nome.' : undefined;
      },
    });
    if (!name || name.trim() === branch) return;
    void this.enqueue('Renomeando branch...', async (r) => {
      await git(r, ['branch', '-m', '--', branch, name.trim()]);
      this.toast(`Branch renomeada para "${name.trim()}" ✔ Se ela já estava na nuvem, a cópia de lá continua com o nome antigo.`);
    });
  }

  private async deleteBranch(branch: string): Promise<void> {
    const root = await this.getRoot().catch(() => undefined);
    if (!root || !(await isSafeBranch(root, branch))) return;
    const state = await readState(root);
    if (state.branch === branch) {
      void ui.warn('Você está nesta branch. Troque para outra antes de apagar.');
      return;
    }
    const base = await this.baseBranch(root);
    const merged = await gitOk(root, ['merge-base', '--is-ancestor', branch, base]);
    const label = merged ? 'Apagar branch' : 'Apagar mesmo assim';
    const pick = await ui.warn(
      `Apagar a branch "${branch}"?`,
      {
        modal: true,
        detail: merged
          ? 'Ela já foi mesclada, então os commits continuam na branch principal. Só o nome da branch some.'
          : 'ATENÇÃO: esta branch tem commits que ainda NÃO foram mesclados. Apagar pode fazer você perdê-los (dá para recuperar pela seção Recuperação).',
      },
      label
    );
    if (pick !== label) return;
    void this.enqueue('Apagando branch...', async (r) => {
      await git(r, ['branch', merged ? '-d' : '-D', '--', branch]);
      this.toast(`Branch "${branch}" apagada ✔`);
    });
  }

  private async cleanMerged(): Promise<void> {
    const root = await this.getRoot().catch(() => undefined);
    if (!root) return;
    const state = await readState(root);
    const base = await this.baseBranch(root);
    const out = await git(root, ['branch', '--merged', base, '--format=%(refname:short)']).catch(() => '');
    const list = out.split('\n').map((x) => x.trim()).filter((b) => b && b !== state.branch && b !== base && !this.protectedBranch(b));
    if (!list.length) {
      this.toast('Nenhuma branch mesclada para limpar.');
      return;
    }
    const button = `Apagar ${list.length}`;
    const pick = await ui.warn(
      `Apagar ${list.length} branch(es) já mesclada(s) em "${base}"?`,
      { modal: true, detail: list.join('\n') + '\n\nOs commits continuam na branch principal; só os nomes somem.' },
      button
    );
    if (pick !== button) return;
    void this.enqueue('Limpando branches...', async (r) => {
      for (const b of list) await git(r, ['branch', '-d', '--', b]).catch(() => undefined);
      this.toast(`${list.length} branch(es) limpa(s) ✔`);
    });
  }

  private async openPR(branch: string): Promise<void> {
    try {
      const root = await this.getRoot();
      if (!root) return;
      const state = await readState(root);
      const name = branch || state.branch;
      if (name && !(await isSafeBranch(root, name))) throw new Error('Nome de branch inválido.');
      if (!name || state.detached) throw new Error('Escolha uma branch antes de abrir o Pull Request.');
      const remotes = (await git(root, ['remote'])).split('\n').map((x) => x.trim()).filter(Boolean);
      const remote = remotes.includes('origin') ? 'origin' : remotes[0];
      if (!remote) throw new Error('Este projeto ainda não tem uma nuvem (remote). Adicione uma antes de abrir o Pull Request.');
      const url = (await git(root, ['remote', 'get-url', remote])).trim();
      const m = url.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[/:](.+?)(?:\.git)?\/?$/);
      if (!m) throw new Error('Não consegui entender o endereço da nuvem: ' + redact(url));
      const [, host, repo] = m;
      if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[\w.\-]+(?:\/[\w.\-]+)+$/.test(repo)) throw new Error('Endereço da nuvem com caracteres não permitidos.');
      const defaultBase = await this.baseBranch(root);
      const { remote: remoteBranches } = await listBranches(root);
      const targets = remoteBranches.filter((r) => r.startsWith(`${remote}/`) && !r.endsWith('/HEAD')).map((r) => r.slice(remote.length + 1)).filter((b) => b !== name);
      let base = defaultBase;
      if (targets.length > 1) {
        const ordered = [defaultBase, ...targets.filter((b) => b !== defaultBase)].filter((b) => targets.includes(b));
        const picked = await ui.pick(ordered.map((b) => ({ label: b, description: b === defaultBase ? 'principal' : '' })), {
          title: 'Pull Request: para qual branch?',
          placeHolder: `Escolha o destino de "${name}" (as mudanças serão propostas para ela)`,
        });
        if (!picked) return;
        base = (picked as vscode.QuickPickItem).label;
      } else if (targets.length === 1) {
        base = targets[0];
      }
      if (name === base) throw new Error(`Você está na branch principal ("${base}"). Crie ou escolha outra branch para abrir o Pull Request.`);
      const pushed = await gitOk(root, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${name}`]);
      if (!pushed) {
        const b = 'Abrir mesmo assim';
        const pick = await ui.warn(`A branch "${name}" ainda não foi enviada para a nuvem.`, { modal: true, detail: 'Envie primeiro (botão de enviar), senão o Pull Request não terá os seus commits.' }, b);
        if (pick !== b) return;
      }
      const enc = encodeURIComponent;
      let link: string;
      if (host.includes('github')) {
        link = `https://${host}/${repo}/compare/${enc(base)}...${enc(name)}?expand=1`;
      } else if (host.includes('gitlab')) {
        link = `https://${host}/${repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${enc(name)}&merge_request%5Btarget_branch%5D=${enc(base)}`;
      } else {
        throw new Error(`Só consigo abrir Pull Request no GitHub e no GitLab (nuvem encontrada: ${host}).`);
      }
      await vscode.env.openExternal(vscode.Uri.parse(link));
    } catch (e) {
      this.showError(e);
    }
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
    const mk = (ref: 'HEAD' | 'index' | 'none' | 'rev' | 'ours' | 'theirs'): vscode.Uri =>
      vscode.Uri.from({ scheme: DIFF_SCHEME, path: '/' + file, query: JSON.stringify({ root, ref, file }) });

    const base = path.basename(file);
    const stagedOnly = entry.staged && !entry.partial;
    let left: vscode.Uri;
    let right: vscode.Uri;
    let title: string;
    if (stagedOnly) {
      left = mk('HEAD');
      right = mk('index');
      title = `${base} ${tr('(antes ↔ marcado para o commit)')}`;
    } else {
      left = mk('index');
      right = fs.existsSync(abs) ? vscode.Uri.file(abs) : mk('none');
      title = `${base} ${tr('(antes ↔ agora)')}`;
    }
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  private async doCommit(root: string, p: Payload): Promise<void> {
    const type = String(p.type ?? '');
    const message = String(p.message ?? '').replace(/\s+/g, ' ').trim();
    const scope = String(p.scope ?? '').replace(/\s+/g, '').trim();
    const details = String(p.details ?? '').trim();
    const conf = getConfig();
    if (!conf.types.some((t) => t.id === type)) {
      throw new Error('Tipo de commit inválido.');
    }
    if (!message) {
      throw new Error('Escreva uma mensagem para o commit.');
    }
    if (scope && !/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(scope)) {
      throw new Error('Use um escopo curto, como login, api ou painel/perfil.');
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
    const subject = `${type}${scope ? `(${scope})` : ''}: ${message}`;
    const args = ['commit', '-m', subject];
    if (details) {
      args.push('-m', details);
    }
    await git(root, args);
    this.post({ type: 'committed' });
    if (p.push) {
      await this.doPush(root);
    } else {
      this.toast(`Commit salvo: ${subject}`);
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

  private async doResolve(root: string, file: string, choice: string): Promise<void> {
    const state = await readState(root);
    if (!state.conflicts.includes(file)) {
      return;
    }

    if (choice === 'manual') {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, file)));
      return;
    }

    if (choice === 'mine' || choice === 'theirs') {
      // No rebase o Git troca os lados: "ours" é a base que está recebendo e "theirs" são os seus commits.
      const rebase = state.operation === 'rebase';
      const side = (choice === 'mine') === !rebase ? '--ours' : '--theirs';
      await git(root, ['checkout', side, '--', file]).catch(async () => {
        await git(root, ['rm', '--', file]);
      });
      await git(root, ['add', '--', file]).catch(() => undefined);
      this.toast(choice === 'mine' ? `Mantidas as suas mudanças em \"${file}\" ✔` : `Mantidas as mudanças da outra versão em \"${file}\" ✔`);
      return;
    }

    await git(root, ['add', '--', file]);
  }

  private async openConflictDiff(root: string, file: string): Promise<void> {
    const state = await readState(root);
    if (!state.conflicts.includes(file)) {
      return;
    }
    const mk = (ref: 'ours' | 'theirs'): vscode.Uri =>
      vscode.Uri.from({ scheme: DIFF_SCHEME, path: '/' + file, query: JSON.stringify({ root, ref, file }) });

    const rebase = state.operation === 'rebase';
    const mine = mk(rebase ? 'theirs' : 'ours');
    const other = mk(rebase ? 'ours' : 'theirs');
    await vscode.commands.executeCommand(
      'vscode.diff',
      mine,
      other,
      `${path.basename(file)} ${tr('— suas mudanças ↔ mudanças da outra versão')}`
    );
  }

  private async doContinue(root: string): Promise<void> {
    const op = await currentOperation(root);
    const status = await readStatus(root);
    if (status.some((f) => f.conflict)) {
      throw new Error('Ainda há arquivos em conflito. Resolva todos antes de continuar.');
    }
    try {
      if (op === 'rebase') {
        await git(root, ['rebase', '--continue']);
      } else if (op === 'merge') {
        await git(root, ['commit', '--no-edit']);
      } else if (op === 'revert' || op === 'cherry-pick') {
        if (await gitOk(root, ['diff', '--cached', '--quiet'])) {
          // Ao manter "as suas" em todos os conflitos, nada muda: o Git não aceita continuar com um commit vazio.
          await git(root, [op, '--skip']).catch(() => git(root, [op, '--abort']));
          this.toast('Nada mudou: as mudanças deste commit já estão (ou já foram desfeitas) na sua branch.');
          return;
        }
        await git(root, [op, '--continue']);
      } else {
        return;
      }
      this.toast(op === 'revert' ? 'Commit revertido ✔ Foi criado um novo commit que desfaz as mudanças.' : op === 'cherry-pick' ? 'Commit copiado para a sua branch ✔' : 'Pronto! Sua branch foi atualizada ✔');
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
    const update = op === 'rebase' || op === 'merge';
    const button = update ? 'Cancelar atualização' : 'Cancelar operação';
    const pick = await ui.warn(
      update ? 'Cancelar a atualização?' : 'Cancelar esta operação?',
      {
        modal: true,
        detail: 'Sua branch volta exatamente ao que era antes de você começar. Nenhum trabalho é perdido.',
      },
      button
    );
    if (pick !== button) {
      return;
    }
    await git(root, [op, '--abort']);
    this.toast(update ? 'Atualização cancelada. Tudo voltou como era ✔' : 'Operação cancelada. Tudo voltou como era ✔');
  }

  private async doUndoCommit(root: string): Promise<void> {
    const state = await readState(root);
    if (!state.canUndoCommit) {
      throw new Error('Só é possível desfazer commits que ainda não foram enviados para a nuvem.');
    }
    const lastSubject = await git(root, ['log', '-1', '--format=%s']).catch(() => '');
    const pick = await ui.warn('Desfazer o último commit?', {
      modal: true,
      detail: `"${lastSubject}" deixa de ser um commit, mas as alterações continuam nos seus arquivos, prontas para um novo commit.`,
    }, 'Desfazer commit');
    if (pick !== 'Desfazer commit') return;
    await git(root, ['reset', '--soft', 'HEAD~1']);
    this.toast('Commit desfeito. Suas alterações continuam aqui ✔');
  }

  /**
   * Reverter (git revert) ou copiar (git cherry-pick) um commit, sempre explicando o efeito antes.
   * - Reverter cria um commit NOVO que desfaz o antigo (nada é apagado; seguro mesmo se já foi enviado).
   * - Copiar traz só as mudanças de um commit de outra branch para a branch atual.
   */
  /** Valida e confirma FORA da fila (sem overlay), e só então enfileira a execução. */
  private async commitOp(kind: 'revert' | 'cherry-pick', hash: string): Promise<void> {
    this.output.appendLine(`[commitOp] ${kind} ${hash}`);
    try {
      if (!isHash(hash)) {
        throw new Error('Commit inválido.');
      }
      const root = await this.getRoot();
      if (!root) {
        void ui.warn('Quick Git: abra uma pasta que seja um repositório Git.');
        return;
      }
      if (!(await this.confirmCommitOp(root, kind, hash))) return;
      void this.enqueue(kind === 'revert' ? 'Revertendo commit...' : 'Copiando commit...', (r) => this.runCommitOp(r, kind, hash));
    } catch (e) {
      this.showError(e);
    }
  }

  private async confirmCommitOp(root: string, kind: 'revert' | 'cherry-pick', hash: string): Promise<boolean> {
    const state = await readState(root);
    if (state.operation !== 'none') {
      throw new Error('Termine ou cancele a operação em andamento antes de começar outra.');
    }
    if (state.detached) {
      throw new Error('Você está fora de uma branch. Escolha uma branch no topo antes de continuar.');
    }
    if (state.files.some((f) => f.kind !== 'untracked')) {
      throw new Error('Você tem alterações ainda não salvas. Salve um commit ou use "Guardar alterações" (Stashes) antes de continuar.');
    }

    const inBranch = await gitOk(root, ['merge-base', '--is-ancestor', hash, 'HEAD']);
    if (kind === 'revert' && !inBranch) {
      throw new Error('Este commit não faz parte da branch atual, então não há o que reverter aqui. Troque para a branch onde ele foi feito.');
    }
    if (kind === 'cherry-pick' && inBranch) {
      this.toast('Este commit já está na sua branch, então não há nada para copiar.');
      return false;
    }

    const subject = await git(root, ['log', '-1', '--format=%s', hash]).catch(() => hash.slice(0, 7));
    const parents = (await git(root, ['rev-list', '--parents', '-n', '1', hash]).catch(() => '')).split(/\s+/).filter(Boolean).length - 1;
    const isMerge = parents > 1;

    const button = kind === 'revert' ? 'Reverter commit' : 'Copiar commit';
    const detail =
      kind === 'revert'
        ? 'Cria um NOVO commit que desfaz as mudanças deste commit. O commit original continua no histórico, então nada é apagado e é seguro mesmo que ele já tenha sido enviado para a nuvem.'
        : 'Copia as mudanças deste commit para a sua branch atual como um novo commit, sem trazer o resto da outra branch. O commit original não é alterado. Útil para levar uma correção de uma branch para outra.';
    const mergeNote = isMerge
      ? kind === 'revert'
        ? 'Este é um commit de junção (merge): o Git vai desfazer em relação à primeira branch.'
        : 'Este é um commit de junção (merge): o Git vai copiar em relação à primeira branch.'
      : '';
    const conflictNote = 'Se aparecer conflito, você resolve pelo painel e pode cancelar a qualquer momento.';
    const title =
      kind === 'revert' ? `Reverter o commit "${subject}"?` : `Copiar o commit "${subject}" para a branch "${state.branch}"?`;
    const pick = await ui.warn(title, { modal: true, detail: [detail, mergeNote, conflictNote].filter(Boolean).join('\n\n') }, button);
    return pick === button;
  }

  private async runCommitOp(root: string, kind: 'revert' | 'cherry-pick', hash: string): Promise<void> {
    const parents = (await git(root, ['rev-list', '--parents', '-n', '1', hash]).catch(() => '')).split(/\s+/).filter(Boolean).length - 1;
    const isMerge = parents > 1;
    const args = kind === 'revert' ? ['revert', '--no-edit'] : ['cherry-pick'];
    if (isMerge) args.push('-m', '1');
    args.push(hash);
    try {
      await git(root, args);
      this.toast(kind === 'revert' ? 'Commit revertido ✔ Foi criado um novo commit que desfaz as mudanças.' : 'Commit copiado para a sua branch ✔');
    } catch (e) {
      if ((await currentOperation(root)) === 'none') throw e;
      if ((await readStatus(root)).some((f) => f.conflict)) {
        void ui.warn('Quick Git: encontrei conflitos. Resolva os arquivos listados no painel e clique em "Continuar".');
        return;
      }
      // Parou sem conflitos: o commit não traz nada novo (as mudanças já estão, ou já foram desfeitas, na branch).
      await git(root, [kind, '--abort']).catch(() => undefined);
      this.toast('Nada mudou: as mudanças deste commit já estão (ou já foram desfeitas) na sua branch.');
    }
  }

  private async doAmendCommit(root: string): Promise<void> {
    const state = await readState(root);
    if (!state.hasCommits || state.operation !== 'none') {
      throw new Error('Não há um último commit disponível ou há uma atualização em andamento.');
    }
    const last = state.history.find((c) => c.head);
    if (!last) throw new Error('Não encontrei o último commit atual.');

    if (!last.unpushed) {
      const choice = await ui.warn('Este commit já foi enviado para a nuvem.', {
        modal: true,
        detail: 'Editar cria um novo identificador. Depois será necessário substituir o commit remoto.',
      }, 'Editar mesmo assim', 'Cancelar');
      if (choice !== 'Editar mesmo assim') return;
    }

    const action = await ui.pick([
      { label: 'Alterar somente a mensagem', description: 'Mantém os arquivos exatamente como estão' },
      { label: 'Incluir alterações marcadas', description: 'Inclui arquivos marcados no último commit' },
      { label: 'Alterar mensagem e incluir alterações', description: 'Faz os dois ao mesmo tempo' },
    ], { title: 'Editar o último commit', placeHolder: 'O que você quer corrigir?' });
    if (!action) return;

    const changeMessage = action.label !== 'Incluir alterações marcadas';
    const includeStaged = action.label !== 'Alterar somente a mensagem';
    let newMessage: string | undefined;
    if (changeMessage) {
      newMessage = await ui.input({
        prompt: 'Nova mensagem do último commit',
        value: last.subject,
        valueSelection: [0, last.subject.length],
        validateInput: (value) => value.trim() ? undefined : 'Escreva uma mensagem para o commit.',
      });
      if (newMessage === undefined) return;
      newMessage = newMessage.trim();
      if (!newMessage) throw new Error('Escreva uma mensagem para o commit.');
    }
    if (includeStaged && !state.files.some((file) => file.staged)) {
      throw new Error('Nenhum arquivo está marcado. Marque o arquivo esquecido em "Minhas alterações" e tente de novo.');
    }
    await git(root, changeMessage ? ['commit', '--amend', '-m', newMessage as string] : ['commit', '--amend', '--no-edit']);
    this.toast(changeMessage && includeStaged ? 'Último commit atualizado com mensagem e arquivos ✔' : changeMessage ? 'Mensagem do último commit atualizada ✔' : 'Arquivos marcados incluídos no último commit ✔');
  }

  openGuide(): void {
    this.post({ type: 'openGuide' });
  }

  private async sendCommitDetails(root: string, hash: string): Promise<void> {
    if (!isHash(hash)) return;
    this.post({ type: 'commitDetails', details: await readCommitDetails(root, hash) });
  }

  private async openCommitDiff(root: string, hash: string, file: string): Promise<void> {
    if (!isHash(hash)) return;
    const details = await readCommitDetails(root, hash);
    const entry = details.files.find((f) => f.path === file);
    if (!entry) return;
    const parent = await git(root, ['rev-parse', '--verify', '-q', `${hash}^1`]).catch(() => '');
    const mk = (rev: string | undefined, name: string): vscode.Uri => vscode.Uri.from({
      scheme: DIFF_SCHEME,
      path: '/' + name,
      query: JSON.stringify({ root, ref: rev ? 'rev' : 'none', rev, file: name }),
    });
    const leftName = entry.oldPath ?? entry.path;
    const left = entry.status === 'A' || !parent ? mk(undefined, leftName) : mk(parent, leftName);
    const right = entry.status === 'D' ? mk(undefined, entry.path) : mk(hash, entry.path);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file)} ${tr('(antes ↔ commit)')}`);
  }

  private async onboardingInfo(root: string | undefined, hasFolder: boolean): Promise<Payload> {
    const cwd = root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const gitVersion = await git(cwd, ['--version']).then((v) => v.replace(/^git version\s*/, '')).catch(() => null);
    const cfg = async (key: string): Promise<string> => gitVersion ? git(cwd, ['config', key]).catch(() => '') : '';
    const [userName, userEmail] = await Promise.all([cfg('user.name'), cfg('user.email')]);
    let login: string | undefined;
    try { login = (await vscode.authentication.getSession('github', ['repo'], { silent: true }))?.account.label; } catch { login = undefined; }
    let hasRemote = false;
    if (root) hasRemote = (await git(root, ['remote']).catch(() => '')).trim() !== '';
    return { done: this.globalState.get<boolean>(ONBOARDING_KEY, false), gitVersion, userName, userEmail, hasFolder, isRepo: !!root, hasRemote, github: { signedIn: !!login, login } };
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
    } catch (e) { this.showError(e); }
    await this.refresh(true);
  }

  private async githubSignIn(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
      this.toast(`Conectado ao GitHub como ${session.account.label} ✔`);
    } catch (e) {
      if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) this.showError(e);
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
    if (remotes.includes('origin')) await git(root, ['remote', 'set-url', 'origin', created.clone_url]);
    else await git(root, ['remote', 'add', 'origin', created.clone_url]);
    const branch = await git(root, ['branch', '--show-current']);
    if (await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD']) && branch) {
      await git(root, ['push', '-u', 'origin', branch]);
      this.toast(`Repositório criado e enviado: ${created.html_url} ✔`);
    } else this.toast('Repositório criado e conectado ✔');
  }

  private async doStashSave(root: string): Promise<void> {
    const name = await ui.input({ title: 'Guardar alterações temporariamente', prompt: 'Dê um nome para facilitar a recuperação', placeHolder: 'ex.: tela de login' });
    if (name === undefined) return;
    await git(root, ['stash', 'push', '-u', '-m', name.trim() || 'Alterações guardadas']);
    this.toast('Alterações guardadas temporariamente ✔');
  }

  private async doStash(root: string, stash: string, action: 'apply' | 'pop' | 'drop'): Promise<void> {
    if (!stash) throw new Error('Stash inválido.');
    if (action === 'drop') {
      const ok = await ui.warn('Excluir este stash permanentemente?', { modal: true, detail: 'As alterações guardadas serão apagadas.' }, 'Excluir stash');
      if (ok !== 'Excluir stash') return;
    }
    if (action === 'apply') {
      await git(root, ['stash', 'apply', stash]);
      this.toast('Alterações recuperadas do stash ✔');
    } else if (action === 'pop') {
      await git(root, ['stash', 'pop', stash]);
      this.toast('Alterações recuperadas e stash removido ✔');
    } else {
      await git(root, ['stash', 'drop', stash]);
      this.toast('Stash excluído ✔');
    }
  }

  private async doReflogRecover(root: string, hash: string): Promise<void> {
    if (!isHash(hash)) throw new Error('Ponto de recuperação inválido.');
    const branches = await git(root, ['branch', '--format=%(refname:short)']).catch(() => '');
    const suffix = hash.slice(0, 7);
    let name = `recovery-${suffix}`;
    let n = 2;
    while (branches.split('\n').includes(name)) name = `recovery-${suffix}-${n++}`;
    await git(root, ['branch', name, hash]);
    this.toast(`Branch recuperada: ${name} ✔`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;
