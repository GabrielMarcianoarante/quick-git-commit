/* Tradução pt-BR -> en, compartilhada entre a extensão (Node) e o painel (webview).
   Chaves com {} são padrões (cada {} captura um trecho). O português é o idioma-base. */
(function (root) {
  const P = [
    ['O GitHub bloqueou o envio porque este commit altera arquivos de automação (.github/workflows) e a sua conta conectada ainda não tem essa permissão. Seus commits continuam salvos. Quer autorizar agora?', 'GitHub blocked the push because this commit changes automation files (.github/workflows) and your connected account does not have that permission yet. Your commits are still saved. Authorize now?'],
    ['Autorizar e tentar de novo', 'Authorize and try again'],
    ['Autorização cancelada. Nada foi enviado.', 'Authorization cancelled. Nothing was sent.'],
    ['O GitHub bloqueou o envio: falta a permissão "workflow" na sua conta conectada. Tente "Enviar" de novo para autorizar.', 'GitHub blocked the push: the "workflow" permission is missing on your connected account. Try "Push" again to authorize.'],
    ['Nova versão do Quick Git Commit disponível: {}. Você está usando a {}.', 'New Quick Git Commit version available: {}. You are using {}.'],
    ['Você já está na versão mais recente ({}).', 'You are on the latest version ({}).'],
    ['Não foi possível verificar atualizações agora.', 'Could not check for updates right now.'],
    ['Baixar atualização', 'Download update'], ['Ignorar esta versão', 'Skip this version'],
    ['Sincronizar com a nuvem', 'Sync with the cloud'], ['Minhas alterações', 'My changes'],
    ['Atualizar minha branch', 'Update my branch'], ['Histórico', 'History'],
    ['Só confere se há novidades. Não mexe nos seus arquivos. (git fetch)', "Only checks for news. Doesn't touch your files. (git fetch)"],
    ['Baixa as novidades da nuvem para o seu computador. (git pull)', 'Downloads the latest changes from the cloud to your computer. (git pull)'],
    ['Envia os seus commits para a nuvem. (git push)', 'Sends your commits to the cloud. (git push)'],
    ['Salvar commit', 'Save commit'], ['Salvar e enviar', 'Save and push'],
    ['Atualizar com Rebase', 'Update with Rebase'], ['Atualizar com Merge', 'Update with Merge'],
    ['Desfazer último commit', 'Undo last commit'],
    ['Desfaz o commit mais recente, mantendo as suas alterações. (git reset --soft HEAD~1)', 'Undoes the latest commit, keeping your changes. (git reset --soft HEAD~1)'],
    ['Publicar na nuvem', 'Publish to the cloud'], ['Conectar à nuvem', 'Connect to the cloud'],
    ['Marcar tudo', 'Select all'], ['Trazer novidades de:', 'Bring changes from:'],
    ['Excluído', 'Deleted'], ['Tipo mudou', 'Type changed'], ['Working tree e index', 'Working tree and index'],
    ['Desfazer último commit, mantendo as alterações no index.', 'Undo last commit, keeping the changes in the index.'],
    ['Uma funcionalidade nova', 'A new feature'], ['Correção', 'Fix'], ['Conserto de um erro', 'A bug fix'],
    ['Documentação', 'Documentation'], ['Textos e explicações', 'Texts and explanations'],
    ['Formatação, sem mudar o comportamento', 'Formatting, no behavior change'], ['Reorganização', 'Refactor'],
    ['Melhorar o código sem mudar o resultado', 'Improve the code without changing the result'],
    ['Manutenção', 'Maintenance'], ['Tarefas de rotina e configurações', 'Routine tasks and settings'],
    ['Novidade', 'Feature'], ['Estilo', 'Style'],
    ['Modo Avançado: os botões mostram o comando Git real.', 'Advanced mode: buttons show the real Git command.'],
    ['Modo Simples: nomes fáceis, com o comando real na dica do botão.', 'Simple mode: friendly names, with the real command in the button tooltip.'],
    ['Algo deu errado', 'Something went wrong'], ['Tentar de novo', 'Try again'], ['Nenhuma pasta aberta', 'No folder open'],
    ['Abra a pasta do seu projeto para usar o painel: menu Arquivo > Abrir Pasta.', 'Open your project folder to use the panel: File > Open Folder.'],
    ['Esta pasta ainda não usa Git', "This folder doesn't use Git yet"],
    ['Git guarda o histórico do seu projeto e permite voltar atrás se algo der errado. Você pode começar agora, é só um clique.', "Git keeps your project's history and lets you go back if something goes wrong. You can start now, it takes one click."],
    ['Começar a usar Git', 'Start using Git'], ['Git instalado', 'Git installed'], ['Versão ', 'Version '],
    ['Não encontrei o Git neste computador. Instale e reinicie o VS Code.', "I couldn't find Git on this computer. Install it and restart VS Code."],
    ['Baixar o Git', 'Download Git'], ['Seu nome e e-mail', 'Your name and email'],
    ['O Git precisa saber quem é você para assinar os seus commits.', 'Git needs to know who you are to sign your commits.'],
    ['Repositório nesta pasta', 'Repository in this folder'], ['Esta pasta já usa Git.', 'This folder already uses Git.'],
    ['Esta pasta ainda não usa Git. Crie o repositório para começar a guardar o histórico.', "This folder doesn't use Git yet. Create the repository to start keeping history."],
    ['Abra a pasta do seu projeto para continuar.', 'Open your project folder to continue.'],
    ['Criar repositório', 'Create repository'], ['Abrir pasta', 'Open folder'], ['Conta do GitHub', 'GitHub account'],
    ['Conectado como ', 'Connected as '],
    ['Opcional. Entre para enviar o seu projeto ao GitHub sem digitar senha.', 'Optional. Sign in to send your project to GitHub without typing a password.'],
    ['Entrar com GitHub', 'Sign in with GitHub'], ['Repositório online', 'Online repository'],
    ['Este projeto já está ligado a um repositório online.', 'This project is already linked to an online repository.'],
    ['Opcional. Crie um repositório no GitHub agora ou cole o endereço de um que você já tenha.', 'Optional. Create a GitHub repository now or paste the address of one you already have.'],
    ['Criar no GitHub', 'Create on GitHub'], ['Crie o repositório local antes.', 'Create the local repository first.'],
    ['Colar URL', 'Paste URL'], ['Fechar guia', 'Close guide'], ['Pular por enquanto', 'Skip for now'],
    ['Guia inicial', 'Getting started guide'], ['Abrir o guia inicial', 'Open the getting started guide'],
    ['Bem-vindo ao Quick Git', 'Welcome to Quick Git'],
    ['Confira ou refaça a configuração quando quiser.', 'Check or redo the setup whenever you want.'],
    ['Vamos deixar tudo pronto em poucos passos. Você pode pular e voltar depois no ícone de ajuda.', "Let's get everything ready in a few steps. You can skip and come back later from the help icon."],
    ['(sem branch)', '(no branch)'], ['Criar nova branch', 'Create new branch'],
    ['Atualização (rebase) pausada', 'Update (rebase) paused'], ['Atualização (merge) pausada', 'Update (merge) paused'],
    ['Arquivos em conflito', 'Files in conflict'],
    ['Estes arquivos foram mudados por você e por outra pessoa ao mesmo tempo. Abra cada um, escolha o que deve ficar e clique em "Resolvido".', 'These files were changed by you and someone else at the same time. Open each one, choose what stays and click "Resolved".'],
    ['Todos os conflitos foram resolvidos. Clique em "Continuar" para terminar.', 'All conflicts are resolved. Click "Continue" to finish.'],
    ['Cancelar tudo', 'Cancel everything'],
    ['Você está fora de uma branch. Escolha uma branch no topo para sincronizar.', "You're not on a branch. Pick a branch at the top to sync."],
    ['Este projeto ainda só existe no seu computador. Conecte-o a um repositório online (GitHub, GitLab...) para guardar e compartilhar seu trabalho.', 'This project only exists on your computer. Connect it to an online repository (GitHub, GitLab...) to store and share your work.'],
    ['A branch "', 'The branch "'], ['" ainda só existe no seu computador.', '" only exists on your computer so far.'],
    ['Tudo sincronizado com a nuvem', 'Everything is in sync with the cloud'],
    ['Você tem ', 'You have '], ['. Os dois lados seguiram caminhos diferentes.', '. Both sides went different ways.'],
    ['A nuvem tem ', 'The cloud has '], [' que você ainda não tem.', " that you don't have yet."],
    [' e a nuvem tem ', ' and the cloud has '], [' para enviar', ' to push'], [' para trazer', ' to pull'],
    ['Conectada a ', 'Connected to '],
    ['fetch consulta, pull traz e integra, push envia.', 'fetch checks, pull downloads and merges, push sends.'],
    ['Buscar só confere se há novidades. Trazer baixa as novidades. Enviar manda os seus commits.', 'Fetch only checks for news. Pull downloads the news. Push sends your commits.'],
    ['Nenhuma alteração. Está tudo salvo!', 'No changes. Everything is saved!'],
    ['Marcar todos os arquivos', 'Select all files'], ['Incluir ', 'Include '],
    [' (clique para ver as mudanças)', ' (click to see the changes)'],
    ['Ver o que mudou em ', 'See what changed in '], ['Ver o que mudou', 'See what changed'],
    ['Descartar alterações de ', 'Discard changes in '], ['Descartar alterações', 'Discard changes'], ['Descartar', 'Discard'],
    ['Termine a atualização em andamento antes de fazer um novo commit.', 'Finish the update in progress before making a new commit.'],
    ['Quando você mudar algum arquivo, ele aparece aqui.', 'When you change a file, it shows up here.'],
    ['Marque na lista acima os arquivos que entram neste commit.', 'Select the files for this commit in the list above.'],
    ['Escreva uma descrição curta do que você fez.', 'Write a short description of what you did.'],
    ['. Será salvo como "', '. It will be saved as "'], [' no commit', ' in the commit'],
    ['Na nuvem', 'In the cloud'], ['No seu computador', 'On your computer'],
    ['Coloca os seus commits por cima das novidades, deixando o histórico em linha reta. Ótimo para branches só suas.', 'Puts your commits on top of the new changes, keeping history in a straight line. Great for branches that are only yours.'],
    ['Mistura as novidades na sua branch e pode criar um commit de junção. Mais seguro se outras pessoas usam a mesma branch.', 'Mixes the new changes into your branch and may create a merge commit. Safer if other people use the same branch.'],
    ['Ainda não há outra branch para trazer novidades.', 'There is no other branch to bring changes from yet.'],
    ['não enviado', 'not pushed'], ['só na nuvem', 'cloud only'],
    ['Clique para ver os arquivos alterados', 'Click to see the changed files'],
    ['Commit de junção: mostrando as mudanças em relação à primeira branch.', 'Merge commit: showing the changes relative to the first branch.'],
    ['Este commit não alterou arquivos.', "This commit didn't change any files."],
    ['Ainda não há commits. Salve o primeiro acima!', 'There are no commits yet. Save the first one above!'],
    ['Cada linha colorida é uma branch. Clique em um commit para ver o que mudou.', 'Each colored line is a branch. Click a commit to see what changed.'],
    ['Buscar', 'Fetch'], ['Trazer', 'Pull'], ['Enviar', 'Push'], ['Simples', 'Simple'], ['Avançado', 'Advanced'],
    ['Resolvido', 'Resolved'], ['Continuar', 'Continue'], ['Cancelar', 'Cancel'], ['Abrir', 'Open'],
    ['Alterado', 'Modified'], ['Concluir', 'Finish'], ['Configurar', 'Set up'], ['Copiado', 'Copied'],
    ['Novo', 'New'], ['Renomeado', 'Renamed'], ['Guia', 'Guide'], ['Ver detalhes', 'View details'],
    ['arquivos marcados', 'selected files'], ['arquivo marcado', 'selected file'],
    ['arquivos alterados', 'changed files'], ['arquivo alterado', 'changed file'], ['arquivos', 'files'], ['arquivo', 'file'],
    ['commits novos', 'new commits'], ['commit novo', 'new commit'], ['novidades', 'new changes'], ['novidade', 'new change'],
    ['merge em andamento', 'merge in progress'], ['rebase em andamento', 'rebase in progress'],
    ['recomendado', 'recommended'], ['opcional', 'optional'], [' passos', ' steps'],
    // painel: HTML estático
    ['Atualizar a tela', 'Refresh the screen'], ['Modo de exibição', 'Display mode'], ['Branch atual', 'Current branch'],
    ['Trocar de branch', 'Switch branch'], ['1. Que tipo de mudança é essa?', '1. What kind of change is this?'],
    ['Tipo do commit', 'Commit type'], ['2. Descreva o que você fez', '2. Describe what you did'],
    ['ex.: adiciona tela de login', 'e.g. add login screen'], ['Detalhes (opcional)', 'Details (optional)'],
    ['Detalhes opcionais', 'Optional details'],
    ['Traga para a sua branch as novidades de outra (por exemplo, a ', 'Bring changes from another branch (for example, '],
    ['), sem perder o seu trabalho.', ') into yours, without losing your work.'],
    ['Branch de origem das novidades', 'Source branch for the changes'],
    // configurações no painel
    ["Geral", "General"],
    ["Automático", "Automatic"],
    ["Português", "Portuguese"],
    ["Prefixos", "Prefixes"],
    ["Toque em × para remover. Digite um novo e aperte Enter.", "Tap × to remove. Type a new one and press Enter."],
    ["novo prefixo", "new prefix"],
    ["Adicionar", "Add"],
    ["Remover prefixo ", "Remove prefix "],
    ["Voltar", "Back"],
    ["Limite da mensagem", "Message limit"],
    ["caracteres", "characters"],
    ["Perguntar", "Ask"],
    ["Perguntar: o commit rápido pergunta, e o Enter no painel faz só o commit.", "Ask: the quick commit asks, and Enter in the panel only commits."],
    ["Commit rápido", "Quick commit"],
    ["Perguntar pela branch", "Ask about the branch"],
    ["Antes do commit rápido, escolher manter, trocar ou criar uma branch.", "Before the quick commit, choose to keep, switch or create a branch."],
    ["Configurações", "Settings"],
    ["Abrir configurações", "Open settings"],
    ["Fechar configurações", "Close settings"],
    ["Idioma", "Language"],
    ["Automático (segue o VS Code)", "Automatic (follows VS Code)"],
    ["Português (Brasil)", "Portuguese (Brazil)"],
    ["Prefixos de commit", "Commit prefixes"],
    ["Separe por vírgula. Ex.: feat, fix, perf", "Separate with commas. E.g. feat, fix, perf"],
    ["Limite de caracteres da mensagem", "Message character limit"],
    ["0 = sem limite", "0 = no limit"],
    ["Ação padrão ao commitar", "Default action when committing"],
    ["Perguntar (padrão)", "Ask (default)"],
    ["Só commit", "Commit only"],
    ["Commit e enviar", "Commit and push"],
    ["Perguntar pela branch no commit rápido", "Ask about the branch in quick commit"],
    ["As alterações são salvas automaticamente.", "Changes are saved automatically."],
    ["Restaurar padrões", "Restore defaults"],
    ["Mais opções no VS Code", "More options in VS Code"],
    ["Restaurar as configurações padrão?", "Restore the default settings?"],
    ["Seus prefixos, limite e idioma voltam ao original.", "Your prefixes, limit and language go back to the original."],
    ["Restaurar", "Restore"],
    ["Configurações restauradas ✔", "Settings restored ✔"],
    ["Limite inválido. Use um número de 0 a 500.", "Invalid limit. Use a number from 0 to 500."],
    ["Informe pelo menos um prefixo válido (letras, números, ponto, hífen).", "Enter at least one valid prefix (letters, numbers, dot, hyphen)."],
    // novos (limite, acessibilidade)
    ['A mensagem passa de {} caracteres ({}).', 'The message exceeds {} characters ({}).'],
    ['Commit salvo ✔', 'Commit saved ✔'], ['Arquivo marcado para o commit ✔', 'File staged for the commit ✔'],
    ['Nenhum arquivo para marcar.', 'No file to stage.'],
    ['Quick Git Commit: commit padronizado em poucos cliques', 'Quick Git Commit: standardized commit in a few clicks'],
    // extensão (panel.ts)
    ['Não consegui entrar na sua conta do repositório online. Faça login (GitHub no VS Code ou Git Credential Manager) e tente de novo.', "I couldn't sign in to your online repository account. Sign in (GitHub in VS Code or Git Credential Manager) and try again."],
    ['Não consegui falar com o servidor. Verifique sua internet e tente novamente.', "I couldn't reach the server. Check your internet connection and try again."],
    ['O Git ainda não sabe quem é você. Rode no terminal: git config --global user.name "Seu Nome" e git config --global user.email "voce@email.com".', 'Git doesn\'t know who you are yet. Run in the terminal: git config --global user.name "Your Name" and git config --global user.email "you@email.com".'],
    ['Você tem alterações que seriam sobrescritas. Faça um commit (ou desfaça essas alterações) antes de continuar.', 'You have changes that would be overwritten. Make a commit (or discard those changes) before continuing.'],
    ['Não há nada para salvar no commit.', 'There is nothing to save in the commit.'],
    ['Sua branch e a da nuvem seguiram caminhos diferentes. Use "Atualizar minha branch" (Rebase ou Merge).', 'Your branch and the cloud\'s went different ways. Use "Update my branch" (Rebase or Merge).'],
    ['Esta pasta ainda não está ligada a um repositório online. Use "Conectar à nuvem".', 'This folder isn\'t linked to an online repository yet. Use "Connect to the cloud".'],
    ['Quick Git: abra uma pasta que seja um repositório Git.', 'Quick Git: open a folder that is a Git repository.'],
    ['Verificando novidades na nuvem...', 'Checking the cloud for news...'], ['Trazendo novidades...', 'Pulling changes...'],
    ['Enviando para a nuvem...', 'Pushing to the cloud...'], ['Trocando de branch...', 'Switching branch...'],
    ['Salvando commit...', 'Saving commit...'], ['Atualizando sua branch...', 'Updating your branch...'],
    ['Desfazendo commit...', 'Undoing commit...'], ['Criando repositório no GitHub...', 'Creating repository on GitHub...'],
    ['Criando branch...', 'Creating branch...'],
    ['Criar um repositório Git nesta pasta?', 'Create a Git repository in this folder?'],
    ['Isso começa o controle de versões do seu projeto. Nada é enviado para a internet.', 'This starts version control for your project. Nothing is sent to the internet.'],
    ['Repositório criado ✔', 'Repository created ✔'], ['Quick Git: novidades verificadas ✔', 'Quick Git: news checked ✔'],
    ['Cole o endereço (URL) do repositório online (GitHub, GitLab...)', 'Paste the address (URL) of the online repository (GitHub, GitLab...)'],
    ['Cole o endereço do repositório.', 'Paste the repository address.'],
    ['O endereço não pode ter espaços.', 'The address cannot contain spaces.'], ['Conectado à nuvem ✔', 'Connected to the cloud ✔'],
    ['Você está fora de uma branch (HEAD solto). Escolha uma branch para enviar.', "You're not on a branch (detached HEAD). Pick a branch to push."],
    ['Branch publicada na nuvem ✔', 'Branch published to the cloud ✔'],
    ['Nada para enviar: tudo já está na nuvem ✔', 'Nothing to push: everything is already in the cloud ✔'],
    ['Você não tem commits novos para enviar. A nuvem tem novidades: clique em "Trazer".', 'You have no new commits to push. The cloud has news: click "Pull".'],
    ['A versão na nuvem é diferente da sua.', 'The cloud version is different from yours.'],
    ['Isso acontece quando outra pessoa enviou commits, ou depois de um Rebase.\n\n', 'This happens when someone else pushed commits, or after a Rebase.\n\n'],
    ['• Atualizar primeiro (recomendado): traz as novidades e depois você envia.\n', '• Update first (recommended): pulls the news, then you push.\n'],
    ['• Substituir a nuvem: a nuvem passa a ficar igual à sua branch. Commits que só existem lá serão perdidos.', '• Replace the cloud: the cloud becomes identical to your branch. Commits that only exist there will be lost.'],
    ['Atualizar primeiro', 'Update first'], ['Substituir a nuvem (forçar)', 'Replace the cloud (force)'],
    ['Nuvem atualizada com a sua versão ✔', 'Cloud updated with your version ✔'], ['Commits enviados para a nuvem ✔', 'Commits pushed to the cloud ✔'],
    ['Esta branch ainda não existe na nuvem. Use "Publicar na nuvem" primeiro.', 'This branch doesn\'t exist in the cloud yet. Use "Publish to the cloud" first.'],
    ['Você já está com tudo atualizado ✔', "You're already up to date ✔"], ['Novidades trazidas ({}) ✔', 'Changes pulled ({}) ✔'],
    ['Você e a nuvem têm commits diferentes.', 'You and the cloud have different commits.'],
    ['Como você prefere juntar os dois lados?\n\n', 'How do you prefer to combine both sides?\n\n'],
    ['• Rebase (recomendado): seus commits ficam por cima das novidades, em linha reta.\n', '• Rebase (recommended): your commits go on top of the new changes, in a straight line.\n'],
    ['• Merge: junta os dois lados e cria um commit de junção. Mais seguro se outras pessoas usam esta branch.', '• Merge: joins both sides and creates a merge commit. Safer if other people use this branch.'],
    ['Usar Rebase', 'Use Rebase'], ['Usar Merge', 'Use Merge'], ['Pronto! Sua branch foi atualizada ✔', 'Done! Your branch was updated ✔'],
    ['Quick Git: encontrei conflitos. Resolva os arquivos listados no painel e clique em "Continuar".', 'Quick Git: I found conflicts. Resolve the files listed in the panel and click "Continue".'],
    ['Termine ou cancele a atualização em andamento antes de trocar de branch.', 'Finish or cancel the update in progress before switching branches.'],
    ['Nova branch', 'New branch'], ['Dê um nome para a nova branch (uma "linha de trabalho" separada)', 'Name the new branch (a separate "line of work")'],
    ['Informe um nome.', 'Enter a name.'], ['Nome inválido (evite espaços e caracteres especiais).', 'Invalid name (avoid spaces and special characters).'],
    ['Branch "{}" criada ✔', 'Branch "{}" created ✔'], ['Descartar as alterações de "{}"?', 'Discard the changes in "{}"?'],
    ['Este arquivo é novo: ele será APAGADO do seu computador. Não dá para recuperar.', "This file is new: it will be DELETED from your computer. It can't be recovered."],
    ['Tudo o que você mudou neste arquivo será desfeito e ele volta ao último commit. Não dá para recuperar.', "Everything you changed in this file will be undone and it returns to the last commit. It can't be recovered."],
    ['Este arquivo foi excluído, então não há o que abrir.', 'This file was deleted, so there is nothing to open.'],
    ['{} (antes ↔ marcado para o commit)', '{} (before ↔ staged for the commit)'], ['{} (antes ↔ agora)', '{} (before ↔ now)'], ['{} (antes ↔ {})', '{} (before ↔ {})'],
    ['Tipo de commit inválido.', 'Invalid commit type.'], ['Escreva uma mensagem para o commit.', 'Write a message for the commit.'],
    ['Termine a atualização em andamento (botão "Continuar") antes de fazer um novo commit.', 'Finish the update in progress ("Continue" button) before making a new commit.'],
    ['Marque pelo menos um arquivo para incluir no commit.', 'Select at least one file to include in the commit.'],
    ['Commit salvo: {}: {}', 'Commit saved: {}: {}'],
    ['Escolha de qual branch trazer as novidades.', 'Choose which branch to bring changes from.'],
    ['Já existe uma atualização em andamento. Termine ou cancele antes.', 'There is already an update in progress. Finish or cancel it first.'],
    ['Seus commits serão reaplicados por cima de "{}", deixando o histórico em linha reta.\n\n', 'Your commits will be replayed on top of "{}", keeping history in a straight line.\n\n'],
    ['Atenção: o histórico da sua branch é reescrito. Se ela já foi enviada para a nuvem, depois será preciso um envio forçado. ', 'Attention: your branch history is rewritten. If it was already pushed to the cloud, a forced push will be needed afterwards. '],
    ['Se aparecer conflito, você resolve pelo painel e pode cancelar a qualquer momento.', 'If a conflict appears, you resolve it in the panel and can cancel at any time.'],
    ['As novidades de "{}" serão misturadas na sua branch, e pode ser criado um commit de junção.\n\n', 'The changes from "{}" will be mixed into your branch, and a merge commit may be created.\n\n'],
    ['É a opção mais segura quando a branch já foi enviada ou outras pessoas a usam. Se aparecer conflito, você resolve pelo painel.', "It's the safest option when the branch was already pushed or other people use it. If a conflict appears, you resolve it in the panel."],
    ['Atualizar com Rebase a partir de "{}"?', 'Update with Rebase from "{}"?'], ['Atualizar com Merge a partir de "{}"?', 'Update with Merge from "{}"?'],
    ['Ainda há arquivos em conflito. Resolva todos e marque como resolvidos.', 'There are still files in conflict. Resolve them all and mark them as resolved.'],
    ['Quick Git: há mais conflitos para resolver no próximo passo.', 'Quick Git: there are more conflicts to resolve in the next step.'],
    ['Cancelar a atualização?', 'Cancel the update?'],
    ['Sua branch volta exatamente ao que era antes de você começar. Nenhum trabalho é perdido.', 'Your branch goes back exactly as it was before you started. No work is lost.'],
    ['Cancelar atualização', 'Cancel update'], ['Atualização cancelada. Tudo voltou como era ✔', 'Update cancelled. Everything is back as it was ✔'],
    ['Só é possível desfazer commits que ainda não foram enviados para a nuvem.', "You can only undo commits that haven't been pushed to the cloud yet."],
    ['Desfazer o último commit?', 'Undo the last commit?'],
    ['"{}" deixa de ser um commit, mas as alterações continuam nos seus arquivos, prontas para um novo commit.', '"{}" stops being a commit, but the changes stay in your files, ready for a new commit.'],
    ['Desfazer commit', 'Undo commit'], ['Commit desfeito. Suas alterações continuam aqui ✔', 'Commit undone. Your changes are still here ✔'],
    ['Seu nome (1/2)', 'Your name (1/2)'], ['Este nome aparece nos commits que você faz', 'This name appears on the commits you make'],
    ['Maria Silva', 'Jane Doe'], ['Informe seu nome.', 'Enter your name.'], ['Seu e-mail (2/2)', 'Your email (2/2)'],
    ['Use o mesmo e-mail da sua conta do GitHub para os commits aparecerem no seu perfil', 'Use the same email as your GitHub account so commits show on your profile'],
    ['Informe um e-mail válido.', 'Enter a valid email.'], ['Nome e e-mail salvos ✔', 'Name and email saved ✔'],
    ['Conectado ao GitHub como {} ✔', 'Connected to GitHub as {} ✔'], ['Nome do repositório no GitHub', 'Repository name on GitHub'],
    ['Letras, números, hífen, ponto e sublinhado', 'Letters, numbers, hyphen, dot and underscore'],
    ['Use apenas letras, números, hífen, ponto e sublinhado.', 'Use only letters, numbers, hyphen, dot and underscore.'],
    ['$(lock) Privado', '$(lock) Private'], ['Só você (e quem você convidar) vê', 'Only you (and whoever you invite) can see'],
    ['$(globe) Público', '$(globe) Public'], ['Qualquer pessoa pode ver', 'Anyone can see'],
    ['Quem pode ver este repositório?', 'Who can see this repository?'],
    ['Você já tem um repositório com esse nome no GitHub. Escolha outro nome.', 'You already have a repository with that name on GitHub. Pick another name.'],
    ['O GitHub não autorizou a criação. Entre novamente na sua conta e tente de novo.', "GitHub didn't authorize the creation. Sign in to your account again and try again."],
    ['O GitHub respondeu com erro {}. Tente novamente em instantes.', 'GitHub responded with error {}. Try again in a moment.'],
    ['Repositório criado e enviado: {} ✔', 'Repository created and pushed: {} ✔'],
    ['Repositório criado e conectado ✔ Faça o primeiro commit e clique em "Enviar".', 'Repository created and connected ✔ Make the first commit and click "Push".'],
    // git.ts e quickCommit.ts
    ['Git não encontrado. Instale o Git e reinicie o VS Code.', 'Git not found. Install Git and restart VS Code.'],
    ['Git não encontrado', 'Git not found'], ['Commit inválido.', 'Invalid commit.'],
    ['Nova funcionalidade', 'New feature'], ['Correção de bug', 'Bug fix'], ['Mudanças na documentação', 'Documentation changes'],
    ['Formatação, sem alterar lógica', 'Formatting, no logic change'], ['Refatoração de código', 'Code refactoring'],
    ['Tarefas de manutenção e build', 'Maintenance and build tasks'],
    ['Quick Git Commit: abra uma pasta no VS Code primeiro.', 'Quick Git Commit: open a folder in VS Code first.'],
    ['Escolha o repositório', 'Choose the repository'], ['(HEAD destacado)', '(detached HEAD)'],
    ['$(git-branch) Manter branch atual', '$(git-branch) Keep current branch'],
    ['$(arrow-swap) Trocar para outra branch local', '$(arrow-swap) Switch to another local branch'],
    ['$(add) Criar nova branch', '$(add) Create new branch'], ['Branch atual: {}', 'Current branch: {}'],
    ['Não há outras branches locais.', 'There are no other local branches.'], ['Escolha a branch de destino', 'Choose the target branch'],
    ['Nome da nova branch', 'New branch name'], ['Informe um nome para a branch.', 'Enter a name for the branch.'],
    ['Nome de branch inválido.', 'Invalid branch name.'], ['Selecione o tipo do commit', 'Select the commit type'],
    ['Prefixo', 'Prefix'], ['Mensagem', 'Message'], ['Ação', 'Action'],
    ['Mensagem do commit (será gravado como "{}: ...")', 'Commit message (will be saved as "{}: ...")'],
    ['descreva a mudança', 'describe the change'], ['A mensagem não pode ser vazia.', "The message can't be empty."],
    ['Apenas salvar localmente', 'Only save locally'], ['Salvar e enviar ao remoto', 'Save and push to the remote'],
    ['O que deseja fazer?', 'What do you want to do?'],
    ['Quick Git Commit: esta pasta não é um repositório Git.', 'Quick Git Commit: this folder is not a Git repository.'],
    ['Quick Git Commit: não há alterações para commitar.', 'Quick Git Commit: there are no changes to commit.'],
    ['Commit realizado e enviado: {}: {}', 'Commit done and pushed: {}: {}'], ['Commit realizado: {}: {}', 'Commit done: {}: {}'],
  ];

  const EXACT = new Map(), PATS = [], FRAGS = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [pt, en] of P) {
    if (pt === en) continue;
    if (pt.includes('{}')) {
      const re = new RegExp(pt.split('{}').map(esc).join('([\\s\\S]+?)') + (pt.endsWith('{}') ? '$' : ''));
      PATS.push([re, en, pt.length]);
    } else {
      EXACT.set(pt, en);
      if (pt.length >= 5) FRAGS.push([pt, en]);
    }
  }
  PATS.sort((a, b) => b[2] - a[2]);
  FRAGS.sort((a, b) => b[0].length - a[0].length);
  const fill = (en, m) => { let i = 1; return en.replace(/\{\}/g, () => (m[i++] !== undefined ? m[i - 1] : '')); };

  /** fuzzy=true também traduz trechos dentro de textos maiores (concatenações, prefixos). */
  function translate(s, lang, fuzzy) {
    if (lang !== 'en' || typeof s !== 'string' || !s) return s;
    const e = EXACT.get(s);
    if (e !== undefined) return e;
    let out = s;
    for (const [re, en] of PATS) {
      const m = re.exec(out);
      if (m && (fuzzy || (m.index === 0 && m[0].length === out.length))) {
        out = out.slice(0, m.index) + fill(en, m) + out.slice(m.index + m[0].length);
        if (!fuzzy) return out;
      }
    }
    if (fuzzy) for (const [pt, en] of FRAGS) if (out.includes(pt)) out = out.split(pt).join(en);
    return out;
  }

  /** Painel: traduz o DOM (texto e atributos) e acompanha as mudanças. Conteúdo do usuário é ignorado. */
  function start(lang, skip) {
    if (lang !== 'en' || typeof document === 'undefined') return;
    const ATTRS = ['title', 'aria-label', 'placeholder', 'label'];
    const skipped = (el) => !!el && !!el.closest(skip);
    const attrs = (el) => {
      if (skipped(el)) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) { const r = translate(v, 'en', true); if (r !== v) el.setAttribute(a, r); }
      }
    };
    const fix = (n) => {
      if (n.nodeType === 3) {
        if (skipped(n.parentElement)) return;
        const t = n.nodeValue.trim();
        if (!t) return;
        const r = translate(t, 'en', true);
        if (r !== t) n.nodeValue = n.nodeValue.replace(t, r);
      } else if (n.nodeType === 1) {
        attrs(n);
        n.childNodes.forEach(fix);
      }
    };
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'characterData') fix(m.target);
        else if (m.type === 'attributes') attrs(m.target);
        else m.addedNodes.forEach(fix);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    fix(document.body);
  }

  const api = { translate, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QGCI18N = api;
})(typeof window !== 'undefined' ? window : this);
