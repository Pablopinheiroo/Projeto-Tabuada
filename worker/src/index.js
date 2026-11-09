const ALLOWED_ORIGINS = new Set([
  "https://pablopinheiroo.github.io"
]);

const GH_OWNER = "Pablopinheiroo";
const GH_REPO = "Projeto-Tabuada-Dados";
const GH_BRANCH = "main";
const GH_DIRECTORY = "usuarios";
const GH_API = "https://api.github.com";
const PASSWORD_ITERATIONS = 100000;
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const COMMUNITY_MAX_USERS = 35;
const COMMUNITY_CACHE_TTL_MS = 45_000;
let communitySummaryCache = { expiresAt: 0, records: null, pending: null };

function json(data, status = 200, origin = "", extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
      ...extraHeaders
    }
  });
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeGithubContent(value) {
  const compact = String(value || "").replace(/\s/g, "");
  const binary = atob(compact);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function usernameIsValid(value) {
  return typeof value === "string" && /^[a-z0-9_.-]{3,20}$/.test(value);
}

function userPath(username) {
  return GH_DIRECTORY + "/" + encodeURIComponent(username) + "/dados.json";
}

async function rateLimitResponse(binding, key, message, origin) {
  if (!binding) return null;
  const result = await binding.limit({ key });
  if (result?.success !== false) return null;
  return json({ error: message }, 429, origin, { "Retry-After": "60" });
}

async function githubRequest(path, env, options = {}) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("O segredo GITHUB_TOKEN não foi configurado no Worker.");
  }

  const response = await fetch(GH_API + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Projeto-Tabuada-API/1.0",
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { message: raw || "Resposta inválida do GitHub." }; }

  if (!response.ok) {
    const error = new Error(data.message || "O GitHub respondeu com HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function readUser(username, env) {
  try {
    const file = await githubRequest(
      "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" +
      userPath(username) + "?ref=" + encodeURIComponent(GH_BRANCH),
      env
    );
    const data = JSON.parse(decodeGithubContent(file.content));
    if (!data || data.username !== username || !data.auth?.salt || !data.auth?.hash) {
      throw new Error("O arquivo desta conta está incompleto.");
    }
    return { data, sha: file.sha };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function writeUser(username, data, sha, env) {
  const body = {
    message: "Atualizar dados do participante " + username,
    branch: GH_BRANCH,
    content: encodeUtf8Base64(JSON.stringify(data, null, 2))
  };
  if (sha) body.sha = sha;

  const result = await githubRequest(
    "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + userPath(username),
    env,
    { method: "PUT", body: JSON.stringify(body) }
  );
  return result.content.sha;
}

function publicRecord(record) {
  return {
    username: record.username,
    profile: record.profile && typeof record.profile === "object" ? record.profile : {},
    history: record.history && typeof record.history === "object"
      ? record.history : { questions: {}, sessions: [] },
    updatedAt: record.updatedAt || null
  };
}

function communitySummary(record) {
  const profile = record.profile && typeof record.profile === "object" ? record.profile : {};
  const history = safeHistory(record.history);
  const questions = Object.values(history.questions).filter(item => item && typeof item === "object");
  const correct = questions.reduce((sum, item) => sum + (Number(item.correct) || 0), 0);
  const wrong = questions.reduce((sum, item) => sum + (Number(item.wrong) || 0), 0);
  const sessions = Array.isArray(history.sessions) ? history.sessions : [];
  let timeMs = sessions.reduce((sum, item) => sum + (Number(item?.timeMs) || 0), 0);
  const checkpoint = profile.checkpoint;
  if (checkpoint && typeof checkpoint === "object") {
    timeMs += (Number(checkpoint.sessionQuestionTimeMs) || 0) +
      (Number(checkpoint.currentElapsedMs) || 0);
  }
  const hard = questions
    .filter(item => (Number(item.wrong) || 0) > 0)
    .sort((a, b) => (Number(b.wrong) || 0) - (Number(a.wrong) || 0) ||
      ((Number(b.wrong) || 0) / Math.max(1, Number(b.attempts) || 1)) -
      ((Number(a.wrong) || 0) / Math.max(1, Number(a.attempts) || 1)))
    .slice(0, 3)
    .map(item => ({ a: Number(item.a) || 0, b: Number(item.b) || 0, wrong: Number(item.wrong) || 0 }));

  return {
    username: record.username,
    displayName: profile.displayName || record.username,
    avatar: profile.avatar || "imagem:0",
    correct,
    wrong,
    attempts: correct + wrong,
    timeMs,
    hard
  };
}

async function loadCommunitySummaries(env) {
  if (communitySummaryCache.records && Date.now() < communitySummaryCache.expiresAt) {
    return communitySummaryCache.records;
  }
  if (communitySummaryCache.pending) return communitySummaryCache.pending;

  const pending = (async () => {
    const entries = await githubRequest(
      "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" +
      GH_DIRECTORY + "?ref=" + encodeURIComponent(GH_BRANCH),
      env
    );
    if (!Array.isArray(entries)) throw new Error("A pasta de participantes não retornou uma lista.");

    // 1 chamada para listar + no máximo 35 leituras individuais = 36 subrequests.
    const folders = entries.filter(item => item.type === "dir" && usernameIsValid(item.name))
      .slice(0, COMMUNITY_MAX_USERS);
    const summaries = [];

    // Limita concorrência e mantém cada execução abaixo das 6 conexões externas simultâneas.
    for (let index = 0; index < folders.length; index += 6) {
      const batch = folders.slice(index, index + 6);
      const results = await Promise.all(batch.map(async item => {
        try {
          const record = await readUser(item.name, env);
          return record ? communitySummary(record.data) : null;
        } catch {
          return null;
        }
      }));
      summaries.push(...results.filter(Boolean));
    }
    return summaries;
  })();

  communitySummaryCache.pending = pending;
  try {
    const records = await pending;
    communitySummaryCache.records = records;
    communitySummaryCache.expiresAt = Date.now() + COMMUNITY_CACHE_TTL_MS;
    return records;
  } finally {
    if (communitySummaryCache.pending === pending) communitySummaryCache.pending = null;
  }
}

function randomHex(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  const salt = Uint8Array.from(
    saltHex.match(/.{2}/g).map(pair => parseInt(pair, 16))
  );
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sessionKey(env) {
  if (!env.GITHUB_TOKEN) throw new Error("O segredo GITHUB_TOKEN não foi configurado no Worker.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GITHUB_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSession(username, env) {
  const payload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(env),
    new TextEncoder().encode(encoded)
  );
  return encoded + "." + b64url(new Uint8Array(signature));
}

async function verifySession(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match) return null;

  const parts = match[1].split(".");
  if (parts.length !== 2) return null;

  try {
    const key = await sessionKey(env);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (!usernameIsValid(payload.sub) || !Number.isFinite(payload.exp) ||
        payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

async function readJson(request) {
  const maxBytes = 1024 * 1024;
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error("Os dados enviados ultrapassam o limite de 1 MB.");
    error.status = 413;
    throw error;
  }
  if (!request.body) {
    const error = new Error("O corpo da solicitação está vazio.");
    error.status = 400;
    throw error;
  }
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try { await reader.cancel(); } catch {}
      const error = new Error("Os dados enviados ultrapassam o limite de 1 MB.");
      error.status = 413;
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    const error = new Error("O conteúdo enviado não contém um JSON válido.");
    error.status = 400;
    throw error;
  }
}

function safeHistory(value) {
  if (!value || typeof value !== "object") return { questions: {}, sessions: [] };
  return {
    questions: value.questions && typeof value.questions === "object" ? value.questions : {},
    sessions: Array.isArray(value.sessions) ? value.sessions : []
  };
}

async function handleApi(request, env, origin) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, "") || "/";

  try {
    const isAuthRequest = (route === "/api/auth/register" || route === "/api/auth/login") &&
      request.method === "POST";
    if (isAuthRequest) {
      const ip = request.headers.get("CF-Connecting-IP") || "ip-desconhecido";
      const limited = await rateLimitResponse(
        env.AUTH_IP_LIMITER,
        route + ":" + ip,
        "Muitas tentativas deste acesso. Aguarde um minuto e tente novamente.",
        origin
      );
      if (limited) return limited;
    }

    if (route === "/health" && request.method === "GET") {
      if (!env.GITHUB_TOKEN) {
        return json({
          ok: false,
          service: "Projeto Tabuada API",
          githubSecretConfigured: false,
          githubConnected: false
        }, 503, origin);
      }
      await githubRequest("/repos/" + GH_OWNER + "/" + GH_REPO, env);
      const usersDirectory = await githubRequest(
        "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" +
        GH_DIRECTORY + "?ref=" + encodeURIComponent(GH_BRANCH),
        env
      );
      if (!Array.isArray(usersDirectory)) {
        throw new Error("O diretório usuarios do repositório privado não retornou uma lista.");
      }
      return json({
        ok: true,
        service: "Projeto Tabuada API",
        githubSecretConfigured: true,
        githubConnected: true,
        githubContentReadAccess: true
      }, 200, origin);
    }

    if (route === "/api/auth/register" && request.method === "POST") {
      const body = await readJson(request);
      const username = String(body.username || "").trim().toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";

      if (!usernameIsValid(username)) {
        return json({ error: "Use um nome de 3 a 20 caracteres: letras sem acento, números, ponto, traço ou sublinhado." }, 400, origin);
      }
      if (!password) return json({ error: "Digite uma senha." }, 400, origin);

      const exists = await readUser(username, env);
      if (exists) return json({ error: "Este nome de usuário já está cadastrado." }, 409, origin);

      const salt = randomHex(16);
      const hash = await passwordHash(password, salt);
      const data = {
        version: 1,
        username,
        auth: { username, salt, hash, iterations: PASSWORD_ITERATIONS, createdAt: new Date().toISOString() },
        profile: {
          displayName: username,
          avatar: body.profile?.avatar ?? "imagem:0"
        },
        history: { questions: {}, sessions: [] },
        updatedAt: new Date().toISOString()
      };

      const sha = await writeUser(username, data, null, env);
      const sessionToken = await createSession(username, env);
      return json({ sessionToken, data: publicRecord(data), sha }, 201, origin);
    }

    if (route === "/api/auth/login" && request.method === "POST") {
      const body = await readJson(request);
      const username = String(body.username || "").trim().toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if (!usernameIsValid(username) || !password) {
        return json({ error: "Nome de usuário ou senha incorretos." }, 401, origin);
      }
      const loginLimited = await rateLimitResponse(
        env.LOGIN_USER_LIMITER,
        username,
        "Muitas tentativas de entrada nesta conta. Aguarde um minuto antes de tentar novamente.",
        origin
      );
      if (loginLimited) return loginLimited;

      const record = await readUser(username, env);
      if (!record) return json({ error: "Nome de usuário ou senha incorretos." }, 401, origin);

      const iterations = Number(record.data.auth.iterations) || PASSWORD_ITERATIONS;
      const hash = await passwordHash(password, record.data.auth.salt, iterations);
      if (!constantTimeEqual(hash, record.data.auth.hash)) {
        return json({ error: "Nome de usuário ou senha incorretos." }, 401, origin);
      }

      return json({
        sessionToken: await createSession(username, env),
        data: publicRecord(record.data),
        sha: record.sha
      }, 200, origin);
    }

    const username = await verifySession(request, env);
    if (!username) return json({ error: "Sua sessão expirou. Entre novamente na sua conta." }, 401, origin);

    if (route === "/api/me" && request.method === "GET") {
      const limited = await rateLimitResponse(env.PROFILE_READ_LIMITER, username + ":profile-read",
        "Muitas consultas ao perfil. Aguarde um minuto e tente novamente.", origin);
      if (limited) return limited;
    }
    if (route === "/api/community" && request.method === "GET") {
      const limited = await rateLimitResponse(env.COMMUNITY_LIMITER, username,
        "O ranking foi consultado muitas vezes. Aguarde um minuto e tente novamente.", origin);
      if (limited) return limited;
    }
    if ((route === "/api/me/password" && request.method === "POST") ||
        (route === "/api/me" && request.method === "PUT")) {
      const limited = await rateLimitResponse(env.PROFILE_WRITE_LIMITER, username + ":profile-write",
        "Muitos salvamentos em pouco tempo. Seus dados permanecem no dispositivo; aguarde um minuto para sincronizar novamente.", origin);
      if (limited) return limited;
    }

    if (route === "/api/me/password" && request.method === "POST") {
      const body = await readJson(request);
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) return json({ error: "Digite uma senha." }, 400, origin);

      const record = await readUser(username, env);
      if (!record) return json({ error: "A conta não foi encontrada no repositório privado." }, 404, origin);

      const salt = randomHex(16);
      const hash = await passwordHash(password, salt);
      const updated = {
        ...record.data,
        auth: {
          ...record.data.auth,
          username,
          salt,
          hash,
          iterations: PASSWORD_ITERATIONS,
          passwordChangedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      const sha = await writeUser(username, updated, record.sha, env);
      return json({ ok: true, sha }, 200, origin);
    }

    if (route === "/api/me" && request.method === "GET") {
      const record = await readUser(username, env);
      if (!record) return json({ error: "A conta não foi encontrada no repositório privado." }, 404, origin);
      return json({ data: publicRecord(record.data), sha: record.sha }, 200, origin);
    }

    if (route === "/api/me" && request.method === "PUT") {
      const body = await readJson(request);
      const record = await readUser(username, env);
      if (!record) return json({ error: "A conta não foi encontrada no repositório privado." }, 404, origin);

      const updated = {
        ...record.data,
        profile: body.profile && typeof body.profile === "object"
          ? body.profile : record.data.profile,
        history: body.history && typeof body.history === "object"
          ? safeHistory(body.history) : record.data.history,
        updatedAt: new Date().toISOString()
      };
      const sha = await writeUser(username, updated, record.sha, env);
      return json({ ok: true, sha }, 200, origin);
    }

    if (route === "/api/community" && request.method === "GET") {
      const records = await loadCommunitySummaries(env);
      return json({ records }, 200, origin);
    }

    return json({ error: "Rota não encontrada." }, 404, origin);
  } catch (error) {
    console.error("Projeto Tabuada API:", error);

    if (error.status === 400 || error.status === 413) {
      return json({ error: error.message }, error.status, origin);
    }
    if (error.status === 401) {
      return json({ error: "O token do GitHub configurado no servidor foi recusado. Atualize o segredo GITHUB_TOKEN no Cloudflare." }, 502, origin);
    }
    if (error.status === 403) {
      return json({ error: "O token do servidor não tem permissão de leitura e gravação no repositório privado Projeto-Tabuada-Dados." }, 502, origin);
    }
    if (error.status === 404) {
      return json({ error: "O repositório privado ou o diretório usuarios não foi encontrado. Confira também se o token tem permissão Contents: Read and write." }, 502, origin);
    }
    if (error.status === 409 || error.status === 422) {
      return json({ error: "O GitHub recusou a gravação. Atualize a página e tente novamente." }, 409, origin);
    }
    return json({ error: error.message || "Falha interna no servidor do jogo." }, 500, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origem não autorizada." }, 403);
    }

    const response = await handleApi(request, env, origin);
    return withCors(response, origin);
  }
};
