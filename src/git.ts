import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ---------- Execução de comandos Git ----------

let logger: (line: string) => void = () => undefined;
let authEnv: () => Promise<Record<string, string> | undefined> = async () => undefined;

/** Permite entregar ao Git o login do GitHub feito no VS Code (apenas para comandos de rede). */
export function setGitAuth(fn: () => Promise<Record<string, string> | undefined>): void {
  authEnv = fn;
}

const NETWORK_COMMANDS = new Set(['fetch', 'pull', 'push', 'ls-remote', 'clone']);

export function setGitLogger(fn: (line: string) => void): void {
  logger = fn;
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

interface RunOptions {
  /** Não faz trim na saída (necessário para parsear saídas com -z). */
  raw?: boolean;
}

export async function git(cwd: string, args: string[], options: RunOptions = {}): Promise<string> {
  const extra = NETWORK_COMMANDS.has(args[0]) ? await authEnv().catch(() => undefined) : undefined;
  return new Promise((resolve, reject) => {
    logger(`$ git ${args.join(' ')}`);
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', // nunca ficar preso esperando senha no terminal
          GIT_EDITOR: 'true', // nunca abrir editor (rebase --continue, merge)
          GIT_OPTIONAL_LOCKS: '0',
          LANGUAGE: 'en',
          LC_MESSAGES: 'C',
          ...extra,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const text =
            code === 'ENOENT'
              ? 'Git não encontrado. Instale o Git e reinicie o VS Code.'
              : [stderr, stdout]
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .join('\n') || error.message;
          logger(text);
          reject(new GitError(text));
        } else {
          resolve(options.raw ? stdout : stdout.trim());
        }
      }
    );
  });
}

export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

export async function getRepoRoot(folder: string): Promise<string | undefined> {
  try {
    const out = await git(folder, ['rev-parse', '--show-toplevel']);
    return path.normalize(out);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Git não encontrado')) {
      throw err;
    }
    return undefined;
  }
}

// ---------- Modelos ----------

export type FileKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'typechange';

export interface FileEntry {
  path: string;
  index: string;
  worktree: string;
  kind: FileKind;
  /** Tem algo marcado (staged) para o próximo commit. */
  staged: boolean;
  /** Marcado, mas com mais alterações depois da marcação. */
  partial: boolean;
  conflict: boolean;
}

export interface RefChip {
  name: string;
  kind: 'tag' | 'remote' | 'branch';
  head: boolean;
}

export interface CommitInfo {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  refs: RefChip[];
  parents: string[];
  merge: boolean;
  /** Existe só aqui: ainda não foi enviado para a nuvem. */
  unpushed: boolean;
  /** Existe na nuvem, mas ainda não foi trazido para a branch atual. */
  incoming: boolean;
  /** É o commit em que você está agora (HEAD). */
  head: boolean;
}

export interface CommitFile {
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'T';
  path: string;
  oldPath?: string;
}

export interface CommitDetails {
  hash: string;
  body: string;
  files: CommitFile[];
  insertions: number;
  deletions: number;
}

export type Operation = 'none' | 'rebase' | 'merge';

export interface SyncInfo {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface RepoState extends SyncInfo {
  isRepo: true;
  root: string;
  repoName: string;
  detached: boolean;
  hasCommits: boolean;
  hasRemote: boolean;
  operation: Operation;
  files: FileEntry[];
  conflicts: string[];
  branches: { local: string[]; remote: string[] };
  history: CommitInfo[];
  headHash: string;
  canUndoCommit: boolean;
}

export interface NoRepoState {
  isRepo: false;
  hasFolder: boolean;
  folderName?: string;
  error?: string;
}

// ---------- Leitura de estado ----------

export function parseStatus(raw: string): FileEntry[] {
  const parts = raw.split('\0');
  const files: FileEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) {
      continue;
    }
    const x = entry[0];
    const y = entry[1];
    const file = entry.slice(3);
    // Renomeações/cópias trazem o caminho original no próximo item.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i++;
    }
    const conflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    const untracked = x === '?';
    let kind: FileKind = 'modified';
    if (untracked) {
      kind = 'untracked';
    } else if (x === 'A') {
      kind = 'added';
    } else if (x === 'D' || y === 'D') {
      kind = 'deleted';
    } else if (x === 'R' || x === 'C') {
      kind = 'renamed';
    } else if (x === 'T' || y === 'T') {
      kind = 'typechange';
    }
    const staged = !conflict && !untracked && x !== ' ';
    files.push({
      path: file,
      index: x,
      worktree: y,
      kind,
      staged,
      partial: staged && y !== ' ',
      conflict,
    });
  }
  return files;
}

export async function readStatus(root: string): Promise<FileEntry[]> {
  const raw = await git(root, ['status', '--porcelain=v1', '-z', '-uall'], { raw: true });
  return parseStatus(raw);
}

export async function getSync(root: string): Promise<SyncInfo> {
  const branch = await git(root, ['branch', '--show-current']);
  try {
    const upstream = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const counts = await git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const [ahead, behind] = counts.split(/\s+/).map((n) => parseInt(n, 10));
    return { branch, upstream, ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { branch, ahead: 0, behind: 0 };
  }
}

export async function currentOperation(root: string): Promise<Operation> {
  const exists = async (name: string): Promise<boolean> => {
    try {
      const p = await git(root, ['rev-parse', '--git-path', name]);
      return fs.existsSync(path.resolve(root, p));
    } catch {
      return false;
    }
  };
  if ((await exists('rebase-merge')) || (await exists('rebase-apply'))) {
    return 'rebase';
  }
  if (await exists('MERGE_HEAD')) {
    return 'merge';
  }
  return 'none';
}

export async function listBranches(root: string): Promise<{ local: string[]; remote: string[] }> {
  const out = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  const local: string[] = [];
  const remote: string[] = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('refs/heads/')) {
      local.push(line.slice('refs/heads/'.length));
    } else if (line.startsWith('refs/remotes/')) {
      const name = line.slice('refs/remotes/'.length);
      if (!name.endsWith('/HEAD')) {
        remote.push(name);
      }
    }
  }
  return { local, remote };
}

const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1f%D%x1f%P%x1e';

export function parseLog(
  out: string,
  remotes: Set<string>,
  unpushed: Set<string>,
  incoming: Set<string>,
  headHash: string
): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const records = out.split('\x1e');
  for (const record of records) {
    const clean = record.replace(/^\n/, '');
    if (!clean.trim()) {
      continue;
    }
    const f = clean.split('\x1f');
    if (f.length < 7) {
      continue;
    }
    const refs: RefChip[] = [];
    for (const piece of f[5].split(', ')) {
      const p = piece.trim();
      if (!p || p === 'HEAD') {
        continue;
      }
      if (p.startsWith('HEAD -> ')) {
        refs.push({ name: p.slice('HEAD -> '.length), kind: 'branch', head: true });
      } else if (p.startsWith('tag: ')) {
        refs.push({ name: p.slice('tag: '.length), kind: 'tag', head: false });
      } else {
        refs.push({ name: p, kind: remotes.has(p) ? 'remote' : 'branch', head: false });
      }
    }
    const parents = f[6].trim().split(/\s+/).filter(Boolean);
    commits.push({
      hash: f[0],
      short: f[1],
      author: f[2],
      date: f[3],
      subject: f[4],
      refs,
      parents,
      merge: parents.length > 1,
      unpushed: unpushed.has(f[0]),
      incoming: incoming.has(f[0]),
      head: f[0] === headHash,
    });
  }
  return commits;
}

async function hashSet(root: string, range: string[]): Promise<Set<string>> {
  try {
    const out = await git(root, ['rev-list', ...range]);
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Histórico de todas as branches (base do gráfico), em ordem topológica. */
export async function readHistory(root: string, limit: number, remotes: Set<string>, hasUpstream: boolean): Promise<{ history: CommitInfo[]; headHash: string }> {
  let out: string;
  try {
    out = await git(root, ['log', '--all', '--topo-order', '-n', String(limit), `--pretty=format:${LOG_FORMAT}`], { raw: true });
  } catch {
    return { history: [], headHash: '' };
  }
  const headHash = await git(root, ['rev-parse', 'HEAD']).catch(() => '');
  const [unpushed, incoming] = hasUpstream
    ? await Promise.all([hashSet(root, ['@{u}..HEAD']), hashSet(root, ['HEAD..@{u}'])])
    : [await hashSet(root, ['HEAD', '--not', '--remotes']), new Set<string>()];
  return { history: parseLog(out, remotes, unpushed, incoming, headHash), headHash };
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function parseNameStatus(raw: string): CommitFile[] {
  const parts = raw.split('\0').filter((p) => p !== '');
  const files: CommitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    const letter = code[0] as CommitFile['status'];
    if (letter === 'R' || letter === 'C') {
      files.push({ status: letter, oldPath: parts[i + 1], path: parts[i + 2] });
      i += 2;
    } else {
      files.push({ status: letter, path: parts[i + 1] });
      i += 1;
    }
  }
  return files.filter((f) => f.path);
}

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value);
}

/** Arquivos alterados por um commit (em relação ao primeiro pai). */
export async function readCommitDetails(root: string, hash: string): Promise<CommitDetails> {
  if (!isHash(hash)) {
    throw new GitError('Commit inválido.');
  }
  const parent = await git(root, ['rev-parse', '--verify', '-q', `${hash}^1`]).catch(() => '');
  const base = parent || EMPTY_TREE;
  const [body, namesRaw, shortstat] = await Promise.all([
    git(root, ['log', '-1', '--format=%b', hash]),
    git(root, ['diff', '--name-status', '-M', '-z', base, hash], { raw: true }),
    git(root, ['diff', '--shortstat', base, hash]),
  ]);
  const ins = /(\d+) insertion/.exec(shortstat);
  const del = /(\d+) deletion/.exec(shortstat);
  return {
    hash,
    body: body.trim(),
    files: parseNameStatus(namesRaw),
    insertions: ins ? parseInt(ins[1], 10) : 0,
    deletions: del ? parseInt(del[1], 10) : 0,
  };
}

export async function readState(root: string): Promise<RepoState> {
  const [sync, statusRaw, remoteList, branches, operation, hasCommits] = await Promise.all([
    getSync(root),
    git(root, ['status', '--porcelain=v1', '-z', '-uall'], { raw: true }),
    git(root, ['remote']),
    listBranches(root),
    currentOperation(root),
    gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD']),
  ]);

  const files = parseStatus(statusRaw);
  const remoteSet = new Set(branches.remote);

  let history: CommitInfo[] = [];
  let headHash = '';
  if (hasCommits) {
    ({ history, headHash } = await readHistory(root, 60, remoteSet, !!sync.upstream));
  }

  return {
    ...sync,
    isRepo: true,
    root,
    repoName: path.basename(root),
    detached: sync.branch === '',
    hasCommits,
    hasRemote: remoteList.split('\n').some((l) => l.trim() !== ''),
    operation,
    files: files.filter((f) => !f.conflict),
    conflicts: files.filter((f) => f.conflict).map((f) => f.path),
    branches,
    history,
    headHash,
    canUndoCommit: hasCommits && !!sync.upstream && sync.ahead > 0 && operation === 'none',
  };
}
