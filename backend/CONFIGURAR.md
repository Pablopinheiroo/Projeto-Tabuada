# Configuração da API do Projeto Tabuada

A API foi preparada para usar exclusivamente o repositório privado `Pablopinheiroo/Projeto-Tabuada-Dados`. O código do Worker fixa esse destino: ele não recebe o nome de outro repositório por requisição nem oferece operações genéricas do GitHub.

## O que a API permite

- `POST /api/register`: cadastrar usuário.
- `POST /api/login`: autenticar usuário.
- `GET /api/me`: consultar os dados da própria conta autenticada.
- `PUT /api/me`: atualizar histórico, estatísticas e partida salva da própria conta.
- `GET /api/ranking`: consultar o ranking agregado.
- `GET /health`: verificar se a API está ativa.

Não existe rota para apagar arquivos, excluir usuários, alterar o código do jogo, listar ou acessar outros repositórios. A API grava os arquivos em `data/usuarios/<usuario>/dados.enc.json` no repositório privado de dados.

## 1. Criar o repositório privado de dados

Na sua conta GitHub, crie um repositório com estas opções:

- Nome: `Projeto-Tabuada-Dados`
- Visibilidade: **Private**
- README: pode deixar desmarcado.
- Não reutilize o repositório público do jogo.

O repositório de dados pode ficar vazio. O primeiro cadastro criará automaticamente a estrutura de pastas e arquivos.

## 2. Criar o token com acesso limitado

No GitHub, abra Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.

Configure:

1. Nome: `Projeto Tabuada API`.
2. Resource owner: sua conta.
3. Repository access: **Only select repositories**.
4. Selecione somente `Projeto-Tabuada-Dados`.
5. Repository permissions: **Contents — Read and write**.
6. Não conceda permissões de Administration, Metadata além da leitura automática, Actions, Workflows, Issues ou outras permissões.
7. Gere o token e copie-o diretamente para o Secret do Cloudflare. Não o envie no chat, não o coloque no HTML e não o salve no repositório.

**Por que Contents Read and write?** O jogo precisa criar cadastros e atualizar resultados. Um token somente de leitura não conseguiria salvar nada. A permissão fica limitada ao repositório privado de dados; ela não concede acesso de escrita ao repositório do jogo nem aos demais repositórios da conta.

A permissão Contents Read and write do token, isoladamente, tecnicamente permite operações de conteúdo no repositório de dados. A API publicada, porém, só expõe as rotas específicas acima e não implementa exclusão. Mantenha o token secreto no Cloudflare.

## 3. Configurar o Cloudflare Worker

O código está em `backend/worker.js` e a configuração em `backend/wrangler.toml`.

No Cloudflare → Workers & Pages, crie/abra o Worker `projeto-tabuada-dados`. Use o conteúdo completo de `backend/worker.js` e configure:

**Secrets**
- `GITHUB_TOKEN`: o token Fine-grained criado acima.
- `AUTH_SECRET`: uma chave aleatória longa, com pelo menos 32 caracteres. Guarde uma cópia segura; sem ela os dados criptografados não poderão ser lidos.

**Variables**
- `GITHUB_BRANCH`: `main`
- `GITHUB_DIR`: `data/usuarios`
- `ALLOWED_ORIGIN`: `https://pablopinheiroo.github.io`

O repositório de destino já está fixado no código como `Pablopinheiroo/Projeto-Tabuada-Dados`; não é necessário configurar `GITHUB_REPO`.

Faça o Deploy e teste `https://ENDERECO-DO-WORKER/health`. O retorno esperado contém `"ok":true`.

## 4. Armazenamento e senhas

Cada perfil é salvo em arquivo próprio. O conteúdo é criptografado com AES-256-GCM. A senha original nunca é armazenada: o Worker guarda apenas um hash PBKDF2-SHA256 com salt aleatório. Não use senha importante ou reutilizada neste jogo.

Os nomes de usuário aparecem como nomes de pastas no repositório privado, mas o conteúdo dos arquivos fica criptografado.

## 5. Situação da integração

O Worker está preparado no repositório do jogo, mas ainda precisa que você crie o repositório privado, gere o token e configure os Secrets no Cloudflare. Depois disso, será necessário publicar o Worker e conectar o endereço dele ao `index.html`. Até concluir essas etapas, o jogo publicado ainda usa os dados locais do navegador; cadastro e ranking online ainda não estão ativos.
