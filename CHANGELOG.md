# Changelog

## 0.4.6

- Documentação: README atualizado, com as imagens da aba IA (AI Guard) refeitas no tema escuro e um GIF mostrando a revisão em ação. Nenhuma mudança no código da extensão.

## 0.4.5

- Novo: **AI Guard**, a segunda chave para quem programa com IA (Claude Code, Codex, Copilot, Cursor...). Quando a IA mexe no projeto, a extensão avisa e mostra o que mudou com **riscos destacados**: segredos no código (chaves AWS/GitHub/Anthropic/OpenAI/Stripe/Google, JWT, URL de banco com senha, chave privada), arquivos `.env`/chaves entrando nas mudanças, `.gitignore` que deixou de proteger segredos, workflows de CI, scripts de instalação no `package.json`, comandos perigosos (`curl | sh`, `rm -rf`, TLS desligado, `--no-verify`, SQL por concatenação), testes apagados ou desativados e mudanças enormes. Tudo roda localmente, sem enviar nada para lugar nenhum.
- Novo: **animações e acabamento visual** no painel (troca de abas, seções que deslizam ao abrir, botões que reagem ao toque, selo de risco que pulsa) e o **modo leve**: em Configurações > Aparência > Animações (`quickGitCommit.animations`) dá para desligar tudo. O painel também respeita a preferência de "reduzir movimento" do sistema.
- Novo: **alerta imediato**: a cada arquivo novo ou alterado, o AI Guard confere em poucos segundos (`quickGitCommit.aiGuard.quietSeconds`, padrão 3 s) e mostra um aviso na tela só quando aparece um risco grave novo, sem repetir.
- Novo: o painel foi dividido em **abas** (Trabalho, Histórico, IA, Recuperar), com selo vermelho na aba IA quando há riscos graves.
- Novo: aba **Revisão IA** no painel: resumo de quem mudou o quê, riscos com gravidade, botões Abrir/Diff por arquivo, "Desfazer o que a IA fez" e "Tudo certo — fazer commit".
- Corrigido: os botões das linhas de "Stashes" e "Pontos de restauração" ficavam escondidos fora do hover; agora aparecem sempre.
- Novo: **Revisar mudanças da IA** (`Ctrl+Alt+G A`, botão de escudo no painel e item na barra de status): lista os riscos por gravidade, abre o arquivo na linha certa e oferece "Tudo certo — fazer commit", "Desfazer tudo que a IA fez" e salvar ponto de restauração.
- Novo: **detecção automática**: o monitor de arquivos avisa quando a IA para de mexer e há riscos (`quickGitCommit.aiGuard.quietSeconds`, padrão 25 s). Salvar à mão no editor não conta como IA.
- Novo: **ligação direta com o Claude Code e o Codex** (`Quick Git: Ligar a IA à revisão`): um gancho (hook) salva um ponto de restauração *antes* do pedido e abre a revisão *quando a IA termina*, via `vscode://.../ai-start` e `ai-done`.
- Novo: **trava no commit**: antes de commitar (painel ou commit rápido), a extensão avisa se há segredo ou risco no que vai ser enviado. Configuração: `quickGitCommit.aiGuard.commitGate` (`off`, `critical` — padrão, `high`).

## 0.4.4

- Novo: **Pontos de restauração**, a rede de segurança para quem programa com IA. Salva uma "foto" dos seus arquivos (alterados e novos, respeitando o `.gitignore`) sem mexer em arquivos, branch nem no que está marcado para o commit, e volta a ela com um clique. Ao voltar, os arquivos criados depois são removidos, os apagados reaparecem e o estado atual é salvo antes, então a própria volta pode ser desfeita. Se houve commits depois do ponto, dá para voltar também esses commits (eles continuam em **Recuperação**). Ficam só no seu computador, nunca são enviados, e a extensão mantém os 20 mais recentes.
- Novo: antes de **Descartar** as alterações de um arquivo, a extensão salva um ponto de restauração automático, então descartar deixa de ser definitivo. Configuração: `quickGitCommit.autoRestorePoint` (ligada por padrão).
- Novo: **Reverter commit (revert)**. Em qualquer commit do histórico, o botão cria um commit novo que desfaz as mudanças dele. Nada é apagado, então é seguro mesmo se o commit já foi enviado para a nuvem. Antes de agir, a extensão explica o efeito em linguagem simples.
- Novo: **Copiar commit para esta branch (cherry-pick)**. Leva só as mudanças de um commit de outra branch para a branch atual, sem trazer o resto, útil para aproveitar uma correção.
- Reverter e copiar funcionam com a resolução de conflitos guiada do painel (Continuar e Cancelar tudo), tratam commits de junção (merge) e avisam quando as mudanças já estão na branch, em vez de deixar o Git preso num commit vazio.
- Novo: **Gerenciar branches** (nova seção "Branches"): renomear, apagar (avisa se há commits não mesclados) e **limpar as já mescladas** de uma vez, sempre confirmando antes.
- Novo: **Abrir Pull Request** (GitHub e GitLab) direto do painel, já com a branch de origem e a principal preenchidas; avisa se a branch ainda não foi enviada.
- Novo: o seletor de branch do topo agora lista também as branches que só existem na nuvem (criadas por outra pessoa) e abre uma cópia local ligada a elas; ao abrir um Pull Request dá para **escolher a branch de destino**.
- Melhorado: mensagens claras para situações de empresa (branch protegida, acesso negado/403, repositório sem acesso, branch inexistente ou aberta em outra pasta), em vez de falhar em silêncio.
- Novo: **aviso de atualização no painel**. A extensão procura versão nova a cada vez que o VS Code abre (sem limite diário) e mostra um aviso no topo do painel, com "Baixar atualização" e "Ignorar". Continua dando para desligar em `quickGitCommit.checkForUpdates`.
- Segurança: nomes de branch validados (sem injeção de opções do Git), credenciais mascaradas em logs/erros, nonce criptográfico no painel, recusa de pastas não confiáveis (Workspace Trust) e novo `SECURITY.md`.
- Corrigido: o botão **Reverter commit** não fazia nada ao clicar; a confirmação agora aparece e os avisos deixam de passar em silêncio.
- Corrigido: ao enviar numa pasta **sem nenhum commit**, aparecia o erro técnico do Git (`src refspec main does not match any`). Agora o botão **Publicar na nuvem** fica desativado com a dica "Faça o seu primeiro commit", e, se o envio for tentado mesmo assim, a extensão explica o que falta em linguagem simples.
- Melhorado: **nenhum erro técnico do Git chega mais ao usuário**. Envio recusado por falta de atualização, branch sem upstream, segredo detectado pelo GitHub, arquivo grande demais, outro processo do Git em execução, conexão caindo e outros casos viraram mensagens claras, em português e inglês. O que não tiver tradução própria aparece limpo (sem `error:`/`fatal:` nem o endereço do repositório), com o botão **Ver detalhes**.
- Corrigido: **bug do idioma**. Ao mudar para o inglês, algumas partes continuavam em português: títulos das telas de comparação de arquivos, etiquetas do histórico ("só na nuvem") e dos arquivos do commit ("Alterado"), mensagens do "Editar último commit", da resolução de conflitos e da criação do repositório, dicas do modo Avançado e o seletor de escopo. Agora tudo é traduzido.

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
