import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { createRestorePoint, git, getRepoRoot, readRestorePoints, restoreToPoint, RestorePointInfo } from '../git';
import { tr, ui } from '../i18n';
import { Finding, Severity, scan, summarize } from './scanner';

export type GateLevel = 'off' | 'critical' | 'high';

const ICON: Record<Severity, string> = { critical: '$(error)', high: '$(warning)', medium: '$(info)', low: '$(circle-small)' };
const LABEL: Record<Severity, string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' };
const AGENT_RE = /^[A-Za-z0-9 _.-]{1,24}$/;
const IGNORED_DIRS = /[\\/](\.git|node_modules|out|dist|build|\.next|__pycache__|\.venv|venv|target)[\\/]/;

export function aiConfig(): { enabled: boolean; quietSeconds: number; gate: GateLevel } {
  const c = vscode.workspace.getConfiguration('quickGitCommit.aiGuard');
  const gate = c.get<string>('commitGate', 'critical');
  return {
    enabled: c.get<boolean>('enabled', true),
    quietSeconds: Math.max(1, Math.floor(Number(c.get('quietSeconds', 3))) || 3),
    gate: gate === 'off' || gate === 'high' ? gate : 'critical',
  };
}

export interface ScanResult {
  findings: Finding[];
  files: string[];
  hash: string;
}

/** Lê as mudanças do projeto e roda o verificador. `stagedOnly` = só o que entraria no commit. */
export async function collect(root: string, stagedOnly: boolean): Promise<ScanResult> {
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  const base = ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames'];
  const diff = await git(root, stagedOnly ? [...base, '--cached'] : hasHead ? [...base, 'HEAD'] : [...base, '--cached'], { raw: true }).catch(() => '');
  let untracked: string[] = [];
  if (!stagedOnly) {
    const out = await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { raw: true }).catch(() => '');
    untracked = out.split('\0').filter(Boolean);
  }
  const files = [...new Set([...(diff.match(/^diff --git a\/.+? b\/(.+)$/gm) ?? []).map((l) => l.replace(/^diff --git a\/.+? b\//, '')), ...untracked])];
  return { findings: scan({ diff, untracked }), files, hash: createHash('sha1').update(diff).update(untracked.join('\n')).digest('hex') };
}

function counts(f: Finding[]): string {
  const s = summarize(f);
  const parts: string[] = [];
  if (s.critical) {
    parts.push(tr(`${s.critical} crítico(s)`));
  }
  if (s.high) {
    parts.push(tr(`${s.high} alto(s)`));
  }
  if (s.medium + s.low) {
    parts.push(tr(`${s.medium + s.low} para conferir`));
  }
  return parts.join(', ');
}

/** Porta de segurança do commit: avisa antes de commitar segredos/riscos. Devolve false se o usuário desistir. */
export async function confirmSafeToCommit(root: string, willStageAll: boolean): Promise<boolean> {
  const { gate } = aiConfig();
  if (gate === 'off') {
    return true;
  }
  let result: ScanResult;
  try {
    result = await collect(root, !willStageAll);
  } catch {
    return true; // o verificador nunca deve impedir um commit por falha própria
  }
  const risky = result.findings.filter((f) => f.severity === 'critical' || (gate === 'high' && f.severity === 'high'));
  if (risky.length === 0) {
    return true;
  }
  const list = risky
    .slice(0, 6)
    .map((f) => `• ${f.file}${f.line ? `:${f.line}` : ''} — ${tr(f.message)}`)
    .join('\n');
  const more = risky.length > 6 ? `\n… +${risky.length - 6}` : '';
  const pick = await ui.warn('Encontramos riscos nas mudanças que vão para este commit.', { modal: true, detail: `${list}${more}` }, 'Revisar agora', 'Commitar mesmo assim');
  if (pick === 'Commitar mesmo assim') {
    return true;
  }
  if (pick === 'Revisar agora') {
    await vscode.commands.executeCommand('quickGitCommit.aiReview');
  }
  return false;
}

interface Item extends vscode.QuickPickItem {
  act?: 'commit' | 'restore' | 'snapshot' | 'refresh';
  finding?: Finding;
}

export interface PanelData {
  agent: string;
  ts: number;
  files: string[];
  findings: Finding[];
  canUndo: boolean;
}

export class AiGuard implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly notified = new Map<string, Set<string>>(); // riscos já avisados, por raiz
  private readonly seen = new Map<string, string>(); // raiz → hash já mostrado/ignorado
  private readonly startPoint = new Map<string, RestorePointInfo>(); // raiz → ponto salvo antes da IA
  private readonly userSaved = new Map<string, number>();
  private readonly status: vscode.StatusBarItem;
  private agent = 'IA';

  constructor(
    private readonly extensionId: string,
    private readonly onChange: () => void,
    private readonly onResult: (d: PanelData) => void = () => undefined
  ) {
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1);
    this.status.command = 'quickGitCommit.aiReview';
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const onFs = (uri: vscode.Uri): void => this.touched(uri);
    this.disposables.push(
      this.status,
      watcher,
      watcher.onDidChange(onFs),
      watcher.onDidCreate(onFs),
      watcher.onDidDelete(onFs),
      // Salvar à mão no editor não conta como "IA mexeu".
      vscode.workspace.onDidSaveTextDocument((d) => this.userSaved.set(d.uri.fsPath, Date.now())),
      vscode.window.registerUriHandler({ handleUri: (uri) => this.handleUri(uri) })
    );
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    this.disposables.forEach((d) => d.dispose());
  }

  private touched(uri: vscode.Uri): void {
    if (!aiConfig().enabled || uri.scheme !== 'file' || IGNORED_DIRS.test(uri.fsPath)) {
      return;
    }
    const saved = this.userSaved.get(uri.fsPath);
    if (saved && Date.now() - saved < 1500) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return;
    }
    const key = folder.uri.fsPath;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => void this.review(key, { quiet: true }), aiConfig().quietSeconds * 1000)
    );
  }

  /** vscode://<extensão>/ai-start|ai-done?agent=claude — chamado pelos ganchos (hooks) das ferramentas de IA. */
  private async handleUri(uri: vscode.Uri): Promise<void> {
    const raw = new URLSearchParams(uri.query).get('agent') ?? '';
    this.agent = AGENT_RE.test(raw) ? raw : 'IA';
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      return;
    }
    if (uri.path === '/ai-start') {
      await this.saveStart(folder);
    } else if (uri.path === '/ai-done') {
      clearTimeout(this.timers.get(folder));
      await this.review(folder, { quiet: false });
    }
  }

  private async saveStart(folder: string): Promise<void> {
    const root = await getRepoRoot(folder).catch(() => undefined);
    if (!root) {
      return;
    }
    try {
      this.startPoint.set(root, await createRestorePoint(root, `Antes da IA (${this.agent})`, true));
      this.seen.delete(root);
    } catch {
      /* sem ponto de partida: o resto continua funcionando */
    }
  }

  /** `quiet`: veio do monitor de arquivos (só avisa se houver risco); senão, abre a revisão direto. */
  async review(folder: string, opts: { quiet: boolean; manual?: boolean }): Promise<void> {
    const root = await getRepoRoot(folder).catch(() => undefined);
    if (!root) {
      return;
    }
    const result = await collect(root, false).catch(() => undefined);
    if (!result) {
      return;
    }
    this.onChange();
    this.emit(root, result);
    if (result.files.length === 0) {
      this.notified.delete(root);
      this.status.hide();
      if (opts.manual) {
        ui.info('Nenhuma mudança para revisar.');
      }
      return;
    }
    const s = summarize(result.findings);
    this.status.text = `$(shield) ${s.critical + s.high > 0 ? `${s.critical + s.high} ⚠` : tr('Revisar IA')}`;
    this.status.tooltip = tr('Revisar o que a IA mudou');
    this.status.backgroundColor = s.critical ? new vscode.ThemeColor('statusBarItem.errorBackground') : s.high ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.status.show();

    if (opts.manual) {
      return this.show(root, result);
    }
    // Alerta imediato: só avisa de riscos graves que ainda não foram avisados (sem repetir nem encher a tela).
    const keyOf = (f: Finding): string => `${f.rule}|${f.file}|${f.line ?? ''}|${f.snippet ?? ''}`;
    const known = this.notified.get(root) ?? new Set<string>();
    this.notified.set(root, known);
    const fresh = result.findings.filter((f) => (f.severity === 'critical' || f.severity === 'high') && !known.has(keyOf(f)));
    fresh.forEach((f) => known.add(keyOf(f)));
    if (opts.quiet && (fresh.length === 0 || this.seen.get(root) === result.hash)) {
      return;
    }
    this.seen.set(root, result.hash);
    const risky = s.critical + s.high > 0;
    let title: string;
    if (fresh.length === 1) {
      title = `${this.agent}: ${fresh[0].file}${fresh[0].line ? `:${fresh[0].line}` : ''} — ${tr(fresh[0].message)}`;
    } else if (fresh.length > 1) {
      title = tr(`${this.agent}: ${fresh.length} novos riscos encontrados, o primeiro em ${fresh[0].file}.`);
    } else {
      title = tr(`${this.agent} terminou: ${result.files.length} arquivo(s) mudaram.`);
    }
    const pick = await (risky ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(title, tr('Ver na aba IA'), tr('Agora não'));
    if (pick === tr('Ver na aba IA')) {
      await vscode.commands.executeCommand('quickGitCommit.aiFocus');
    }
  }

  private emit(root: string, r: ScanResult): void {
    this.onResult({ agent: this.agent, ts: Date.now(), files: r.files, findings: r.findings, canUndo: this.startPoint.has(root) });
  }

  /** Atualiza a aba "Revisão IA" do painel, sem abrir janelas. */
  async scanOnly(folder: string): Promise<void> {
    const root = await getRepoRoot(folder).catch(() => undefined);
    const result = root ? await collect(root, false).catch(() => undefined) : undefined;
    if (root && result) {
      this.emit(root, result);
    }
  }

  async undoFor(folder: string): Promise<void> {
    const root = await getRepoRoot(folder).catch(() => undefined);
    if (!root) {
      return;
    }
    const start = this.startPoint.get(root) ?? (await readRestorePoints(root).catch(() => [])).find((p) => p.auto && /^Antes da IA/.test(p.name));
    await this.undoAll(root, start);
    await this.scanOnly(folder);
  }

  private async show(root: string, result: ScanResult): Promise<void> {
    const start = this.startPoint.get(root) ?? (await readRestorePoints(root).catch(() => [])).find((p) => p.auto && /^Antes da IA/.test(p.name));
    const items: Item[] = [];
    if (result.findings.length === 0) {
      items.push({ label: '$(pass) Nenhum risco encontrado', description: tr(`${result.files.length} arquivo(s)`), detail: 'Mesmo assim, dê uma olhada no diff antes de publicar.', alwaysShow: true });
    }
    items.push({ label: '$(git-commit) Tudo certo — fazer commit', detail: 'Abre o commit rápido (os avisos críticos ainda serão checados).', act: 'commit', alwaysShow: true });
    items.push({ label: '$(history) Desfazer tudo que a IA fez', detail: start ? `Volta ao ponto "${start.name}".` : 'Não há ponto salvo antes da IA — veja "Configurar gancho".', act: 'restore', alwaysShow: true });
    items.push({ label: '$(device-camera) Salvar ponto de restauração agora', act: 'snapshot', alwaysShow: true });
    if (result.findings.length) {
      items.push({ label: tr('Riscos encontrados'), kind: vscode.QuickPickItemKind.Separator });
    }
    for (const f of result.findings) {
      items.push({
        label: `${ICON[f.severity]} ${f.file}${f.line ? `:${f.line}` : ''}`,
        description: `${tr(LABEL[f.severity])} · ${tr(f.message)}`,
        detail: f.snippet,
        finding: f,
      });
    }
    const pick = await ui.pick(items, { title: `${this.agent}: ${counts(result.findings) || tr('Nenhum risco encontrado')}`, placeHolder: 'Escolha um item para abrir o arquivo', matchOnDescription: true });
    if (!pick) {
      return;
    }
    if (pick.act === 'commit') {
      await vscode.commands.executeCommand('quickGitCommit.run');
    } else if (pick.act === 'snapshot') {
      await createRestorePoint(root, 'Ponto manual (revisão da IA)', false);
      ui.info('Ponto de restauração salvo ✔');
    } else if (pick.act === 'restore') {
      await this.undoAll(root, start);
    } else if (pick.finding) {
      const f = pick.finding;
      const uri = vscode.Uri.file(`${root}/${f.file}`);
      const line = Math.max(0, (f.line ?? 1) - 1);
      await vscode.commands.executeCommand('vscode.open', uri, { selection: new vscode.Range(line, 0, line, 0) }).then(undefined, () => undefined);
      await this.show(root, result); // volta à lista para o próximo item
    }
  }

  private async undoAll(root: string, start: RestorePointInfo | undefined): Promise<void> {
    if (!start) {
      await this.setup();
      return;
    }
    const pick = await ui.warn(
      `Voltar para "${start.name}"?`,
      { modal: true, detail: 'Os arquivos voltam ao que eram antes da IA. Arquivos criados pela IA serão apagados. Antes disso, o estado atual é salvo como um novo ponto, então dá para desfazer.' },
      'Desfazer o que a IA fez'
    );
    if (!pick) {
      return;
    }
    await createRestorePoint(root, 'Antes de desfazer a IA', true);
    await restoreToPoint(root, start, false);
    this.seen.delete(root);
    this.onChange();
    ui.info('Pronto: os arquivos voltaram ao estado antes da IA ✔');
  }

  /** Mostra e copia o trecho de configuração que liga o Claude Code/Codex à extensão. */
  async setup(): Promise<void> {
    const id = this.extensionId;
    const url = (p: string, a: string): string => `vscode://${id}/${p}?agent=${a}`;
    const claude = JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: `code --open-url "${url('ai-start', 'claude')}"` }] }],
          Stop: [{ hooks: [{ type: 'command', command: `code --open-url "${url('ai-done', 'claude')}"` }] }],
        },
      },
      null,
      2
    );
    const codex = `notify = ["sh", "-c", "code --open-url '${url('ai-done', 'codex')}' >/dev/null 2>&1"]`;
    const pick = await ui.pick(
      [
        { label: 'Claude Code', description: '.claude/settings.json', detail: 'Salva um ponto antes de cada pedido e abre a revisão quando a IA termina.', text: claude },
        { label: 'Codex CLI', description: '~/.codex/config.toml', detail: 'Abre a revisão quando o Codex termina (experimental — confira a sintaxe na doc do Codex).', text: codex },
      ],
      { title: 'Ligar a IA à revisão', placeHolder: 'Qual ferramenta você usa? Sem isso, o monitor de arquivos já avisa quando houver risco.' }
    );
    if (!pick) {
      return;
    }
    await vscode.env.clipboard.writeText((pick as unknown as { text: string }).text);
    ui.info(`Copiado! Cole em ${pick.description}. O comando "code" precisa estar no PATH (VS Code: "Shell Command: Install 'code' command").`);
  }
}
