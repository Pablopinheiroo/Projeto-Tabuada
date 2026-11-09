# API ativa do Projeto Tabuada

Esta é a única implementação ativa do servidor. O Worker é publicado pelo Cloudflare Workers Builds a partir da pasta `worker/`.

## Configuração de publicação

- Repositório: `Pablopinheiroo/Projeto-Tabuada`
- Branch: `main`
- Root directory: `worker`
- Build command: deixe vazio
- Deploy command: `npm run deploy`
- Nome do Worker: `projeto-tabuada-api`

Arquivos:
- `src/index.js`: autenticação, perfis, comunidade, desafios, torneio mensal e recompensas.
- `wrangler.toml`: bindings de rate limit, observabilidade e Secret obrigatório.
- `package.json`: Wrangler e comando `deploy`.

## Segredo e armazenamento

Configure o Secret `GITHUB_TOKEN` no Cloudflare. Use um Fine-grained token que tenha acesso somente ao repositório privado `Pablopinheiroo/Projeto-Tabuada-Dados`, com Contents Read and write. Nunca coloque esse token no repositório ou no site.

Os perfis são salvos em `usuarios/<usuario>/dados.json`. Índices e arquivos de desafios ficam em `desafios/`; os resultados do torneio mensal ficam em um arquivo por mês. Os arquivos de perfil guardam o hash PBKDF2 da senha, nunca a senha original.

A senha usa PBKDF2-SHA-256 com 100.000 iterações, compatível com WebCrypto usado pelo Worker. As sessões têm validade de 7 dias e são assinadas no servidor.

## Rotas

- `GET /health`: estado do Worker, build ID e funcionalidades.
- `POST /api/auth/register`, `POST /api/auth/login`: autenticação.
- `GET/PUT /api/me`, `POST /api/me/password`: conta e senha.
- `GET /api/community`: resumos públicos da comunidade.
- `GET /api/challenges/players`, `GET/POST /api/challenges`, `POST /api/challenges/:id/result`: desafios.
- `GET /api/tournament`, `POST /api/tournament/start`, `POST /api/tournament/submit`: torneio mensal.
- `POST /api/game/reward`, `POST /api/game/shop`: recompensas e loja.

## Uso cuidadoso do plano Free

- Não declare a seção `[limits]` no Wrangler; o plano Free aplica os limites padrão.
- O endpoint de comunidade lê no máximo 40 perfis por atualização e mantém cache no Worker.
- A lista de participantes usa uma chamada para listar contas e lê metadados públicos de até 45 perfis (até 46 subrequests no total).
- O site guarda o tempo ativo localmente e sincroniza o perfil a cada 30 minutos.
- A lista de desafios é consultada a cada 3 minutos enquanto o usuário está na sessão.
- Logs persistentes, invocation logs e traces estão desligados. Métricas básicas do Worker continuam disponíveis.

## Verificação

Depois do deploy, abra `/health`. A resposta inclui o `buildId` e indicadores das funcionalidades. Isso permite diferenciar a versão publicada da versão que ainda está no GitHub.
