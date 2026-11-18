import * as vscode from 'vscode';
import { ui } from './i18n';

const REPO = 'GabrielMarcianoarante/quick-git-commit';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const SAFE_URL_PREFIX = `https://github.com/${REPO}/`;
const FALLBACK_URL = `https://github.com/${REPO}/releases/latest`;
const LAST_CHECK_KEY = 'updateCheck.lastCheck';
const IGNORED_KEY = 'updateCheck.ignoredVersion';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface LatestRelease {
  version: string;
  url: string;
}

/** Converte "v1.2.3" / "1.2.3-beta" em [1, 2, 3]. Retorna undefined se não for uma versão válida. */
function parseVersion(raw: string): number[] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** true se `a` é mais nova que `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] > pb[i];
    }
  }
  return false;
}

/** Consulta a última release publicada (sem rascunhos nem pré-lançamentos). `null` = ainda não existe release. */
async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const response = await fetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'quick-git-commit-vscode' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub respondeu ${response.status}`);
  }
  const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  if (!parseVersion(tag)) {
    return null;
  }
  const url = typeof data.html_url === 'string' && data.html_url.startsWith(SAFE_URL_PREFIX) ? data.html_url : FALLBACK_URL;
  return { version: tag.replace(/^v/, ''), url };
}

/**
 * Avisa quando existe uma release mais nova no GitHub. Não instala nada: o botão apenas abre a página de download.
 * Automática: no máximo 1 vez por dia, respeita `quickGitCommit.checkForUpdates` e a versão ignorada.
 * Manual (comando): sempre consulta e sempre responde.
 */
export async function checkForUpdates(context: vscode.ExtensionContext, log: (line: string) => void, manual: boolean): Promise<void> {
  const current = String(context.extension.packageJSON.version ?? '');

  if (!manual) {
    if (!vscode.workspace.getConfiguration('quickGitCommit').get<boolean>('checkForUpdates', true)) {
      return;
    }
    const last = context.globalState.get<number>(LAST_CHECK_KEY, 0);
    if (Date.now() - last < CHECK_INTERVAL_MS) {
      return;
    }
  }
  await context.globalState.update(LAST_CHECK_KEY, Date.now());

  let latest: LatestRelease | null;
  try {
    latest = await fetchLatestRelease();
  } catch (err) {
    log(`[atualização] não foi possível consultar o GitHub: ${err instanceof Error ? err.message : String(err)}`);
    if (manual) {
      await ui.warn('Não foi possível verificar atualizações agora.');
    }
    return;
  }

  if (!latest || !isNewer(latest.version, current)) {
    if (manual) {
      await ui.info(`Você já está na versão mais recente (${current}).`);
    }
    return;
  }

  if (!manual && context.globalState.get<string>(IGNORED_KEY) === latest.version) {
    return;
  }

  const download = 'Baixar atualização';
  const ignore = 'Ignorar esta versão';
  const choice = await ui.info(`Nova versão do Quick Git Commit disponível: ${latest.version}. Você está usando a ${current}.`, download, ignore);
  if (choice === download) {
    await vscode.env.openExternal(vscode.Uri.parse(latest.url));
  } else if (choice === ignore) {
    await context.globalState.update(IGNORED_KEY, latest.version);
  }
}

/** Agenda a verificação automática pouco depois de abrir o VS Code, sem atrasar a ativação. */
export function scheduleUpdateCheck(context: vscode.ExtensionContext, log: (line: string) => void): vscode.Disposable {
  const timer = setTimeout(() => void checkForUpdates(context, log, false), STARTUP_DELAY_MS);
  return new vscode.Disposable(() => clearTimeout(timer));
}
