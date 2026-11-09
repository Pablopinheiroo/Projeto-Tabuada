# Implementação antiga — somente referência

> **Não use este arquivo para configurar ou publicar o servidor atual.** A implementação ativa está em `worker/src/index.js`, com configuração em `worker/wrangler.toml` e diretório raiz de build `worker`.

Esta pasta `backend/` é uma versão anterior da API. Ela usa outra estrutura de armazenamento (`data/usuarios` e arquivos `dados.enc.json`), outras rotas e um Secret adicional `AUTH_SECRET`. O site atual não usa esse formato.

Para publicar ou manter o jogo atual, siga o arquivo `worker/README.md` e o README da raiz do repositório.
