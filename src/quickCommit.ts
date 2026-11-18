import * as vscode from 'vscode';
import { git, gitOk, getRepoRoot } from './git';
import { getConfig } from './config';
import { tr, ui } from './i18n';
import { isMissingWorkflowScope, resolveMissingWorkflowScope } from './githubScope';

const KNOWN: Record<string, string> = {
  feat: 'Nova funcionalidade',
  fix: 'Correção de bug',
  docs: 'Mudanças na documentação',
  style: 'Formatação, sem alterar lógica',
  refactor: 'Refatoração de código',
  chore: 'Tarefas de manutenção e build',
};

/** Título dos passos com contagem dinâmica (alguns passos podem ser pulados pelas configurações). */
function stepTitle(n: number, name: string): string {
  const c = getConfig();
  const skipped = (c.askBranch ? 0 : 1) + (c.defaultAction === 'ask' ? 0 : 1);
  const offset = c.askBranch ? 0 : 1;
  return `Quick Commit (${n - offset}/${4 - skipped}): ${tr(name)}`;
}

async function pickWorkspaceFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    ui.error('Quick Git Commit: abra uma pasta no VS Code primeiro.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  const picked = await ui.pick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
    { placeHolder: 'Escolha o repositório' }
  );
  return picked?.description;
}

/** Retorna false se o usuário cancelou. */
async function chooseBranch(cwd: string): Promise<boolean> {
  const current = (await git(cwd, ['branch', '--show-current'])) || '(HEAD destacado)';

  const action = await ui.pick(
    [
      { label: '$(git-branch) Manter branch atual', description: current, id: 'keep' },
      { label: '$(arrow-swap) Trocar para outra branch local', id: 'switch' },
      { label: '$(add) Criar nova branch', id: 'create' },
    ],
    { placeHolder: `Branch atual: ${current}`, title: stepTitle(1, 'Branch') }
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
      ui.info('Não há outras branches locais.');
      return false;
    }
    const target = await ui.pick(branches, {
      placeHolder: 'Escolha a branch de destino',
      title: stepTitle(1, 'Trocar de branch'),
    });
    if (!target) {
      return false;
    }
    await git(cwd, ['checkout', target]);
  }

  if (action.id === 'create') {
    const name = await ui.input({
      prompt: 'Nome da nova branch',
      placeHolder: 'feat/minha-feature',
      title: stepTitle(1, 'Nova branch'),
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
  const picked = await ui.pick(
    getConfig().types.map((t) => ({ label: t.id, description: t.description ?? KNOWN[t.id] ?? '' })),
    {
      placeHolder: 'Selecione o tipo do commit',
      title: stepTitle(2, 'Prefixo'),
    }
  );
  return picked?.label;
}

async function askMessage(type: string): Promise<string | undefined> {
  return ui.input({
    prompt: `Mensagem do commit (será gravado como "${type}: ...")`,
    placeHolder: 'descreva a mudança',
    title: stepTitle(3, 'Mensagem'),
    validateInput: (value) => {
      const v = value.trim();
      const max = getConfig().maxLen;
      if (!v) {
        return 'A mensagem não pode ser vazia.';
      }
      return max > 0 && v.length > max ? `A mensagem passa de ${max} caracteres (${v.length}).` : undefined;
    },
  });
}

async function askScope(cwd: string): Promise<string | undefined> {
  const suggestions = new Set<string>();
  try {
    const status = await git(cwd, ['status', '--porcelain=v1', '-z', '-uall'], { raw: true });
    for (const entry of status.split('\0').filter(Boolean)) {
      const file = entry.slice(3);
      const parts = file.split('/');
      if (parts.length > 1) suggestions.add(parts[0]);
      if (parts.length > 2) suggestions.add(parts.slice(0, 2).join('/'));
    }
  } catch { /* sem sugestões */ }
  try {
    const log = await git(cwd, ['log', '-n', '30', '--format=%s']);
    for (const subject of log.split('\n')) {
      const match = /^[^:(]+\(([\w.-]+(?:\/[\w.-]+)?)\)/.exec(subject);
      if (match) suggestions.add(match[1]);
    }
  } catch { /* sem sugestões */ }

  const items = [
    { label: 'Sem escopo', description: 'Commit simples, sem feat(login)', id: '' },
    ...[...suggestions].sort().map((scope) => ({ label: scope, description: 'Usar escopo neste commit', id: scope })),
    { label: 'Digite outro escopo...', description: 'Informe um escopo personalizado', id: '__other__' },
  ];
  const picked = await ui.pick(items, { placeHolder: 'Escolha um escopo', title: stepTitle(3, 'Escopo') });
  if (!picked || picked.id === '') return '';
  if (picked.id !== '__other__') return picked.id;

  const scope = await ui.input({
    prompt: 'Escopo do commit',
    placeHolder: 'ex.: login, api, painel/perfil',
    validateInput: (value) => {
      const v = value.trim();
      return !v || /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(v) ? undefined : 'Use um escopo curto, como login ou painel/perfil.';
    },
  });
  return scope?.trim() || '';
}

async function chooseFinalAction(): Promise<'commit' | 'push' | undefined> {
  const preset = getConfig().defaultAction;
  if (preset !== 'ask') {
    return preset === 'commit' ? 'commit' : 'push';
  }
  const picked = await ui.pick(
    [
      { label: '$(check) Commit', description: 'Apenas salvar localmente', id: 'commit' as const },
      { label: '$(cloud-upload) Commit & Push', description: 'Salvar e enviar ao remoto', id: 'push' as const },
    ],
    { placeHolder: 'O que deseja fazer?', title: stepTitle(4, 'Ação') }
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

  let repoRoot: string | undefined;
  try {
    const cwd = await getRepoRoot(folder);
    repoRoot = cwd || undefined;
    if (!cwd) {
      ui.error('Quick Git Commit: esta pasta não é um repositório Git.');
      return;
    }

    const status = await git(cwd, ['status', '--porcelain']);
    if (!status) {
      ui.info('Quick Git Commit: não há alterações para commitar.');
      return;
    }

    if (getConfig().askBranch && !(await chooseBranch(cwd))) {
      return;
    }

    const type = await chooseType();
    if (!type) {
      return;
    }

    const scope = await askScope(cwd);
    if (scope === undefined) {
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

        const subject = `${type}${scope ? `(${scope})` : ''}: ${message.trim()}`;
        await git(cwd, ['commit', '-m', subject]);

        if (action === 'push') {
          await pushCurrentBranch(cwd);
        }
      }
    );

    ui.info(
      action === 'push'
        ? `Commit realizado e enviado: ${type}${scope ? `(${scope})` : ''}: ${message.trim()}`
        : `Commit realizado: ${type}${scope ? `(${scope})` : ''}: ${message.trim()}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (repoRoot && isMissingWorkflowScope(msg)) {
      const root = repoRoot;
      const ok = await resolveMissingWorkflowScope(() => pushCurrentBranch(root));
      if (ok) {
        ui.info('Commits enviados para a nuvem ✔');
      }
    } else {
      ui.error(`Quick Git Commit: ${msg}`);
    }
  } finally {
    onDone?.();
  }
}
