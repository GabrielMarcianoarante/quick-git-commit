import * as vscode from 'vscode';
import { ui } from './i18n';

const BASE_SCOPES = ['repo'];
const WORKFLOW_SCOPES = ['repo', 'workflow'];

/**
 * O GitHub recusa o envio de arquivos em .github/workflows quando o login não tem a permissão "workflow":
 * "refusing to allow an OAuth App to create or update workflow `...` without `workflow` scope".
 */
export function isMissingWorkflowScope(raw: string): boolean {
  return /without\s+[`'"]?workflow[`'"]?\s+scope/i.test(raw);
}

/** Sessão do GitHub a entregar ao Git. Prefere a que já tem "workflow" (se o usuário autorizou antes). */
export async function getGithubSessionForGit(): Promise<vscode.AuthenticationSession | undefined> {
  for (const scopes of [WORKFLOW_SCOPES, BASE_SCOPES]) {
    try {
      const session = await vscode.authentication.getSession('github', scopes, { silent: true });
      if (session) {
        return session;
      }
    } catch {
      /* tenta o próximo conjunto de permissões */
    }
  }
  return undefined;
}

/** Pede ao usuário a permissão extra "workflow" (abre o login do GitHub no navegador). */
async function requestWorkflowScope(): Promise<boolean> {
  try {
    await vscode.authentication.getSession('github', WORKFLOW_SCOPES, { createIfNone: true });
    return true;
  } catch {
    return false; // login cancelado
  }
}

/**
 * Explica o bloqueio em linguagem simples e, se o usuário aceitar, autoriza e executa `retry` (o envio de novo).
 * Devolve true se o envio foi refeito com sucesso.
 */
export async function resolveMissingWorkflowScope(retry: () => Promise<void>, showDetails?: () => void): Promise<boolean> {
  const authorize = 'Autorizar e tentar de novo';
  const details = 'Ver detalhes';
  const pick = await ui.warn(
    'O GitHub bloqueou o envio porque este commit altera arquivos de automação (.github/workflows) e a sua conta conectada ainda não tem essa permissão. Seus commits continuam salvos. Quer autorizar agora?',
    authorize,
    details
  );
  if (pick === details) {
    showDetails?.();
    return false;
  }
  if (pick !== authorize) {
    return false;
  }
  if (!(await requestWorkflowScope())) {
    await ui.info('Autorização cancelada. Nada foi enviado.');
    return false;
  }
  try {
    await retry();
    return true;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    await ui.error(`Quick Git: ${raw.trim().split('\n').slice(0, 4).join('\n')}`);
    return false;
  }
}
