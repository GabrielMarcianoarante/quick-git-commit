# Changelog

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
