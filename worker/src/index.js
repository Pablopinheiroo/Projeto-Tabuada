const ALLOWED_ORIGINS = new Set([
  "https://pablopinheiroo.github.io"
]);

const GH_OWNER = "Pablopinheiroo";
const GH_REPO = "Projeto-Tabuada-Dados";
const GH_BRANCH = "main";
const GH_DIRECTORY = "usuarios";
const GH_API = "https://api.github.com";
const PASSWORD_ITERATIONS = 180000;
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin"
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

async function githubRequest(path, env, options = {}) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("O segredo GITHUB_TOKEN não foi configurado no Worker.");
  }

  const response = await fetch(GH_API + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
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
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 1024 * 1024) throw new Error("Os dados enviados são grandes demais.");
  return request.json();
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
      return json({
        ok: true,
        service: "Projeto Tabuada API",
        githubSecretConfigured: true,
        githubConnected: true
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
        auth: { username, salt, hash, createdAt: new Date().toISOString() },
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
      const entries = await githubRequest(
        "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" +
        GH_DIRECTORY + "?ref=" + encodeURIComponent(GH_BRANCH),
        env
      );
      if (!Array.isArray(entries)) throw new Error("A pasta de participantes não retornou uma lista.");
      const folders = entries.filter(item =>
        item.type === "dir" && usernameIsValid(item.name)
      ).slice(0, 100);

      const records = await Promise.all(folders.map(async item => {
        try {
          const record = await readUser(item.name, env);
          return record ? publicRecord(record.data) : null;
        } catch {
          return null;
        }
      }));
      return json({ records: records.filter(Boolean) }, 200, origin);
    }

    return json({ error: "Rota não encontrada." }, 404, origin);
  } catch (error) {
    console.error("Projeto Tabuada API:", error);

    if (error.status === 401) {
      return json({ error: "O token do GitHub configurado no servidor foi recusado. Atualize o segredo GITHUB_TOKEN no Cloudflare." }, 502, origin);
    }
    if (error.status === 403) {
      return json({ error: "O token do servidor não tem permissão de leitura e gravação no repositório privado Projeto-Tabuada-Dados." }, 502, origin);
    }
    if (error.status === 404) {
      return json({ error: "O repositório privado de dados ou o caminho de armazenamento não foi encontrado." }, 502, origin);
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
