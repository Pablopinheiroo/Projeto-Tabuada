/**
 * Projeto Tabuada — armazenamento GitHub via Cloudflare Worker
 * Os dados são gravados no arquivo data/usuarios.json do branch "dados".
 * Configure GITHUB_TOKEN e AUTH_SECRET como Secrets no Cloudflare.
 */
const API = "https://api.github.com";
const DEFAULT_REPO = "Pablopinheiroo/Projeto-Tabuada";
const DEFAULT_BRANCH = "dados";
const DEFAULT_FILE = "data/usuarios.json";
const DEFAULT_ORIGIN = "https://pablopinheiroo.github.io";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value) {
  const base = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base + "=".repeat((4 - base.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors }
  });
}
function getCors(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  if (origin && origin !== allowed) return null;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function repoConfig(env) {
  return {
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
    file: env.GITHUB_FILE || DEFAULT_FILE
  };
}
function githubHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error("Secret GITHUB_TOKEN não configurado no Worker.");
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Projeto-Tabuada"
  };
}
function fileUrl(env) {
  const cfg = repoConfig(env);
  const path = cfg.file.split("/").map(encodeURIComponent).join("/");
  return API + "/repos/" + cfg.repo + "/contents/" + path + "?ref=" + encodeURIComponent(cfg.branch);
}
async function readStore(env) {
  const response = await fetch(fileUrl(env), { headers: githubHeaders(env) });
  if (response.status === 404) return { data: { version: 1, users: {} }, sha: null };
  if (!response.ok) throw new Error("GitHub não conseguiu ler o arquivo de dados (" + response.status + ").");
  const file = await response.json();
  if (!file.content) throw new Error("O arquivo de dados no GitHub está vazio ou em formato inválido.");
  const binary = atob(file.content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  const data = JSON.parse(dec.decode(bytes));
  if (!data || typeof data !== "object" || !data.users) throw new Error("Estrutura do arquivo de dados inválida.");
  return { data, sha: file.sha };
}
function encodeUtf8Base64(value) {
  const encoded = b64url(enc.encode(value));
  return encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4);
}
async function writeStore(env, data, sha) {
  const cfg = repoConfig(env);
  const content = encodeUtf8Base64(JSON.stringify(data, null, 2));
  const body = {
    message: "Atualizar dados do Projeto Tabuada",
    content,
    branch: cfg.branch
  };
  if (sha) body.sha = sha;
  return fetch(fileUrl(env).split("?")[0], {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
async function mutateStore(env, mutate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readStore(env);
    const result = mutate(current.data);
    if (result && result.abort) return result;
    const response = await writeStore(env, current.data, current.sha);
    if (response.ok) return result || {};
    const message = await response.text();
    if (response.status !== 409 && response.status !== 422) {
      throw new Error("GitHub recusou a gravação (" + response.status + "). " + message.slice(0, 180));
    }
  }
  throw new Error("Muitos salvamentos ao mesmo tempo. Tente novamente em alguns segundos.");
}
async function hmac(env, message) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error("Secret AUTH_SECRET deve ter pelo menos 32 caracteres.");
  const key = await crypto.subtle.importKey("raw", enc.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function passwordDigest(env, salt, password) {
  return b64url(await hmac(env, "password-v1:" + salt + ":" + password));
}
async function issueToken(env, username) {
  const payload = b64url(enc.encode(JSON.stringify({ sub: username, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })));
  const signature = b64url(await hmac(env, "session-v1:" + payload));
  return payload + "." + signature;
}
async function authenticate(request, env, store) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const expected = await hmac(env, "session-v1:" + parts[0]);
    if (!constantEqual(expected, fromB64url(parts[1]))) return null;
    const payload = JSON.parse(dec.decode(fromB64url(parts[0])));
    if (!payload.sub || payload.exp < Date.now() || !store.users[payload.sub]) return null;
    return payload.sub;
  } catch (_) {
    return null;
  }
}
async function readJson(request, maxBytes) {
  const text = await request.text();
  if (enc.encode(text).length > (maxBytes || 350000)) throw new Error("Dados enviados ultrapassam o limite permitido.");
  return JSON.parse(text);
}
function publicUserData(record) {
  return { history: record.history || { questions: {}, sessions: [] }, checkpoint: record.checkpoint || null };
}
function rankingFor(data) {
  return Object.entries(data.users || {}).map(([username, record]) => {
    const questions = Object.values((record.history && record.history.questions) || {});
    const correct = questions.reduce((sum, q) => sum + (Number(q.correct) || 0), 0);
    const wrong = questions.reduce((sum, q) => sum + (Number(q.wrong) || 0), 0);
    let timeMs = questions.reduce((sum, q) => sum + (Number(q.totalTimeMs) || 0), 0);
    if (record.checkpoint) timeMs += Number(record.checkpoint.currentElapsedMs) || 0;
    const hard = questions.filter(q => Number(q.wrong) > 0)
      .sort((a, b) => (Number(b.wrong) || 0) - (Number(a.wrong) || 0))
      .slice(0, 3)
      .map(q => ({ a: Number(q.a), b: Number(q.b), wrong: Number(q.wrong) || 0 }));
    return { username, correct, wrong, attempts: correct + wrong, timeMs, hard };
  }).sort((a, b) => b.timeMs - a.timeMs || b.correct - a.correct);
}

export default {
  async fetch(request, env) {
    const cors = getCors(request, env);
    if (!cors) return json({ error: "Origem não autorizada." }, 403, {});
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, service: "projeto-tabuada-github-storage" }, 200, cors);
      }
      if (path === "/api/ranking" && request.method === "GET") {
        const store = await readStore(env);
        return json({ users: rankingFor(store.data) }, 200, cors);
      }
      if (path === "/api/register" && request.method === "POST") {
        const body = await readJson(request, 8000);
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return json({ error: "Nome de usuário inválido." }, 400, cors);
        if (password.length < 8 || password.length > 100) return json({ error: "A senha deve ter entre 8 e 100 caracteres." }, 400, cors);
        const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
        const passwordHash = await passwordDigest(env, salt, password);
        const result = await mutateStore(env, data => {
          data.users = data.users || {};
          if (data.users[username]) return { abort: true };
          data.users[username] = {
            salt, passwordHash, createdAt: new Date().toISOString(),
            history: { questions: {}, sessions: [] }, checkpoint: null
          };
          return { username };
        });
        if (result && result.abort) return json({ error: "Este nome de usuário já está cadastrado." }, 409, cors);
        const token = await issueToken(env, username);
        return json({ token, username }, 201, cors);
      }
      if (path === "/api/login" && request.method === "POST") {
        const body = await readJson(request, 8000);
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        const store = await readStore(env);
        const record = store.data.users && store.data.users[username];
        if (!record) return json({ error: "Usuário ou senha incorretos." }, 401, cors);
        const digest = await passwordDigest(env, record.salt, password);
        if (!constantEqual(enc.encode(digest), enc.encode(record.passwordHash || ""))) {
          return json({ error: "Usuário ou senha incorretos." }, 401, cors);
        }
        const token = await issueToken(env, username);
        return json({ token, username }, 200, cors);
      }
      if (path === "/api/me" && request.method === "GET") {
        const store = await readStore(env);
        const username = await authenticate(request, env, store.data);
        if (!username) return json({ error: "Sessão inválida. Entre novamente." }, 401, cors);
        return json({ username, ...publicUserData(store.data.users[username]) }, 200, cors);
      }
      if (path === "/api/me" && request.method === "PUT") {
        const body = await readJson(request, 350000);
        // Confere a sessão no estado atual do arquivo antes de salvar.
        const store = await readStore(env);
        const username = await authenticate(request, env, store.data);
        if (!username) return json({ error: "Sessão inválida. Entre novamente." }, 401, cors);
        if (!body.history || typeof body.history !== "object" || !body.history.questions) {
          return json({ error: "Histórico inválido." }, 400, cors);
        }
        const saved = await mutateStore(env, data => {
          if (!data.users || !data.users[username]) return { abort: true };
          data.users[username].history = body.history;
          data.users[username].checkpoint = body.checkpoint || null;
          data.users[username].updatedAt = new Date().toISOString();
          return { ok: true };
        });
        if (saved && saved.abort) return json({ error: "Usuário não encontrado." }, 404, cors);
        return json({ ok: true, savedAt: new Date().toISOString() }, 200, cors);
      }
      return json({ error: "Rota não encontrada." }, 404, cors);
    } catch (error) {
      return json({ error: error.message || "Erro interno ao acessar os dados." }, 500, cors);
    }
  }
};
