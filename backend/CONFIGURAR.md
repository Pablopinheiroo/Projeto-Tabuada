# Salvar os dados do Projeto Tabuada no GitHub

O armazenamento foi organizado para criar uma pasta própria para cada usuário no branch `dados`.

## Estrutura criada automaticamente

Quando alguém fizer um cadastro pelo site conectado à API, o Worker cria:

```
data/
└── usuarios/
    ├── maria/
    │   └── dados.json
    ├── joao/
    │   └── dados.json
    └── outro-usuario/
        └── dados.json
```

Cada arquivo guarda o resumo de autenticação, histórico de acertos e erros, tempo de cada questão e partida salva para continuar depois. O GitHub cria a pasta junto com o arquivo no primeiro cadastro daquele usuário.

## Sobre as senhas

A senha digitada **não é salva em texto aberto**. O arquivo guarda um hash PBKDF2-SHA256 com salt aleatório e 150.000 iterações, além de usar um segredo que fica somente no Cloudflare. Isso permite verificar a senha no login sem guardar a senha original. Não coloque senhas importantes ou reutilizadas neste jogo.

**Atenção: o repositório atual é público.** Portanto, os nomes de usuário, históricos, estatísticas, partidas e também os hashes de senha ficarão visíveis para quem abrir o GitHub. O segredo do Cloudflare e o token de acesso ao GitHub não ficam no repositório. Para que os dados dos jogadores não sejam públicos, o ideal é usar um repositório privado separado para os dados.

## Configuração única

### 1. Criar um token limitado no GitHub

1. Abra GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Dê um nome como `Projeto Tabuada Worker`.
3. Em Repository access, escolha **Only select repositories** e marque somente `Projeto-Tabuada`.
4. Em Repository permissions, conceda somente **Contents: Read and write**.
5. Gere o token. Copie-o apenas para cadastrar como Secret no Cloudflare; não o coloque no HTML nem em arquivo do GitHub.

### 2. Publicar o Worker no Cloudflare

1. Abra Cloudflare → Workers & Pages → Create → Worker.
2. Dê o nome `projeto-tabuada-dados`.
3. Abra Edit code e substitua o código de exemplo pelo conteúdo completo de `backend/worker.js` deste repositório.
4. Em Settings → Variables and Secrets, cadastre:

| Nome | Tipo | Valor |
|---|---|---|
| `GITHUB_TOKEN` | Secret | Token fine-grained criado acima |
| `AUTH_SECRET` | Secret | Uma chave aleatória longa, com no mínimo 32 caracteres |
| `GITHUB_REPO` | Variable | `Pablopinheiroo/Projeto-Tabuada` |
| `GITHUB_BRANCH` | Variable | `dados` |
| `GITHUB_DIR` | Variable | `data/usuarios` |
| `ALLOWED_ORIGIN` | Variable | `https://pablopinheiroo.github.io` |

5. Salve as variáveis e faça Deploy.
6. Abra `https://ENDERECO-DO-WORKER/health`. Deve aparecer `"ok": true` e `"storage": "one-folder-per-user"`.

## Conectar o site

O código do Worker já está no GitHub, mas precisa ser publicado no Cloudflare. Depois, o endereço `workers.dev` deverá ser conectado ao `index.html) para o cadastro, login, ranking e salvamento do jogo usarem a API. Até essa ligação ser feita, o site publicado continua usando os perfis locais do navegador.

## Rotas disponíveis

- `GET /health`: verifica se o Worker está ativo.
- `POST /api/register`: cria a pasta e o arquivo do novo usuário.
- `POST /api/login`: verifica a senha e inicia uma sessão.
- `GET /api/me`: recupera histórico e partida do usuário.
- `PUT /api/me`: salva histórico e partida.
- `GET /api/ranking`: retorna o ranking de todos os perfis.
