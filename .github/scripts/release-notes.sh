#!/usr/bin/env bash
# Gera o texto da release a partir do CHANGELOG.md.
# Uso: release-notes.sh <tag> <repo> [tag-anterior]
set -euo pipefail

TAG="$1"
REPO="$2"
PREV="${3:-}"
VERSION="${TAG#v}"
VSIX="quick-git-commit-${VERSION}.vsix"

# Seção "## X.Y.Z" do CHANGELOG, sem o título.
CHANGES="$(awk -v v="$VERSION" '
  $0 ~ "^## " v "([[:space:]]|$)" { found = 1; next }
  found && /^## / { exit }
  found { print }
' CHANGELOG.md | sed '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"

if [ -z "$CHANGES" ]; then
  echo "CHANGELOG.md não tem a seção \"## ${VERSION}\". Adicione as novidades dessa versão antes de criar a tag." >&2
  exit 1
fi

cat <<NOTES
## Novidades

${CHANGES}

## Downloads

| Arquivo | O que é |
| --- | --- |
| **\`${VSIX}\`** | **A extensão pronta para instalar** (recomendado). Baixe só este arquivo. |
| \`SHA256SUMS.txt\` | Soma de verificação do arquivo da extensão. |
| \`Source code (zip)\` e \`Source code (tar.gz)\` | O projeto completo (código-fonte) desta versão, gerado automaticamente pelo GitHub. |

> Os arquivos ficam na seção **Assets**, no fim desta página.

## Como instalar

1. Baixe \`${VSIX}\` em **Assets**.
2. No VS Code, abra **Extensões**, clique em \`...\` e escolha **Instalar de VSIX...**.
3. Selecione o arquivo baixado e recarregue o VS Code se ele pedir.

Pelo terminal: \`code --install-extension ${VSIX}\`

Já tem uma versão instalada? Instale esta por cima, ela substitui a anterior.

## Requisitos

- Visual Studio Code 1.85 ou superior
- [Git](https://git-scm.com/) instalado e acessível no PATH

## Verificar o download (opcional)

\`\`\`bash
sha256sum -c SHA256SUMS.txt
\`\`\`
NOTES

if [ -n "$PREV" ]; then
  printf '\n**Comparar com a versão anterior:** https://github.com/%s/compare/%s...%s\n' "$REPO" "$PREV" "$TAG"
fi
