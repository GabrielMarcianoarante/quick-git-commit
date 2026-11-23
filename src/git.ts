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

/** Remove credenciais embutidas em URLs (https://usuario:token@host) de logs e mensagens. */
export function redact(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

/** Nome de branch seguro para virar argumento do Git: válido e nunca começando com "-" (evita injeção de opção). */
export async function isSafeBranch(root: string, name: unknown): Promise<boolean> {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.length > 250 || /[\u0000-\u001f]/.test(name)) {
    return false;
  }
  return gitOk(root, ['check-ref-format', '--branch', name]);
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
  /** Variáveis de ambiente extras para este comando (ex.: GIT_INDEX_FILE). */
  env?: Record<string, string>;
}

export async function git(cwd: string, args: string[], options: RunOptions = {}): Promise<string> {
  const extra = NETWORK_COMMANDS.has(args[0]) ? await authEnv().catch(() => undefined) : undefined;
  return new Promise((resolve, reject) => {
    logger(redact(`$ git ${args.join(' ')}`));
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
          ...options.env,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          let text =
            code === 'ENOENT'
              ? 'Git não encontrado. Instale o Git e reinicie o VS Code.'
              : [stderr, stdout]
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .join('\n') || error.message;
          text = redact(text);
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

export type Operation = 'none' | 'rebase' | 'merge' | 'revert' | 'cherry-pick';

export interface SyncInfo {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface StashInfo {
  id: string;
  hash: string;
  subject: string;
}

export interface ReflogInfo {
  hash: string;
  short: string;
  subject: string;
  date: string;
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
  stashes: StashInfo[];
  reflog: ReflogInfo[];
  restorePoints: RestorePointInfo[];
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
  if (await exists('REVERT_HEAD')) {
    return 'revert';
  }
  if (await exists('CHERRY_PICK_HEAD')) {
    return 'cherry-pick';
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
    out = await git(root, ['log', '--exclude=refs/stash', '--all', '--topo-order', '-n', String(limit), `--pretty=format:${LOG_FORMAT}`], { raw: true });
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
  const [sync, statusRaw, remoteList, branches, operation, hasCommits, stashes, reflog, restorePoints] = await Promise.all([
    getSync(root),
    git(root, ['status', '--porcelain=v1', '-z', '-uall'], { raw: true }),
    git(root, ['remote']),
    listBranches(root),
    currentOperation(root),
    gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD']),
    readStashes(root),
    readReflog(root),
    readRestorePoints(root),
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
    stashes,
    reflog,
    restorePoints,
    branches,
    history,
    headHash,
    canUndoCommit: hasCommits && !!sync.upstream && sync.ahead > 0 && operation === 'none',
  };
}

export async function readStashes(root: string): Promise<StashInfo[]> {
  try {
    const out = await git(root, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs'], { raw: true });
    return out
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const [id, hash, subject] = line.split('\x1f');
        return { id: id || '', hash: hash || '', subject: subject || '' };
      });
  } catch {
    return [];
  }
}

export async function readReflog(root: string): Promise<ReflogInfo[]> {
  try {
    const out = await git(root, ['reflog', 'show', 'HEAD', '-n', '30', '--format=%H%x1f%h%x1f%gs%x1f%ar'], { raw: true });
    const seen = new Set<string>();
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, short, subject, date] = line.split('\x1f');
        return { hash: hash || '', short: short || '', subject: subject || '', date: date || '' };
      })
      .filter((entry) => /^[0-9a-f]{7,40}$/i.test(entry.hash))
      .filter((entry) => {
        if (seen.has(entry.hash)) {
          return false;
        }
        seen.add(entry.hash);
        return true;
      });
  } catch {
    return [];
  }
}


// ---------- Pontos de restauração ----------
// Uma "foto" da pasta de trabalho (arquivos alterados e novos, respeitando o .gitignore) guardada como um commit
// interno em refs/quickgit/restore/*. Não mexe no índice, nos arquivos nem na branch, e nunca é enviada para a nuvem.

export interface RestorePointInfo {
  ref: string;
  hash: string;
  name: string;
  /** Segundos desde 1970. */
  date: number;
  auto: boolean;
  branch: string;
  /** Commit em que a branch estava quando o ponto foi salvo (vazio se ainda não havia commits). */
  head: string;
  files: number;
}

const RP_PREFIX = 'refs/quickgit/restore/';
const RP_KEEP = 20;
const RP_IDENTITY = {
  GIT_AUTHOR_NAME: 'Quick Git Commit',
  GIT_AUTHOR_EMAIL: 'restore-point@quick-git-commit.local',
  GIT_COMMITTER_NAME: 'Quick Git Commit',
  GIT_COMMITTER_EMAIL: 'restore-point@quick-git-commit.local',
};

/** Fotografa a pasta de trabalho usando um índice temporário (o índice real não é tocado). */
async function snapshotTree(root: string): Promise<{ tree: string; files: number; head: string }> {
  const gitDir = await git(root, ['rev-parse', '--absolute-git-dir']);
  const indexFile = path.join(gitDir, `qgc-snapshot-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const env = { GIT_INDEX_FILE: indexFile };
  const head = (await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD'])) ? await git(root, ['rev-parse', 'HEAD']) : '';
  try {
    if (head) {
      await git(root, ['read-tree', 'HEAD'], { env });
    }
    await git(root, ['add', '-A'], { env });
    const tree = await git(root, ['write-tree'], { env });
    const changed = head
      ? await git(root, ['diff', '--cached', '--name-only', '-z', head], { env, raw: true })
      : await git(root, ['ls-files', '-z'], { env, raw: true });
    return { tree, files: changed.split('\0').filter(Boolean).length, head };
  } finally {
    try {
      fs.rmSync(indexFile, { force: true });
    } catch {
      /* arquivo temporário: se não der para apagar agora, não atrapalha */
    }
  }
}

export async function readRestorePoints(root: string): Promise<RestorePointInfo[]> {
  try {
    const out = await git(
      root,
      ['for-each-ref', '--sort=-refname', '--format=%(refname)%1f%(objectname)%1f%(creatordate:unix)%1f%(contents:subject)%1f%(contents:body)%1e', RP_PREFIX],
      { raw: true }
    );
    return out
      .split('\x1e')
      .map((rec) => rec.replace(/^\n+/, ''))
      .filter((rec) => rec.trim() !== '')
      .map((rec) => {
        const [ref, hash, date, name, body] = rec.split('\x1f');
        const meta: Record<string, string> = {};
        for (const line of (body || '').split('\n')) {
          const m = /^(branch|head|auto|files):\s*(.*)$/.exec(line.trim());
          if (m) {
            meta[m[1]] = m[2];
          }
        }
        return {
          ref: ref || '',
          hash: hash || '',
          name: name || 'Ponto de restauração',
          date: Number(date) || 0,
          auto: meta.auto === '1',
          branch: meta.branch || '',
          head: meta.head || '',
          files: Number(meta.files) || 0,
        };
      })
      .filter((p) => p.ref.startsWith(RP_PREFIX) && isHash(p.hash));
  } catch {
    return [];
  }
}

/** Salva um ponto de restauração. Guarda os 20 mais recentes e apaga os mais antigos. */
export async function createRestorePoint(root: string, name: string, auto: boolean): Promise<RestorePointInfo> {
  const { tree, files, head } = await snapshotTree(root);
  const branch = await git(root, ['branch', '--show-current']).catch(() => '');
  const title = name.replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || 'Ponto de restauração';
  const args = ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', title, '-m', 'qgc-restore-point', '-m', `branch: ${branch}`, '-m', `head: ${head}`, '-m', `auto: ${auto ? 1 : 0}`, '-m', `files: ${files}`];
  const hash = await git(root, args, { env: RP_IDENTITY });
  const ref = `${RP_PREFIX}${Date.now()}-${hash.slice(0, 7)}`;
  await git(root, ['update-ref', ref, hash]);
  const all = await readRestorePoints(root);
  for (const old of all.slice(RP_KEEP)) {
    await git(root, ['update-ref', '-d', old.ref]).catch(() => undefined);
  }
  return { ref, hash, name: title, date: Math.floor(Date.now() / 1000), auto, branch, head, files };
}

export async function deleteRestorePoint(root: string, point: RestorePointInfo): Promise<void> {
  if (!point.ref.startsWith(RP_PREFIX)) {
    throw new Error('Ponto de restauração inválido.');
  }
  await git(root, ['update-ref', '-d', point.ref]);
}

/** Quantos commits foram feitos depois do ponto, na mesma branch (0 se não dá para voltá-los com segurança). */
export async function commitsSincePoint(root: string, point: RestorePointInfo): Promise<number> {
  if (!point.head || !isHash(point.head)) {
    return 0;
  }
  const current = await git(root, ['branch', '--show-current']).catch(() => '');
  if (!current || current !== point.branch) {
    return 0;
  }
  if (!(await gitOk(root, ['merge-base', '--is-ancestor', point.head, 'HEAD']))) {
    return 0;
  }
  return Number(await git(root, ['rev-list', '--count', `${point.head}..HEAD`])) || 0;
}

function chunkByLength(items: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const item of items) {
    if (cur.length && len + item.length > maxChars) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(item);
    len += item.length + 1;
  }
  if (cur.length) {
    chunks.push(cur);
  }
  return chunks;
}

/**
 * Deixa a pasta de trabalho exatamente como no ponto: restaura arquivos alterados/apagados e apaga os criados depois.
 * Com `moveBranch`, a branch também volta ao commit em que estava (os commits novos continuam em "Recuperação").
 */
export async function restoreToPoint(root: string, point: RestorePointInfo, moveBranch: boolean): Promise<void> {
  const { tree: current } = await snapshotTree(root);
  const target = await git(root, ['rev-parse', `${point.hash}^{tree}`]);
  const diff = await git(root, ['diff-tree', '-r', '--name-status', '--no-renames', '-z', current, target], { raw: true });
  const parts = diff.split('\0').filter((x) => x !== '');
  const toWrite: string[] = [];
  const toDelete: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    (parts[i][0] === 'D' ? toDelete : toWrite).push(parts[i + 1]);
  }

  const base = path.resolve(root);
  let failed = 0;
  for (const rel of toDelete) {
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(base + path.sep)) {
      continue;
    }
    try {
      fs.rmSync(abs, { force: true });
      let dir = path.dirname(abs);
      while (dir.startsWith(base + path.sep)) {
        try {
          fs.rmdirSync(dir); // só remove pastas que ficaram vazias
        } catch {
          break;
        }
        dir = path.dirname(dir);
      }
    } catch {
      failed++;
    }
  }
  for (const chunk of chunkByLength(toWrite, 6000)) {
    await git(root, ['--literal-pathspecs', 'restore', `--source=${point.hash}`, '--worktree', '--', ...chunk]);
  }

  if (moveBranch && point.head && isHash(point.head)) {
    await git(root, ['reset', '-q', '--mixed', point.head]);
  } else {
    await git(root, ['reset', '-q']).catch(() => undefined);
  }
  if (failed > 0) {
    throw new Error(`Não consegui apagar ${failed} arquivo(s) criado(s) depois do ponto. Feche programas que estejam usando esses arquivos e tente de novo.`);
  }
}
