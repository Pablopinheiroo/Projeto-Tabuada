# API segura do Projeto Tabuada

Este Worker substitui o acesso direto do navegador ao GitHub. O site está preparado para usar esta API; falta publicar o Worker na conta Cloudflare e inserir o endereço público dele no front-end.

## O que ele faz
- Mantém o token do GitHub apenas como segredo do Cloudflare.
- Registra novas contas e confere senhas no servidor.
- Mantém compatibilidade com contas já gravadas no repositório privado, usando PBKDF2-SHA-256 com 180.000 iterações.
- Entrega sessões assinadas com validade de 7 dias.
- Só permite que uma sessão altere os próprios dados.
- Entrega dados de perfil e histórico para o ranking sem enviar hashes de senha ao navegador.
- Faz o endpoint `/health` testar o acesso real ao repositório privado.

## Publicar no Cloudflare
1. Abra o Cloudflare Dashboard: https://dash.cloudflare.com/
2. Entre em **Workers & Pages** e crie um Worker chamado `projeto-tabuada-api`.
3. Abra **Edit code** e substitua o exemplo pelo arquivo `worker/src/index.js` deste repositório. Salve e faça **Deploy**.
4. No Worker, abra **Settings > Variables and Secrets > Add**.
5. Selecione o tipo **Secret**, nome `GITHUB_TOKEN`, e cole o novo Fine-grained personal access token. Não o coloque em variável de texto simples.
6. O token precisa ter acesso somente ao repositório privado `Pablopinheiroo/Projeto-Tabuada-Dados`, com **Contents: Read and write** e **Metadata: Read-only**.
7. Faça Deploy após adicionar o segredo.
8. Abra `https://ENDERECO-DO-WORKER/health`. A resposta esperada é `ok: true`, `githubSecretConfigured: true` e `githubConnected: true`.
9. Copie o endereço base `https://....workers.dev` e informe-o ao assistente para finalizar a conexão do site. O arquivo `index.html` contém a constante `API_BASE`, que está intencionalmente vazia até receber o endereço real.

## Obrigatório por segurança
- Revogue o token antigo que estava no HTML público. Ele foi exposto no histórico do Git e não deve ser reutilizado.
- Nunca cole o novo token no HTML, no repositório, em variável pública ou nesta conversa.
- Não conceda acesso a outros repositórios.
- Quando o token for trocado no futuro, as sessões atuais expiram; os participantes precisarão entrar novamente.
