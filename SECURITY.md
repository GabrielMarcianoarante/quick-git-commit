# Segurança

- **Sem telemetria.** A extensão não coleta nem envia dados de uso. A única chamada de rede própria é a verificação opcional de atualização (API pública de releases do GitHub; desative com `quickGitCommit.checkForUpdates`).
- **Sem shell.** O Git é executado com `execFile` (argumentos separados), sem interpretar texto como comando. Nomes de branch e hashes vindos do painel são validados e nunca começam com `-`.
- **Painel isolado.** O webview usa CSP restrita (`default-src 'none'`, scripts só com nonce aleatório criptográfico) e só carrega arquivos da pasta `media`.
- **Credenciais.** Usam o login do VS Code / Git Credential Manager; nada é gravado pela extensão. Credenciais em URLs são mascaradas em logs e mensagens.
- **Pasta não confiável.** A extensão não roda em pastas sem Workspace Trust, pois hooks e configs do repositório podem executar código.
- **Ações destrutivas** (apagar branch, reverter, limpar) sempre pedem confirmação e avisam quando há commits não mesclados.
- Para relatar uma vulnerabilidade, abra um aviso privado de segurança no repositório do projeto (Security → Report a vulnerability).
