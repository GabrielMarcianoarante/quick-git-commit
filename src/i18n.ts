import * as vscode from 'vscode';

// Dicionário compartilhado com o painel (media/i18n.js). O português é o idioma-base.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const I18N = require('../media/i18n.js') as { translate(s: string, lang: string, fuzzy?: boolean): string };

export type Lang = 'pt' | 'en';

/** quickGitCommit.language: "auto" segue o idioma do VS Code (pt* → português; outros → inglês). */
export function currentLang(): Lang {
  const v = vscode.workspace.getConfiguration('quickGitCommit').get<string>('language', 'auto');
  if (v === 'en') {
    return 'en';
  }
  if (v === 'pt-BR') {
    return 'pt';
  }
  return vscode.env.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export const tr = (s: string): string => I18N.translate(s, currentLang(), true);
const trExact = (s: string): string => I18N.translate(s, currentLang(), false);

/* eslint-disable @typescript-eslint/no-explicit-any */
function trItem<T>(item: T): T {
  if (typeof item !== 'object' || !item) {
    return item;
  }
  const o: any = { ...item };
  for (const k of ['label', 'description', 'detail']) {
    if (typeof o[k] === 'string') {
      o[k] = trExact(o[k]);
    }
  }
  return o;
}

function trOpts<T extends object>(opts?: T): any {
  const o: any = { ...(opts ?? {}) };
  for (const k of ['title', 'placeHolder', 'prompt']) {
    if (typeof o[k] === 'string') {
      o[k] = tr(o[k]);
    }
  }
  return o;
}

type MsgFn = (message: string, ...items: any[]) => Thenable<any>;
function msg(fn: MsgFn) {
  return async (message: string, ...args: any[]): Promise<any> => {
    const back = new Map<string, string>(); // devolve ao chamador o texto original do botão escolhido
    const mapped = args.map((a) => {
      if (typeof a === 'string') {
        const t = tr(a);
        back.set(t, a);
        return t;
      }
      return a && typeof a === 'object' && typeof a.detail === 'string' ? { ...a, detail: tr(a.detail) } : a;
    });
    const r = await fn(tr(message), ...mapped);
    return typeof r === 'string' ? back.get(r) ?? r : r;
  };
}

/** Versões das caixas do VS Code que já traduzem texto, botões e validações. */
export const ui = {
  info: msg((m, ...a) => vscode.window.showInformationMessage(m, ...a)),
  warn: msg((m, ...a) => vscode.window.showWarningMessage(m, ...a)),
  error: msg((m, ...a) => vscode.window.showErrorMessage(m, ...a)),
  async pick<T extends vscode.QuickPickItem | string>(items: readonly T[], opts?: vscode.QuickPickOptions): Promise<T | undefined> {
    const copies = items.map((i) => (typeof i === 'string' ? i : trItem(i)));
    const r = await vscode.window.showQuickPick(copies as any, trOpts(opts));
    const idx = copies.indexOf(r as any);
    return idx >= 0 ? items[idx] : undefined;
  },
  input(opts: vscode.InputBoxOptions): Thenable<string | undefined> {
    const o = trOpts(opts);
    if (opts.validateInput) {
      const v = opts.validateInput;
      o.validateInput = async (s: string) => {
        const r: any = await v(s);
        return typeof r === 'string' ? tr(r) : r;
      };
    }
    return vscode.window.showInputBox(o);
  },
};
