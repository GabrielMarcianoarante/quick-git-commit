# Changelog

## 0.4.3

- Novo: **Stashes** no painel, para guardar alterações temporariamente (inclui arquivos novos) e recuperar, copiar de volta ou excluir depois.
- Novo: **Recuperação** (reflog) para criar uma branch segura em qualquer ponto perdido do histórico, sem alterar a branch atual.
- Novo: **Editar último commit** (amend), para corrigir a mensagem e/ou incluir arquivos marcados.
- Novo: **escopo opcional** no commit, como `feat(login): ...`, no painel e no Quick Commit, com sugestões automáticas.
- Novo: **conflitos com comparação**: abrir "suas mudanças" ↔ "mudanças da outra versão" e escolher uma delas com um clique. Os lados são tratados corretamente também durante um rebase.
- Corrigido: o histórico não aparecia no painel.
- Corrigido: o botão **Editar último commit** aparecia só para commits ainda não enviados. Agora fica disponível sempre que há um commit (ele avisa antes se o commit já foi enviado).
- Corrigido: commits internos do stash não poluem mais o gráfico de histórico.
- Corrigido: o botão **Resolvido** voltou a marcar o arquivo como resolvido.
- Corrigido: confirmação ao cancelar uma atualização e mensagens de erro ao criar o repositório no GitHub.

## 0.4.2

- Novo: releases no GitHub com a extensão (`.vsix`) para baixar separadamente, soma de verificação (`SHA256SUMS.txt`) e texto de lançamento com instruções de instalação, gerados automaticamente a partir deste changelog.
- Inclui as mudanças da 0.4.1 (autorização da permissão `workflow` direto na extensão).

## 0.4.1

- Corrigido: ao enviar commits que alteram `.github/workflows`, o GitHub recusava o envio por falta da permissão `workflow`. Agora a extensão explica o problema e oferece o botão **Autorizar e tentar de novo**, que pede a permissão e refaz o envio sozinho, tanto no painel quanto no Quick Commit da barra de status.
- Quem já autorizou a permissão passa a usá-la automaticamente nos envios seguintes.

## 0.4.0

- Novo: aviso de nova versão. A extensão confere no GitHub (no máximo 1 vez por dia) se existe uma release mais recente e mostra um aviso com o botão **Baixar atualização**. Nada é instalado automaticamente.
- Novo: comando **Quick Git: Verificar atualizações** para conferir na hora.
- Novo: configuração `quickGitCommit.checkForUpdates` para desligar a verificação automática.
- Publisher definido e imagens do README corrigidas (agora carregam a partir do GitHub).
- Documentação de instalação pelo GitHub Releases.

## 0.3.3

- Versão anterior à publicação.
