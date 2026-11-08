/**
 * Projeto Tabuada — API de armazenamento GitHub.
 * Cria um arquivo por usuário em data/usuarios/<usuario>/dados.json
 * Senhas nunca são armazenadas em texto aberto: somente salt + PBKDF2.
 * Configure GITHUB_TOKEN e AUTH_SECRET como Secrets no Cloudflare.
 */
const API = "https://api.github.com";
const DEFAULT_REPO = "Pablopinheiroo/Projeto-Tabuada";
const DEFAULT_BRANCH = "dados";
const DEFAULT_DIR = "data/usuarios";
const DEFAULT_ORIGIN = "https://pablopinheiroo.github.io";
const ITERATIONS = 150000;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function unb64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function b64url(bytes) {
  return b64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return unb64(normalized + "=".repeat((4 - normalized.length % 4) % 4));
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
function config(env) {
  return {
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
    dir: (env.GITHUB_DIR || DEFAULT_DIR).replace(/^\/+|\/+$/g, "")
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
function userPath(env, username) {
  const c = config(env);
  return c.dir + "/" + username + "/dados.json";
}
function contentsUrl(env, path, includeRef = true) {
  const c = config(env);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return API + "/repos/" + c.repo + "/contents/" + encodedPath + (includeRef ? "?ref=" + encodeURIComponent(c.branch) : "");
}
async function githubRead(env, path) {
  const response = await fetch(contentsUrl(env, path), { headers: githubHeaders(env) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("GitHub não conseguiu ler os dados (" + response.status + ").");
  const file = await response.json();
  if (!file.content) throw new Error("Arquivo de usuário vazio ou inválido.");
  const bytes = unb64(file.content.replace(/\s/g, ""));
  return { record: JSON.parse(dec.decode(bytes)), sha: file.sha };
}
async function githubWrite(env, path, record, sha, message) {
  const body = {
    message,
    content: b64(enc.encode(JSON.stringify(record, null, 2))),
    branch: config(env).branch
  };
  if (sha) body.sha = sha;
  return fetch(contentsUrl(env, path, false), {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
async function readUser(env, username) {
  const file = await githubRead(env, userPath(env, username));
  return file;
}
async function writeNewUser(env, username, record) {
  const response = await githubWrite(env, userPath(env, username), record, null, "Criar perfil " + username + " — Projeto Tabuada");
  if (response.status === 201) return true;
  if (response.status === 409 || response.status === 422) return false;
  const detail = await response.text();
  throw new Error("GitHub recusou a criação do perfil (" + response.status + "). " + detail.slice(0, 160));
}
async function updateUser(env, username, transform) {
  const path = userPath(env, username);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await githubRead(env, path);
    if (!current) return null;
    const next = transform(current.record);
    const response = await githubWrite(env, path, next, current.sha, "Atualizar dados do perfil " + username);
    if (response.ok) return next;
    if (response.status !== 409 && response.status !== 422) {
      const detail = await response.text();
      throw new Error("GitHub recusou o salvamento (" + response.status + "). " + detail.slice(0, 160));
    }
  }
  throw new Error("O perfil foi alterado ao mesmo tempo em outro dispositivo. Tente salvar novamente.");
}
async function hmac(env, message) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error("Secret AUTH_SECRET deve ter pelo menos 32 caracteres.");
  const key = await crypto.subtle.importKey("raw", enc.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
async function passwordDigest(env, salt, password) {
  if (typeof password !== "string") throw new Error("Senha inválida.");
  const material = await crypto.subtle.importKey("raw", enc.encode(password + ":" + env.AUTH_SECRET), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromB64url(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    256
  );
  return b64url(new Uint8Array(derived));
}
function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function issueToken(env, username) {
  const payload = b64url(enc.encode(JSON.stringify({ sub: username, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })));
  return payload + "." + b64url(await hmac(env, "session-v1:" + payload));
}
async function tokenUsername(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const expected = await hmac(env, "session-v1:" + parts[0]);
    if (!constantEqual(expected, fromB64url(parts[1]))) return null;
    const payload = JSON.parse(dec.decode(fromB64url(parts[0])));
    if (!payload.sub || !/^[a-z0-9_.-]{3,20}$/.test(payload.sub) || payload.exp < Date.now()) return null;
    return payload.sub;
  } catch (_) {
    return null;
  }
}
async function authenticatedUser(request, env) {
  const username = await tokenUsername(request, env);
  if (!username) return null;
  const file = await readUser(env, username);
  return file ? { username, record: file.record } : null;
}
async function readJson(request, maxBytes) {
  const raw = await request.text();
  if (enc.encode(raw).length > (maxBytes || 350000)) throw new Error("Dados enviados ultrapassam o limite permitido.");
  return JSON.parse(raw);
}
function safePublicData(record) {
  return { history: record.history || { questions: {}, sessions: [] }, checkpoint: record.checkpoint || null };
}
function rankingRow(username, record) {
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
}
async function listUsers(env) {
  const c = config(env);
  const url = contentsUrl(env, c.dir) + "&per_page=1000";
  const response = await fetch(url, { headers: githubHeaders(env) });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("GitHub não conseguiu listar os perfis (" + response.status + ").");
  const entries = await response.json();
  return Array.isArray(entries) ? entries.filter(item => item.type === "dir").map(item => item.name).filter(name => /^[a-z0-9_.-]{3,20}$/.test(name)) : [];
}
async function getRanking(env) {
  const usernames = await listUsers(env);
  const rows = [];
  for (let i = 0; i < usernames.length; i += 8) {
    const batch = usernames.slice(i, i + 8);
    const records = await Promise.all(batch.map(username => readUser(env, username)));
    records.forEach((file, index) => { if (file) rows.push(rankingRow(batch[index], file.record)); });
  }
  return rows.sort((a, b) => b.timeMs - a.timeMs || b.correct - a.correct);
}

export default {
  async fetch(request, env) {
    const cors = getCors(request, env);
    if (!cors) return json({ error: "Origem não autorizada." }, 403, {});
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, service: "projeto-tabuada-github-storage", storage: "one-folder-per-user" }, 200, cors);
      }
      if (path === "/api/ranking" && request.method === "GET") {
        return json({ users: await getRanking(env) }, 200, cors);
      }
      if (path === "/api/register" && request.method === "POST") {
        const body = await readJson(request, 8000);
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return json({ error: "Nome de usuário inválido." }, 400, cors);
        if (password.length < 8 || password.length > 100) return json({ error: "A senha deve ter entre 8 e 100 caracteres." }, 400, cors);
        const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
        const passwordHash = await passwordDigest(env, salt, password);
        const record = {
          version: 1,
          username,
          credentials: { algorithm: "PBKDF2-SHA256", iterations: ITERATIONS, salt, passwordHash },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: { questions: {}, sessions: [] },
          checkpoint: null
        };
        const created = await writeNewUser(env, username, record);
        if (!created) return json({ error: "Este nome de usuário já está cadastrado." }, 409, cors);
        return json({ token: await issueToken(env, username), username }, 201, cors);
      }
      if (path === "/api/login" && request.method === "POST") {
        const body = await readJson(request, 8000);
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return json({ error: "Usuário ou senha incorretos." }, 401, cors);
        const file = await readUser(env, username);
        if (!file || !file.record.credentials) return json({ error: "Usuário ou senha incorretos." }, 401, cors);
        const credentials = file.record.credentials;
        const digest = await passwordDigest(env, credentials.salt, password);
        if (!constantEqual(enc.encode(digest), enc.encode(credentials.passwordHash || ""))) {
          return json({ error: "Usuário ou senha incorretos." }, 401, cors);
        }
        return json({ token: await issueToken(env, username), username }, 200, cors);
      }
      if (path === "/api/me" && request.method === "GET") {
        const user = await authenticatedUser(request, env);
        if (!user) return json({ error: "Sessão inválida. Entre novamente." }, 401, cors);
        return json({ username: user.username, ...safePublicData(user.record) }, 200, cors);
      }
      if (path === "/api/me" && request.method === "PUT") {
        const body = await readJson(request, 350000);
        if (!body.history || typeof body.history !== "object" || !body.history.questions) {
          return json({ error: "Histórico inválido." }, 400, cors);
        }
        const username = await tokenUsername(request, env);
        if (!username) return json({ error: "Sessão inválida. Entre novamente." }, 401, cors);
        const saved = await updateUser(env, username, current => ({
          ...current,
          history: body.history,
          checkpoint: body.checkpoint || null,
          updatedAt: new Date().toISOString()
        }));
        if (!saved) return json({ error: "Usuário não encontrado." }, 404, cors);
        return json({ ok: true, savedAt: new Date().toISOString() }, 200, cors);
      }
      return json({ error: "Rota não encontrada." }, 404, cors);
    } catch (error) {
      return json({ error: error.message || "Erro interno ao acessar os dados." }, 500, cors);
    }
  }
};
