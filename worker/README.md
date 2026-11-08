# API segura do Projeto Tabuada

Este Worker substitui o acesso direto do navegador ao GitHub.

## O que ele faz
- Mantém o token do GitHub apenas como segredo do Cloudflare.
- Registra novas contas e confere senhas no servidor.
- Mantém compatibilidade com senhas já salvas no formato PBKDF2-SHA-256 com 180.000 iterações.
- Entrega sessões assinadas por 7 dias.
- Só permite que uma sessão altere os próprios dados.
- Entrega dados públicos de perfil e histórico para o ranking sem expor os hashes de senha.

## Preparação no Cloudflare
1. Abra Workers & Pages e crie um Worker com o nome `projeto-tabuada-api`.
2. Abra o Worker > Edit code e cole o conteúdo de `src/index.js`. Salve e faça Deploy.
3. Em Settings > Variables and Secrets, adicione um item do tipo **Secret** chamado `GITHUB_TOKEN`.
4. O valor deve ser um Fine-grained personal access token novo, com acesso somente ao repositório privado `Pablopinheiroo/Projeto-Tabuada-Dados`, permissão **Contents: Read and write** e **Metadata: Read-only**.
5. Faça Deploy depois de adicionar o segredo.
6. Abra `https://URL-DO-SEU-WORKER/health`. Ele deve responder com `ok: true` e `githubSecretConfigured: true`.
7. Copie o endereço `https://...` do Worker. O front-end do jogo será ligado a esse endereço em `API_BASE`.

## Importante
- Revogue o token antigo que estava no HTML público. Não o reutilize.
- Nunca coloque o novo token no HTML, no GitHub do projeto, em variáveis públicas, nem nesta conversa.
- Não habilite permissões para outros repositórios.
- O Worker usa o token como chave de assinatura das sessões; quando o token for trocado, os usuários precisarão entrar novamente.
