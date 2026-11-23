// Verificador de riscos para mudanças feitas por IA. Puro (sem VS Code): recebe um diff unificado
// e a lista de arquivos, devolve achados. Mensagens em português (idioma-base, traduzidas por tr()).

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  rule: string;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
  /** Trecho curto (já mascarado quando for segredo). */
  snippet?: string;
}

export interface ScanInput {
  /** Saída de `git diff --unified=0 --no-color` (já inclui staged+unstaged contra HEAD). */
  diff: string;
  /** Arquivos novos (untracked, não ignorados) — não aparecem no diff. */
  untracked?: string[];
  /** Arquivos apagados (opcional; o diff já os informa). */
  deleted?: string[];
}

const ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const bySeverity = (a: Finding, b: Finding): number => ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file);

/* ---------- Arquivos sensíveis (pelo nome) ---------- */
const SENSITIVE_FILES: Array<[RegExp, Severity, string]> = [
  [/(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[^/]+)?$/i, 'critical', 'Arquivo .env com segredos entrou nas mudanças.'],
  [/(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i, 'critical', 'Chave privada SSH nas mudanças.'],
  [/\.(pem|p12|pfx|key|jks|keystore)$/i, 'critical', 'Arquivo de chave/certificado privado nas mudanças.'],
  [/(^|\/)(credentials|secrets?)(\.[a-z]+)?$/i, 'high', 'Arquivo com nome de credenciais/segredos nas mudanças.'],
  [/(^|\/)\.(npmrc|pypirc|netrc|git-credentials)$/i, 'high', 'Arquivo de credenciais de gerenciador de pacotes/Git nas mudanças.'],
  [/(^|\/)(serviceAccount|service-account)[^/]*\.json$/i, 'critical', 'Credencial de conta de serviço nas mudanças.'],
  [/(^|\/)(terraform\.tfstate|.*\.tfvars)$/i, 'high', 'Estado/variáveis do Terraform (podem conter segredos).'],
];

/* ---------- Arquivos que merecem olho humano (infra, CI, dependências) ---------- */
const SENSITIVE_AREAS: Array<[RegExp, Severity, string]> = [
  [/^\.github\/workflows\//, 'high', 'Workflow de CI/CD alterado — roda com permissões do repositório.'],
  [/(^|\/)Dockerfile(\.[^/]+)?$|(^|\/)docker-compose[^/]*\.ya?ml$/i, 'medium', 'Configuração de Docker alterada.'],
  [/(^|\/)(\.gitignore)$/, 'medium', '.gitignore alterado — confira se nenhum segredo deixou de ser ignorado.'],
  [/(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Gemfile|go\.mod|Cargo\.toml|pom\.xml|composer\.json)$/, 'medium', 'Dependências ou scripts do projeto alterados.'],
  [/(^|\/)(auth|security|permission|acl|rbac|middleware\/auth)[^/]*\.(ts|js|py|go|java|rb|cs|php)$/i, 'medium', 'Arquivo de autenticação/permissões alterado.'],
  [/(^|\/)(migrations?|schema\.(sql|prisma))(\/|$)/i, 'medium', 'Banco de dados (migração/esquema) alterado.'],
];

/* ---------- Segredos no conteúdo adicionado ---------- */
const SECRET_PATTERNS: Array<[string, RegExp, string]> = [
  ['aws-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, 'Chave de acesso da AWS'],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'Token do GitHub'],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, 'Chave da API da Anthropic'],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/, 'Chave de API (formato OpenAI)'],
  ['stripe-key', /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/, 'Chave secreta do Stripe'],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Token do Slack'],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/, 'Chave de API do Google'],
  ['private-key', /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/, 'Chave privada'],
  ['db-url', /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s]+/i, 'URL de banco de dados com senha'],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'Token JWT'],
];
const GENERIC_SECRET = /\b([A-Za-z0-9_]*(?:secret|passw(?:or)?d|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)[A-Za-z0-9_]*)\s*[:=]\s*["']([^"'\s]{12,})["']/i;
const PLACEHOLDER = /^(x{3,}|\*{3,}|<.*>|\$\{.*\}|process\.env.*|your[_-].*|changeme|example.*|dummy.*|test.*|placeholder.*|\.{3})$/i;

/* ---------- Padrões perigosos no código adicionado ---------- */
const DANGEROUS: Array<[string, RegExp, Severity, string, RegExp?]> = [
  ['curl-pipe-sh', /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'high', 'Baixa e executa script da internet (curl | sh).'],
  ['rm-rf', /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|\*)(\s|$|"|')/, 'critical', 'Comando que apaga diretórios de forma recursiva em local amplo (rm -rf).'],
  ['tls-off', /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|--insecure\b|\bcurl\b[^\n]*\s-k\b/, 'high', 'Desliga a verificação de certificado TLS.'],
  ['no-verify', /--no-verify\b|--force(-with-lease)?\b.*\bpush\b|\bpush\b.*--force\b/, 'high', 'Pula verificações do Git ou força push.'],
  ['chmod-777', /\bchmod\s+(-R\s+)?0?777\b/, 'medium', 'Permissão 777 (qualquer um lê, escreve e executa).'],
  ['eval', /(^|[^\w.])eval\s*\(|\bnew\s+Function\s*\(|\bexec\s*\(\s*[`"'][^`"']*\$\{|child_process.*\bexec(Sync)?\s*\(/, 'medium', 'Execução dinâmica de código/comando (eval, exec).'],
  ['sql-concat', /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;\n]*\b(FROM|INTO|SET|WHERE)\b[^;\n]*(\+\s*\w+|\$\{)/i, 'medium', 'Possível SQL montado por concatenação (injeção de SQL).'],
  ['drop-table', /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i, 'high', 'Comando que apaga tabela/banco de dados.'],
  ['cors-any', /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]/i, 'medium', 'CORS aberto para qualquer origem.'],
  ['disabled-test', /\b(it|test|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(|@pytest\.mark\.skip|@Disabled\b/, 'low', 'Teste desativado.'],
  ['ts-ignore', /@ts-ignore|@ts-nocheck|eslint-disable(?!-next-line)|#\s*noqa\b|#\s*type:\s*ignore/, 'low', 'Verificação de tipos/lint desligada.'],
];

const mask = (s: string): string => (s.length <= 8 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-2)}`);
const short = (s: string): string => (s.trim().length > 90 ? `${s.trim().slice(0, 87)}...` : s.trim());

function entropy(s: string): number {
  const f = new Map<string, number>();
  for (const c of s) {
    f.set(c, (f.get(c) ?? 0) + 1);
  }
  let h = 0;
  for (const n of f.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface DiffFile {
  file: string;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  added: Array<{ line: number; text: string }>;
  removed: Array<{ line: number; text: string }>;
}

/** Lê `git diff --unified=0`. Não depende de nenhuma biblioteca. */
export function parseDiff(diff: string): DiffFile[] {
  const out: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let oldLn = 0;
  let newLn = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      cur = { file: m ? m[2] : raw.slice(11), isNew: false, isDeleted: false, isBinary: false, added: [], removed: [] };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (raw.startsWith('new file mode')) {
      cur.isNew = true;
    } else if (raw.startsWith('deleted file mode')) {
      cur.isDeleted = true;
    } else if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
      cur.isBinary = true;
    } else if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw);
      oldLn = m ? Number(m[1]) : 0;
      newLn = m ? Number(m[2]) : 0;
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      cur.added.push({ line: newLn++, text: raw.slice(1) });
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      cur.removed.push({ line: oldLn++, text: raw.slice(1) });
    }
  }
  return out;
}

export function scan(input: ScanInput): Finding[] {
  const findings: Finding[] = [];
  const files = parseDiff(input.diff);
  const seen = new Set<string>();
  const add = (f: Finding): void => {
    const key = `${f.rule}|${f.file}|${f.line ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };

  const fileNames = new Set<string>([...files.filter((f) => !f.isDeleted).map((f) => f.file), ...(input.untracked ?? [])]);

  for (const name of fileNames) {
    for (const [re, severity, message] of SENSITIVE_FILES) {
      if (re.test(name)) {
        add({ rule: 'sensitive-file', severity, file: name, message });
        break;
      }
    }
    for (const [re, severity, message] of SENSITIVE_AREAS) {
      if (re.test(name)) {
        add({ rule: 'sensitive-area', severity, file: name, message });
        break;
      }
    }
  }

  for (const f of files) {
    if (f.isDeleted) {
      continue;
    }
    // .gitignore: linha que protegia segredos foi removida
    if (/(^|\/)\.gitignore$/.test(f.file)) {
      for (const r of f.removed) {
        if (/\.env|\.pem|\.key|secret|credential/i.test(r.text) && !r.text.trim().startsWith('#')) {
          add({ rule: 'gitignore-secret', severity: 'high', file: f.file, line: r.line, message: 'Removeu do .gitignore uma regra que protegia segredos.', snippet: short(r.text) });
        }
      }
    }
    // package.json: scripts de instalação (executam ao instalar)
    if (/(^|\/)package\.json$/.test(f.file)) {
      for (const a of f.added) {
        if (/"(pre|post)?install"\s*:|"prepare"\s*:/.test(a.text)) {
          add({ rule: 'install-script', severity: 'high', file: f.file, line: a.line, message: 'Script que roda automaticamente ao instalar dependências.', snippet: short(a.text) });
        }
      }
    }
    if (f.isBinary && f.isNew) {
      add({ rule: 'binary-new', severity: 'low', file: f.file, message: 'Arquivo binário novo (não dá para revisar o conteúdo).' });
    }
    const isTestFile = /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$/i.test(f.file);
    for (const a of f.added) {
      if (a.text.length > 2000) {
        continue; // minificado/gerado
      }
      let hit = false;
      for (const [rule, re, label] of SECRET_PATTERNS) {
        const m = re.exec(a.text);
        if (m) {
          add({ rule: `secret:${rule}`, severity: 'critical', file: f.file, line: a.line, message: `${label} no código.`, snippet: mask(m[0]) });
          hit = true;
          break;
        }
      }
      if (!hit) {
        const g = GENERIC_SECRET.exec(a.text);
        if (g && !PLACEHOLDER.test(g[2]) && entropy(g[2]) >= 3) {
          add({ rule: 'secret:generic', severity: 'high', file: f.file, line: a.line, message: `Possível segredo em "${g[1]}".`, snippet: `${g[1]} = ${mask(g[2])}` });
        }
      }
      for (const [rule, re, severity, message] of DANGEROUS) {
        if (rule === 'disabled-test' && !isTestFile) {
          continue;
        }
        if (/\.(md|txt|rst)$/i.test(f.file) && rule !== 'curl-pipe-sh') {
          continue;
        }
        if (re.test(a.text)) {
          add({ rule, severity, file: f.file, line: a.line, message, snippet: short(a.text) });
        }
      }
    }
    // Testes apagados: mais linhas removidas de assertivas do que adicionadas
    if (isTestFile && !f.isNew) {
      const count = (xs: Array<{ text: string }>): number => xs.filter((x) => /\b(expect|assert|should)\b/.test(x.text)).length;
      const lost = count(f.removed) - count(f.added);
      if (lost >= 3) {
        add({ rule: 'tests-removed', severity: 'high', file: f.file, message: `Removeu ${lost} verificações de teste.` });
      }
    }
  }

  const deleted = [...files.filter((f) => f.isDeleted).map((f) => f.file), ...(input.deleted ?? [])];
  if (deleted.length >= 5) {
    add({ rule: 'mass-delete', severity: 'high', file: `${deleted.length} arquivos`, message: `${deleted.length} arquivos foram apagados.` });
  } else {
    for (const d of deleted) {
      if (/(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\./i.test(d)) {
        add({ rule: 'test-deleted', severity: 'medium', file: d, message: 'Arquivo de teste apagado.' });
      }
    }
  }

  const changed = files.reduce((n, f) => n + f.added.length + f.removed.length, 0);
  if (changed > 1500) {
    add({ rule: 'big-diff', severity: 'low', file: `${files.length} arquivos`, message: `Mudança grande (${changed} linhas) — difícil de revisar de uma vez.` });
  }

  return findings.sort(bySeverity);
}

export function summarize(findings: Finding[]): { critical: number; high: number; medium: number; low: number } {
  const s = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    s[f.severity]++;
  }
  return s;
}
