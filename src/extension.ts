import * as vscode from 'vscode';
import { setGitLogger } from './git';
import { runQuickCommit } from './quickCommit';
import { DIFF_SCHEME, GitContentProvider, QuickGitViewProvider } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Quick Git Commit');
  setGitLogger((line) => output.appendLine(line));

  const provider = new QuickGitViewProvider(context.extensionUri, output);

  const quickCommit = vscode.commands.registerCommand('quickGitCommit.run', () => runQuickCommit(() => void provider.refresh(true)));
  const openPanel = vscode.commands.registerCommand('quickGitCommit.openPanel', () =>
    vscode.commands.executeCommand('workbench.view.extension.quickGitCommit')
  );
  const refresh = vscode.commands.registerCommand('quickGitCommit.refresh', () => provider.refresh(true));

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.text = '$(git-commit) Quick Commit';
  statusBarItem.tooltip = 'Quick Git Commit: commit padronizado em poucos cliques';
  statusBarItem.command = 'quickGitCommit.run';
  statusBarItem.show();

  context.subscriptions.push(
    output,
    provider,
    quickCommit,
    openPanel,
    refresh,
    statusBarItem,
    vscode.window.registerWebviewViewProvider(QuickGitViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, new GitContentProvider())
  );
}

export function deactivate(): void {}
