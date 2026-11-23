import * as vscode from 'vscode';
import { currentLang } from './i18n';

export interface CommitType {
  id: string;
  description?: string;
}
export type DefaultAction = 'ask' | 'commit' | 'commitAndPush';

const DEFAULT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'chore'];

/** Lê as configurações da extensão (quickGitCommit.*) já validadas. */
export function getConfig(): { types: CommitType[]; maxLen: number; askBranch: boolean; defaultAction: DefaultAction } {
  const c = vscode.workspace.getConfiguration('quickGitCommit');
  const raw = c.get<unknown[]>('commitTypes', DEFAULT_TYPES);
  const types: CommitType[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = r as any;
    const id = String(typeof r === 'string' ? r : o?.label ?? '').trim();
    if (/^[A-Za-z0-9][\w.-]*$/.test(id) && !types.some((t) => t.id === id)) {
      types.push({ id, description: typeof o?.description === 'string' ? o.description : undefined });
    }
  }
  if (types.length === 0) {
    types.push(...DEFAULT_TYPES.map((id) => ({ id })));
  }
  const maxLen = Math.max(0, Math.floor(Number(c.get('messageMaxLength', 72))) || 0);
  const da = c.get<string>('defaultAction', 'ask');
  return {
    types,
    maxLen,
    askBranch: c.get<boolean>('askBranch', true),
    defaultAction: da === 'commit' || da === 'commitAndPush' ? da : 'ask',
  };
}

/** Tudo o que o painel precisa para mostrar/aplicar as configurações. */
export function settingsPayload() {
  const c = getConfig();
  const raw = vscode.workspace.getConfiguration('quickGitCommit').get<string>('language', 'auto');
  return {
    lang: currentLang(),
    language: raw === 'en' || raw === 'pt-BR' ? raw : 'auto',
    types: c.types,
    maxLen: c.maxLen,
    askBranch: c.askBranch,
    defaultAction: c.defaultAction,
    animations: vscode.workspace.getConfiguration('quickGitCommit').get<boolean>('animations', true),
  };
}
