# API segura do Projeto Tabuada

O jogo já está preparado para usar esta API. O servidor será publicado no Cloudflare Workers e conectado ao repositório pelo recurso **Workers Builds**, para que futuras mudanças no código sejam publicadas automaticamente.

## Arquivos do servidor
- `src/index.js`: rotas de cadastro, login, perfil, senha e ranking.
- `wrangler.toml`: nome e entrada do Worker.
- `package.json`: versão do Wrangler e comando de publicação.

## 1. Criar o Worker no Cloudflare
1. Acesse https://dash.cloudflare.com/ e abra **Workers & Pages**.
2. Crie um Worker com o nome exato `projeto-tabuada-api`. Pode publicar inicialmente o exemplo oferecido pelo Cloudflare.
3. Abra o Worker criado.

## 2. Conectar este repositório ao Worker
1. Dentro do Worker, entre em **Settings > Build**.
2. Escolha **Connect** para conectar uma conta do GitHub e autorize **Cloudflare Workers and Pages**.
3. Na autorização do GitHub, limite o acesso a **Only select repositories** e marque somente `Projeto-Tabuada`. Não conceda acesso a todos os repositórios.
4. Nas configurações de build, selecione:
   - **Git repository:** `Pablopinheiroo/Projeto-Tabuada`
   - **Branch:** `main`
   - **Root directory:** `worker`
   - **Build command:** deixe vazio
   - **Deploy command:** `npm run deploy`
5. Salve as configurações. O Cloudflare usará `worker/wrangler.toml` e `worker/package.json` para publicar o código. O nome do Worker deve continuar sendo `projeto-tabuada-api`, igual ao nome no arquivo Wrangler.

Depois dessa conexão, alterações futuras enviadas à pasta `worker/` na branch `main` serão publicadas automaticamente pelo Cloudflare Workers Builds.

## 3. Configurar a credencial privada do GitHub
1. No Worker, abra **Settings > Variables and Secrets**.
2. Adicione uma variável do tipo **Secret** (segredo de execução):
   - **Name:** `GITHUB_TOKEN`
   - **Value:** um novo Fine-grained personal access token do GitHub.
3. Configure esse token para ter acesso somente ao repositório privado `Pablopinheiroo/Projeto-Tabuada-Dados`, com:
   - **Contents:** Read and write
   - **Metadata:** Read-only (normalmente obrigatório e selecionado automaticamente)
4. Salve o segredo e faça um novo Deploy, caso o Cloudflare solicite.

**Importante:** não use token antigo que já tenha aparecido no HTML ou no histórico do Git. Revogue esse token antigo nas configurações do GitHub. Nunca coloque o novo token no código, no repositório, em variável pública ou nesta conversa. O token deve existir somente como Secret no Cloudflare.

## 4. Testar e ligar o jogo
Abra o endereço do Worker seguido de `/health`, por exemplo:

`https://projeto-tabuada-api.SUA-CONTA.workers.dev/health`

A resposta esperada contém:
- `"ok": true`
- `"githubSecretConfigured": true`
- `"githubConnected": true`
- `"githubContentReadAccess": true`

Esse teste confirma que o segredo existe e que o Worker consegue ler o diretório `usuarios`. A permissão de gravação será confirmada no primeiro cadastro. Depois, informe somente o endereço público base do Worker (sem `/health`). O site será então ligado a esse endereço em `API_BASE`. Não envie o token.

## O que a API faz
- Guarda o token do GitHub somente no segredo do Cloudflare.
- Registra contas e confere senhas no servidor.
- Mantém compatibilidade com contas antigas usando PBKDF2-SHA-256 com 180.000 iterações.
- Cria sessões assinadas com validade de 7 dias.
- Permite que cada sessão altere somente os próprios dados.
- Fornece dados necessários ao ranking sem enviar hashes de senha ao navegador.
- Testa a conexão com o repositório privado pelo endpoint `/health`.

