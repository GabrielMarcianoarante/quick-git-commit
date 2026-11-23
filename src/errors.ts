/** Mensagens de erro em linguagem simples. Nenhum texto técnico do Git deve chegar ao usuário. */

/**
 * O GitHub recusa o envio de arquivos em .github/workflows quando o login não tem a permissão "workflow":
 * "refusing to allow an OAuth App to create or update workflow `...` without `workflow` scope".
 */
export function isMissingWorkflowScope(raw: string): boolean {
  return /without\s+[`'"]?workflow[`'"]?\s+scope/i.test(raw);
}

/** Traduz erros comuns do Git para uma linguagem que qualquer pessoa entende. */
export function friendly(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('git não encontrado')) {
    return raw;
  }
  if (
    m.includes('authentication failed') ||
    m.includes('could not read username') ||
    m.includes('terminal prompts disabled') ||
    m.includes('permission denied') ||
    m.includes('invalid username or password')
  ) {
    return 'Não consegui entrar na sua conta do repositório online. Faça login (GitHub no VS Code ou Git Credential Manager) e tente de novo.';
  }
  if (isMissingWorkflowScope(raw)) {
    return 'O GitHub bloqueou o envio: falta a permissão "workflow" na sua conta conectada. Tente "Enviar" de novo para autorizar.';
  }
  if (m.includes('src refspec') && m.includes('does not match any')) {
    return 'Ainda não há nenhum commit nesta branch para enviar. Salve um commit primeiro e depois clique em Enviar.';
  }
  if (m.includes('gh013') || m.includes('push protection') || m.includes('secret scanning')) {
    return 'O GitHub bloqueou o envio porque encontrou uma senha ou chave secreta dentro dos arquivos. Tire o segredo do commit antes de enviar.';
  }
  if (m.includes('gh001') || m.includes('file size limit') || m.includes('this exceeds github')) {
    return 'Um arquivo é grande demais para o GitHub (o limite é 100 MB). Tire-o do commit e tente de novo.';
  }
  if (m.includes('fetch first') || m.includes('non-fast-forward') || m.includes('tip of your current branch is behind') || (m.includes('[rejected]') && m.includes('failed to push'))) {
    return 'A nuvem tem novidades que você ainda não tem. Clique em "Trazer" (ou "Atualizar minha branch") e depois envie de novo.';
  }
  if (m.includes('has no upstream branch') || m.includes('no upstream configured')) {
    return 'Esta branch ainda não existe na nuvem. Use "Publicar na nuvem".';
  }
  if (m.includes('unrelated histories')) {
    return 'O projeto do seu computador e o repositório online começaram separados e não têm histórico em comum. Use um repositório online novo e vazio.';
  }
  if (m.includes('index.lock') || m.includes('another git process')) {
    return 'Outro processo do Git está rodando nesta pasta. Espere alguns segundos e tente de novo.';
  }
  if (m.includes('not a git repository')) {
    return 'Esta pasta ainda não é um repositório Git. Crie o repositório pelo guia inicial.';
  }
  if (m.includes('rpc failed') || m.includes('remote end hung up') || m.includes('timed out') || m.includes('http 408') || m.includes('http 5')) {
    return 'A conexão com a nuvem caiu ou demorou demais. Tente novamente em instantes.';
  }
  if (m.includes('pathspec') && m.includes('did not match')) {
    return 'O Git não encontrou esse arquivo ou branch. Atualize o painel e tente de novo.';
  }
  if (m.includes('conflict') && (m.includes('merge') || m.includes('automatic'))) {
    return 'Houve conflito entre as alterações. Siga os passos da seção de conflitos do painel.';
  }
  if (m.includes('protected branch') || m.includes('gh006') || m.includes('pre-receive hook declined') || m.includes('remote rejected')) {
    return 'A nuvem recusou o envio: esta branch é protegida ou você não tem permissão para escrever nela. Crie uma branch sua e abra um Pull Request.';
  }
  if (m.includes('error: 403') || m.includes('returned error: 403') || m.includes('access denied') || m.includes('not allowed')) {
    return 'Você não tem permissão para acessar/alterar esta branch ou repositório (acesso negado). Peça acesso ao responsável pelo repositório.';
  }
  if (m.includes('repository not found') || m.includes('error: 404')) {
    return 'Repositório não encontrado ou sem acesso para a sua conta. Confirme o endereço e peça acesso, se necessário.';
  }
  if (m.includes('did not match any') || m.includes('invalid reference')) {
    return 'Essa branch não existe mais neste computador nem na nuvem. Atualize a lista (verificar novidades) e tente de novo.';
  }
  if (m.includes('already checked out') || m.includes('is already used by worktree')) {
    return 'Essa branch já está aberta em outra pasta de trabalho (worktree). Feche-a lá ou escolha outra branch.';
  }
  if (m.includes('could not resolve host') || m.includes('unable to access') || m.includes('network is unreachable')) {
    return 'Não consegui falar com o servidor. Verifique sua internet e tente novamente.';
  }
  if (m.includes('please tell me who you are') || m.includes('unable to auto-detect email')) {
    return 'O Git ainda não sabe quem é você. Rode no terminal: git config --global user.name "Seu Nome" e git config --global user.email "voce@email.com".';
  }
  if (m.includes('would be overwritten') || m.includes('your local changes')) {
    return 'Você tem alterações que seriam sobrescritas. Faça um commit (ou desfaça essas alterações) antes de continuar.';
  }
  if (m.includes('nothing to commit')) {
    return 'Não há nada para salvar no commit.';
  }
  if (m.includes('not possible to fast-forward') || m.includes('diverging branches')) {
    return 'Sua branch e a da nuvem seguiram caminhos diferentes. Use "Atualizar minha branch" (Rebase ou Merge).';
  }
  if (m.includes('no remote') || m.includes("'origin' does not appear to be a git repository")) {
    return 'Esta pasta ainda não está ligada a um repositório online. Use "Conectar à nuvem".';
  }
  const cleaned = raw
    .split('\n')
    .map((l) => l.trim().replace(/^(error|fatal|warning):\s*/i, ''))
    .filter((l) => l && !/^hint:/i.test(l))
    .map((l) => l.replace(/\s*to\s+'?https?:\/\/[^\s']+'?/gi, ''))
    .slice(0, 2)
    .join(' ');
  const detail = cleaned.length > 300 ? cleaned.slice(0, 300) + '…' : cleaned;
  return detail ? `Não foi possível concluir a ação. Detalhe: ${detail}` : 'Não foi possível concluir a ação. Veja os detalhes para mais informações.';
}
