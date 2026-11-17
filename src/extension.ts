import * as vscode from 'vscode';
import { setGitAuth, setGitLogger } from './git';
import { runQuickCommit } from './quickCommit';
import { tr } from './i18n';
import { DIFF_SCHEME, GitContentProvider, QuickGitViewProvider } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Quick Git Commit');
  setGitLogger((line) => output.appendLine(line));

  // Se o usuário entrou no GitHub pelo painel, entrega esse login ao Git (somente para github.com, só em memória).
  setGitAuth(async () => {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
      if (!session) {
        return undefined;
      }
      const basic = Buffer.from(`x-access-token:${session.accessToken}`).toString('base64');
      return {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      };
    } catch {
      return undefined;
    }
  });

  const provider = new QuickGitViewProvider(context.extensionUri, output, context.globalState);

  const quickCommit = vscode.commands.registerCommand('quickGitCommit.run', () => runQuickCommit(() => void provider.refresh(true)));
  const openPanel = vscode.commands.registerCommand('quickGitCommit.openPanel', () =>
    vscode.commands.executeCommand('workbench.view.extension.quickGitCommit')
  );
  const refresh = vscode.commands.registerCommand('quickGitCommit.refresh', () => provider.refresh(true));
  const guide = vscode.commands.registerCommand('quickGitCommit.guide', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.quickGitCommit');
    provider.openGuide();
  });

  const act = (id: string, type: string) => vscode.commands.registerCommand(id, () => provider.action(type));
  const fetchCmd = act('quickGitCommit.fetch', 'fetch');
  const pullCmd = act('quickGitCommit.pull', 'pull');
  const pushCmd = act('quickGitCommit.push', 'push');
  const stageFile = vscode.commands.registerCommand('quickGitCommit.stageFile', (uri?: vscode.Uri, all?: vscode.Uri[]) => {
    const list = all && all.length > 0 ? all : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
    return provider.stageUris(list);
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.text = '$(git-commit) Quick Commit';
  statusBarItem.command = 'quickGitCommit.run';
  const applyStatusBar = (): void => {
    const label = tr('Quick Git Commit: commit padronizado em poucos cliques');
    statusBarItem.tooltip = label;
    statusBarItem.accessibilityInformation = { label, role: 'button' };
  };
  applyStatusBar();
  statusBarItem.show();

  context.subscriptions.push(
    output,
    provider,
    quickCommit,
    openPanel,
    refresh,
    guide,
    fetchCmd,
    pullCmd,
    pushCmd,
    stageFile,
    statusBarItem,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quickGitCommit') || e.affectsConfiguration('workbench.language')) {
        provider.onConfigChanged();
        applyStatusBar();
      }
    }),
    vscode.window.registerWebviewViewProvider(QuickGitViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, new GitContentProvider())
  );
}

export function deactivate(): void {}
