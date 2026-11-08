# Salvar os dados do Projeto Tabuada no GitHub

Esta solução usa o próprio repositório GitHub como armazenamento. Não usa Supabase nem banco D1. Um Cloudflare Worker funciona apenas como ponte segura: recebe os dados do site e grava o arquivo JSON no branch `dados`.

## Estado atual

- O código do Worker está em `backend/worker.js`.
- O branch `dados` já foi criado.
- O arquivo de dados será criado automaticamente em `data/usuarios.json`, no primeiro cadastro.
- O site ainda precisa receber a URL do Worker para trocar o login local pelo login online. Depois que o Worker estiver publicado, informe a URL `https://...workers.dev` para concluir essa ligação no `index.html`.

## Configuração única no GitHub

1. No GitHub, abra **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Dê um nome como `Projeto Tabuada Worker`.
3. Em **Repository access**, selecione **Only select repositories** e marque somente `Projeto-Tabuada`.
4. Em **Repository permissions**, deixe **Contents: Read and write**. Não conceda permissões para Issues, Actions, Administration ou outros recursos.
5. Gere o token e copie-o. Ele será cadastrado como Secret no Cloudflare, nunca no HTML.

## Criar o Worker no Cloudflare

1. Abra **Workers & Pages → Create → Worker** e dê o nome `projeto-tabuada-dados`.
2. Abra **Edit code**, substitua o código de exemplo pelo conteúdo completo de `backend/worker.js` deste repositório e salve/deploy.
3. Em **Settings → Variables and Secrets**, adicione:

| Nome | Tipo | Valor |
|---|---|---|
| `GITHUB_TOKEN` | Secret | O token fine-grained criado no GitHub |
| `AUTH_SECRET` | Secret | Uma chave aleatória longa, com pelo menos 32 caracteres |
| `GITHUB_REPO` | Variable | `Pablopinheiroo/Projeto-Tabuada` |
| `GITHUB_BRANCH` | Variable | `dados` |
| `GITHUB_FILE` | Variable | `data/usuarios.json` |
| `ALLOWED_ORIGIN` | Variable | `https://pablopinheiroo.github.io` |

4. Salve e faça **Deploy** novamente para aplicar as variáveis.
5. Teste abrindo `https://URL-DO-WORKER/health`. A resposta esperada é um JSON com `"ok": true`.

## Importante sobre privacidade

O repositório `Projeto-Tabuada` é público. Portanto, o arquivo `data/usuarios.json` também poderá ser visto por qualquer pessoa no GitHub, incluindo nomes de usuário, histórico, dificuldades e progresso salvo. As senhas não são gravadas em texto aberto: o Worker guarda um resumo criptográfico que depende de um segredo mantido no Cloudflare. Mesmo assim, use apenas senhas simples e exclusivas para este jogo. Não reutilize senhas de outros serviços.

Para manter os dados privados, seria necessário guardar o JSON em um repositório privado separado e apontar o Worker para ele.

## Rotas da API

- `GET /health` — verifica se o Worker está ativo.
- `POST /api/register` — cria um usuário.
- `POST /api/login` — autentica.
- `GET /api/me` — recupera o histórico e a partida do usuário autenticado.
- `PUT /api/me` — salva o histórico e a partida.
- `GET /api/ranking` — fornece o ranking público sem os dados de autenticação.

O Worker usa o token apenas no lado do servidor para chamar a API de conteúdo do GitHub. Nunca coloque o token no `index.html`.
