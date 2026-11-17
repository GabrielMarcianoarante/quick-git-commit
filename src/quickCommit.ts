import * as vscode from 'vscode';
import { git, gitOk, getRepoRoot } from './git';

const COMMIT_TYPES: { label: string; description: string }[] = [
  { label: 'feat', description: 'Nova funcionalidade' },
  { label: 'fix', description: 'Correção de bug' },
  { label: 'docs', description: 'Mudanças na documentação' },
  { label: 'style', description: 'Formatação, sem alterar lógica' },
  { label: 'refactor', description: 'Refatoração de código' },
  { label: 'chore', description: 'Tarefas de manutenção e build' },
];

async function pickWorkspaceFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Quick Git Commit: abra uma pasta no VS Code primeiro.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  const picked = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
    { placeHolder: 'Escolha o repositório' }
  );
  return picked?.description;
}

/** Retorna false se o usuário cancelou. */
async function chooseBranch(cwd: string): Promise<boolean> {
  const current = (await git(cwd, ['branch', '--show-current'])) || '(HEAD destacado)';

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(git-branch) Manter branch atual', description: current, id: 'keep' },
      { label: '$(arrow-swap) Trocar para outra branch local', id: 'switch' },
      { label: '$(add) Criar nova branch', id: 'create' },
    ],
    { placeHolder: `Branch atual: ${current}`, title: 'Quick Commit (1/4): Branch' }
  );
  if (!action) {
    return false;
  }

  if (action.id === 'switch') {
    const output = await git(cwd, ['branch', '--format=%(refname:short)']);
    const branches = output
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b && b !== current);
    if (branches.length === 0) {
      vscode.window.showInformationMessage('Não há outras branches locais.');
      return false;
    }
    const target = await vscode.window.showQuickPick(branches, {
      placeHolder: 'Escolha a branch de destino',
      title: 'Quick Commit (1/4): Trocar de branch',
    });
    if (!target) {
      return false;
    }
    await git(cwd, ['checkout', target]);
  }

  if (action.id === 'create') {
    const name = await vscode.window.showInputBox({
      prompt: 'Nome da nova branch',
      placeHolder: 'feat/minha-feature',
      title: 'Quick Commit (1/4): Nova branch',
      validateInput: async (value) => {
        const v = value.trim();
        if (!v) {
          return 'Informe um nome para a branch.';
        }
        const valid = await gitOk(cwd, ['check-ref-format', '--branch', v]);
        return valid ? undefined : 'Nome de branch inválido.';
      },
    });
    if (!name) {
      return false;
    }
    await git(cwd, ['checkout', '-b', name.trim()]);
  }

  return true;
}

async function chooseType(): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(COMMIT_TYPES, {
    placeHolder: 'Selecione o tipo do commit',
    title: 'Quick Commit (2/4): Prefixo',
  });
  return picked?.label;
}

async function askMessage(type: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: `Mensagem do commit (será gravado como "${type}: ...")`,
    placeHolder: 'descreva a mudança',
    title: 'Quick Commit (3/4): Mensagem',
    validateInput: (value) => (value.trim() ? undefined : 'A mensagem não pode ser vazia.'),
  });
}

async function chooseFinalAction(): Promise<'commit' | 'push' | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(check) Commit', description: 'Apenas salvar localmente', id: 'commit' as const },
      { label: '$(cloud-upload) Commit & Push', description: 'Salvar e enviar ao remoto', id: 'push' as const },
    ],
    { placeHolder: 'O que deseja fazer?', title: 'Quick Commit (4/4): Ação' }
  );
  return picked?.id;
}

async function pushCurrentBranch(cwd: string): Promise<void> {
  const hasUpstream = await gitOk(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (hasUpstream) {
    await git(cwd, ['push']);
  } else {
    const branch = await git(cwd, ['branch', '--show-current']);
    await git(cwd, ['push', '-u', 'origin', branch]);
  }
}

/** Fluxo rápido por menus (Command Palette / botão da Status Bar). */
export async function runQuickCommit(onDone?: () => void): Promise<void> {
  const folder = await pickWorkspaceFolder();
  if (!folder) {
    return;
  }

  try {
    const cwd = await getRepoRoot(folder);
    if (!cwd) {
      vscode.window.showErrorMessage('Quick Git Commit: esta pasta não é um repositório Git.');
      return;
    }

    const status = await git(cwd, ['status', '--porcelain']);
    if (!status) {
      vscode.window.showInformationMessage('Quick Git Commit: não há alterações para commitar.');
      return;
    }

    if (!(await chooseBranch(cwd))) {
      return;
    }

    const type = await chooseType();
    if (!type) {
      return;
    }

    const message = await askMessage(type);
    if (!message) {
      return;
    }

    const action = await chooseFinalAction();
    if (!action) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: action === 'push' ? 'Commit & Push...' : 'Commit...',
      },
      async () => {
        // Se já há arquivos em stage, respeita a seleção; senão, adiciona tudo.
        const staged = await git(cwd, ['diff', '--cached', '--name-only']);
        if (!staged) {
          await git(cwd, ['add', '-A']);
        }

        await git(cwd, ['commit', '-m', `${type}: ${message.trim()}`]);

        if (action === 'push') {
          await pushCurrentBranch(cwd);
        }
      }
    );

    vscode.window.showInformationMessage(
      action === 'push'
        ? `Commit realizado e enviado: ${type}: ${message.trim()}`
        : `Commit realizado: ${type}: ${message.trim()}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Quick Git Commit: ${msg}`);
  } finally {
    onDone?.();
  }
}
