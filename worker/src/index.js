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
const AVATAR_IMAGE_COUNT = 12;
const AVATAR_GIF_COUNT = 12;
const ADVENTURE_STAGE_COUNT = 26;
const COMMUNITY_MAX_USERS = 40;
const CHALLENGE_PLAYER_METADATA_MAX = 45;
const WORKER_BUILD_ID = "2026-11-09-public-profiles-no-draws-bet-challenges";
const COMMUNITY_CACHE_TTL_MS = 45_000;
const CHALLENGE_INDEX_DIRECTORY = "desafios/participantes";
const CHALLENGE_DIRECTORY = "desafios/partidas";
const CHALLENGE_MAX_HISTORY = 30;
const TOURNAMENT_PRESETS = {
  easy: { name: "Fácil", tables: Array.from({ length: 10 }, (_, i) => i + 1), options: 4 },
  medium: { name: "Médio", tables: Array.from({ length: 15 }, (_, i) => i + 1), options: 4 },
  hard: { name: "Difícil", tables: [3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19], options: 6 }
};
const TOURNAMENT_SECONDS_PER_QUESTION = Object.freeze({ easy: 10, medium: 7, hard: 5 });
const TOURNAMENT_MIN_VALID_SCORE = 30;
const CHALLENGE_PRESETS = {
  recruta: { name: "Recruta", tables: [1, 2], options: 4 },
  aprendiz: { name: "Aprendiz", tables: [1, 2, 3, 4], options: 4 },
  praticante: { name: "Praticante", tables: [1, 2, 3, 4, 5, 6], options: 4 },
  competidor: { name: "Competidor", tables: [1, 2, 3, 4, 5, 6, 7, 8], options: 4 },
  veterano: { name: "Veterano", tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], options: 4 },
  especialista: { name: "Especialista", tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], options: 4 },
  elite: { name: "Elite", tables: Array.from({ length: 14 }, (_, i) => i + 1), options: 4 },
  mestre: { name: "Mestre", tables: Array.from({ length: 16 }, (_, i) => i + 1), options: 6 },
  grao_mestre: { name: "Grão-Mestre", tables: Array.from({ length: 18 }, (_, i) => i + 1), options: 6 },
  lenda: { name: "Lenda", tables: Array.from({ length: 20 }, (_, i) => i + 1), options: 6 },
  extremo: { name: "Extremo", tables: [3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19], options: 6 }
};
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

function defaultGameEconomy(currentAvatar = "imagem:0") {
  const legacyAvatar = /^(imagem|gif):(0|[1-9]|1[01])$/.test(String(currentAvatar || ""))
    ? String(currentAvatar) : "imagem:0";
  return {
    version: 1, coins: 0, totalEarned: 0, trainingCycles: 0,
    completedStages: [], perfectStages: [], comboStages: [],
    trainingClaimIds: [], ownedAvatars: [...new Set(["imagem:0", legacyAvatar])],
    achievements: {}
  };
}
function validAvatarKey(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(imagem|gif):(\d+)$/);
  if (!match) return false;
  const index = Number(match[2]);
  return Number.isInteger(index) && index >= 0 &&
    index < (match[1] === "imagem" ? AVATAR_IMAGE_COUNT : AVATAR_GIF_COUNT);
}
function normalizeGameEconomy(record) {
  const profile = record?.profile && typeof record.profile === "object" ? record.profile : {};
  const raw = record?.economy && typeof record.economy === "object" ? record.economy : null;
  const base = defaultGameEconomy(profile.avatar);
  const owned = raw && Array.isArray(raw.ownedAvatars) ? raw.ownedAvatars.filter(validAvatarKey) : base.ownedAvatars;
  const uniqueOwned = [...new Set(["imagem:0", ...owned])];
  const safeInt = (value, max = 1_000_000_000) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
  const achievements = raw?.achievements && typeof raw.achievements === "object" && !Array.isArray(raw.achievements)
    ? Object.fromEntries(Object.entries(raw.achievements).filter(([key, value]) => /^[a-z0-9_]+$/.test(key) && typeof value === "string")) : {};
  return {
    version: 1,
    coins: safeInt(raw?.coins),
    totalEarned: safeInt(raw?.totalEarned),
    trainingCycles: safeInt(raw?.trainingCycles),
    completedStages: [...new Set((Array.isArray(raw?.completedStages) ? raw.completedStages : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= ADVENTURE_STAGE_COUNT))],
    perfectStages: [...new Set((Array.isArray(raw?.perfectStages) ? raw.perfectStages : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= ADVENTURE_STAGE_COUNT))],
    comboStages: [...new Set((Array.isArray(raw?.comboStages) ? raw.comboStages : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= ADVENTURE_STAGE_COUNT))],
    trainingClaimIds: [...new Set((Array.isArray(raw?.trainingClaimIds) ? raw.trainingClaimIds : []).filter(id => typeof id === "string" && id.length <= 100))].slice(-500),
    ownedAvatars: uniqueOwned, achievements
  };
}
function evaluateGameAchievements(economy) {
  const completed = economy.completedStages.length, perfect = economy.perfectStages.length;
  const tests = [
    ["training_first", economy.trainingCycles >= 1],
    ["training_5", economy.trainingCycles >= 5],
    ["training_25", economy.trainingCycles >= 25],
    ["adventure_first", completed >= 1],
    ["adventure_5", completed >= 5],
    ["adventure_13", completed >= 13],
    ["adventure_26", completed >= ADVENTURE_STAGE_COUNT],
    ["perfect_first", perfect >= 1],
    ["perfect_5", perfect >= 5],
    ["combo_5", economy.comboStages.length >= 1],
    ["coins_100", economy.totalEarned >= 100],
    ["coins_500", economy.totalEarned >= 500],
    ["collector_5", economy.ownedAvatars.length >= 5]
  ];
  const newlyUnlocked = [];
  for (const [id, earned] of tests) {
    if (earned && !economy.achievements[id]) {
      economy.achievements[id] = new Date().toISOString();
      newlyUnlocked.push(id);
    }
  }
  return newlyUnlocked;
}

function publicRecord(record) {
  return {
    username: record.username,
    profile: record.profile && typeof record.profile === "object" ? record.profile : {},
    history: record.history && typeof record.history === "object"
      ? record.history : { questions: {}, sessions: [] },
    economy: normalizeGameEconomy(record),
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

function challengeFilePath(id) {
  return CHALLENGE_DIRECTORY + "/" + id + ".json";
}
function challengeIndexPath(username) {
  return CHALLENGE_INDEX_DIRECTORY + "/" + encodeURIComponent(username) + ".json";
}
async function readJsonFile(path, env) {
  try {
    const file = await githubRequest(
      "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + path +
      "?ref=" + encodeURIComponent(GH_BRANCH),
      env
    );
    return { data: JSON.parse(decodeGithubContent(file.content)), sha: file.sha };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
async function writeJsonFile(path, data, sha, env, message) {
  const body = {
    message: message || "Atualizar dados de desafio",
    branch: GH_BRANCH,
    content: encodeUtf8Base64(JSON.stringify(data, null, 2))
  };
  if (sha) body.sha = sha;
  const result = await githubRequest(
    "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + path,
    env,
    { method: "PUT", body: JSON.stringify(body) }
  );
  return result.content.sha;
}
async function readChallengeIndex(username, env) {
  const file = await readJsonFile(challengeIndexPath(username), env);
  const ids = Array.isArray(file?.data?.ids)
    ? file.data.ids.filter(id => typeof id === "string" && /^[a-f0-9]{32}$/.test(id))
    : [];
  return { ids, sha: file?.sha || null };
}
async function appendChallengeIndex(username, challengeId, env) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const index = await readChallengeIndex(username, env);
    if (!index.ids.includes(challengeId)) index.ids.push(challengeId);
    index.ids = index.ids.slice(-200);
    try {
      return await writeJsonFile(
        challengeIndexPath(username),
        { username, ids: index.ids, updatedAt: new Date().toISOString() },
        index.sha,
        env,
        "Atualizar lista de desafios de " + username
      );
    } catch (error) {
      if ((error.status !== 409 && error.status !== 422) || attempt === 3) throw error;
    }
  }
  throw new Error("Não foi possível atualizar a lista de desafios.");
}
function challengeRandom(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildChallengeQuestions(seed, tables, optionCount) {
  const random = challengeRandom(seed);
  const pool = [];
  for (const table of tables) {
    for (let factor = 1; factor <= 10; factor++) pool.push({ a: table, b: factor });
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 10).map(fact => {
    const answer = fact.a * fact.b;
    const values = new Set([answer]);
    while (values.size < optionCount) {
      const spread = Math.max(7, Math.ceil(answer * 0.28));
      const offset = 1 + Math.floor(random() * spread);
      const candidate = random() < 0.5 ? answer + offset : Math.max(0, answer - offset);
      values.add(candidate);
    }
    const options = [...values];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { ...fact, answer, options };
  });
}
function safeChallengeSummary(challenge, username) {
  const participants = Array.isArray(challenge.participants) && challenge.participants.length
    ? challenge.participants : [challenge.challenger, challenge.recipient].filter(Boolean);
  const compactResults = Object.fromEntries(Object.entries(challenge.results || {}).map(([name, result]) => [name, {
    score: Number(result.score) || 0,
    correct: Number(result.correct) || 0,
    wrong: Number(result.wrong) || 0,
    totalMs: Number(result.totalMs) || 0,
    submittedAt: result.submittedAt || null
  }]));
  const myResult = compactResults[username] || null;
  const other = participants.find(item => item !== username) || null;
  return {
    id: challenge.id,
    challenger: challenge.challenger,
    recipient: challenge.recipient || participants[1] || null,
    participants,
    mode: challenge.mode,
    levelId: challenge.levelId,
    levelName: challenge.levelName,
    tables: challenge.tables,
    optionCount: challenge.optionCount,
    musicTrack: challenge.musicTrack,
    seed: challenge.seed,
    createdAt: challenge.createdAt,
    results: compactResults,
    standings: Array.isArray(challenge.standings) ? challenge.standings : [],
    winners: (() => { const ranked = Array.isArray(challenge.standings) ? challenge.standings : participants.map(name => ({ username: name, score: Number(challenge.results?.[name]?.score) || 0, totalMs: Number(challenge.results?.[name]?.totalMs) || 0 })).sort((a,b) => b.score-a.score || a.totalMs-b.totalMs || a.username.localeCompare(b.username)); const winner = challenge.winner === "empate" ? ranked[0]?.username : challenge.winner; return winner ? [winner] : []; })(),
    status: challenge.status || "open",
    winner: challenge.winner === "empate" ? (Array.isArray(challenge.standings) ? challenge.standings[0]?.username : participants.map(name => ({ username: name, score: Number(challenge.results?.[name]?.score) || 0, totalMs: Number(challenge.results?.[name]?.totalMs) || 0 })).sort((a,b) => b.score-a.score || a.totalMs-b.totalMs || a.username.localeCompare(b.username))[0]?.username) : (challenge.winner ?? null),
    betMode: challenge.betMode === true, stake: challenge.betMode === true ? Number(challenge.stake) || 0 : 0,
    betPaid: challenge.betPaid === true, acceptedAt: challenge.acceptedAt || null, rejectedAt: challenge.rejectedAt || null,
    completedAt: challenge.completedAt || null,
    myResult,
    otherResult: other ? (challenge.results?.[other] || null) : null
  };
}
async function createChallenge(body, username, env) {
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients :
    (body.recipient ? [body.recipient] : []);
  const recipients = [...new Set(rawRecipients.map(value => String(value || "").trim().toLowerCase()))];
  if (!recipients.length || recipients.length > 4 || recipients.includes(username) ||
      recipients.some(name => !usernameIsValid(name))) {
    const error = new Error("Escolha de 1 a 4 participantes cadastrados, sem incluir sua própria conta.");
    error.status = 400;
    throw error;
  }
  const betMode = body.betMode === true;
  if (betMode && recipients.length !== 1) { const error = new Error("Desafios com aposta são individuais. Escolha apenas um adversário."); error.status = 400; throw error; }
  const participantRecords = await Promise.all(recipients.map(name => readUser(name, env)));
  if (participantRecords.some(record => !record)) {
    const error = new Error("Um ou mais participantes não foram encontrados. Atualize a lista e escolha contas cadastradas.");
    error.status = 404;
    throw error;
  }
  const mode = body.mode === "custom" ? "custom" : "preset";
  let levelId = "personalizado", levelName = "Personalizado", tables = [], optionCount = 4;
  if (mode === "custom") {
    const rawTables = Array.isArray(body.tables) ? body.tables : [];
    tables = [...new Set(rawTables.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 20))].sort((a, b) => a - b);
    if (!tables.length || tables.length !== rawTables.length || tables.length > 20) {
      const error = new Error("Escolha de 1 a 20 tabuadas válidas para o desafio personalizado.");
      error.status = 400;
      throw error;
    }
  } else {
    levelId = String(body.levelId || "");
    const preset = CHALLENGE_PRESETS[levelId];
    if (!preset) {
      const error = new Error("Nível de desafio inválido.");
      error.status = 400;
      throw error;
    }
    levelName = preset.name; tables = preset.tables; optionCount = preset.options;
  }
  let stake = 0;
  if (betMode) {
    stake = body.stake;
    if (!Number.isSafeInteger(stake) || stake < 1) { const error = new Error("Informe uma aposta em moedas inteiras, sem vírgulas, de pelo menos 1 moeda."); error.status = 400; throw error; }
    const challengerRecord = await readUser(username, env);
    if (!challengerRecord) { const error = new Error("Sua conta não foi encontrada."); error.status = 404; throw error; }
    const challengerCoins = normalizeGameEconomy(challengerRecord.data).coins;
    if (challengerCoins < 1) { const error = new Error("Você precisa ter pelo menos 1 moeda para criar um desafio com aposta."); error.status = 400; throw error; }
    const recipientCoins = normalizeGameEconomy(participantRecords[0].data).coins;
    const maxStake = Math.min(challengerCoins, recipientCoins);
    if (stake > maxStake) { const error = new Error("A aposta máxima permitida é de " + maxStake + " moedas, considerando o saldo dos dois participantes."); error.status = 400; throw error; }
  }
  const musicTrack = Number(body.musicTrack);
  if (!Number.isInteger(musicTrack) || musicTrack < 0 || musicTrack > 9) {
    const error = new Error("Escolha uma das 10 trilhas sonoras.");
    error.status = 400;
    throw error;
  }
  const id = randomHex(16);
  const seedBytes = crypto.getRandomValues(new Uint32Array(1));
  const seed = seedBytes[0] || 1;
  const participants = [username, ...recipients];
  const challenge = {
    id, challenger: username, recipient: recipients[0], participants,
    mode, levelId, levelName, tables, optionCount, musicTrack, seed, betMode, stake,
    createdAt: new Date().toISOString(), results: {}, status: betMode ? "pending_acceptance" : "open",
    winner: null, completedAt: null
  };
  const sha = await writeJsonFile(
    challengeFilePath(id), challenge, null, env,
    "Criar desafio coletivo de " + username + " para " + recipients.join(", ")
  );
  await Promise.all(participants.map(participant => appendChallengeIndex(participant, id, env)));
  return { ...challenge, fileSha: sha };
}
async function ensureCompletedChallengeBetPaid(challenge, env) {
  if (!challenge || challenge.betMode !== true || challenge.status !== "completed" ||
      challenge.betPaid === true || !challenge.winner ||
      !Number.isSafeInteger(challenge.stake) || challenge.stake < 1) return challenge;
  try {
    await applyChallengeBetTransaction(challenge.winner, challenge.id, "payout", challenge.stake * 2, env);
    const latest = await readJsonFile(challengeFilePath(challenge.id), env);
    if (latest?.data && latest.data.betPaid !== true) {
      latest.data.betPaid = true;
      await writeJsonFile(challengeFilePath(challenge.id), latest.data, latest.sha, env, "Confirmar pagamento da aposta " + challenge.id);
      return latest.data;
    }
    return latest?.data || challenge;
  } catch (error) {
    console.error("Pagamento de aposta pendente no desafio " + challenge.id + ":", error);
    return challenge;
  }
}
async function listChallengesFor(username, env) {
  const [index, userFile] = await Promise.all([readChallengeIndex(username, env), readUser(username, env)]);
  const ids = index.ids.slice(-CHALLENGE_MAX_HISTORY).reverse();
  const items = [];
  for (let offset = 0; offset < ids.length; offset += 5) {
    const batch = ids.slice(offset, offset + 5);
    const loaded = await Promise.all(batch.map(async id => {
      const file = await readJsonFile(challengeFilePath(id), env);
      const participants = Array.isArray(file?.data?.participants) && file.data.participants.length
        ? file.data.participants : [file?.data?.challenger, file?.data?.recipient].filter(Boolean);
      if (!file || !file.data || !participants.includes(username)) return null;
      const data = await ensureCompletedChallengeBetPaid(file.data, env);
      return safeChallengeSummary(data, username);
    }));
    items.push(...loaded.filter(Boolean));
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const pendingCount = items.filter(item => item.participants?.includes(username) && !item.myResult).length;
  const challengeStats = userFile?.data?.profile?.challengeStats || null;
  const economy = userFile ? normalizeGameEconomy(userFile.data) : null;
  return { items, pendingCount, challengeStats, economy };
}

function finalizeChallengeRecord(challenge) {
  const participants = Array.isArray(challenge.participants) && challenge.participants.length
    ? challenge.participants : [challenge.challenger, challenge.recipient].filter(Boolean);
  const submitted = participants.filter(participant => !!challenge.results?.[participant]);
  if (submitted.length < participants.length) {
    challenge.status = submitted.length ? "waiting_participants" : "open";
    return false;
  }
  const ranked = participants.map(participant => ({ username: participant, score: Number(challenge.results[participant].score) || 0, totalMs: Number(challenge.results[participant].totalMs) || 0, submittedAt: challenge.results[participant].submittedAt || "" }))
    .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || String(a.submittedAt).localeCompare(String(b.submittedAt)) || a.username.localeCompare(b.username));
  const best = ranked[0];
  challenge.winners = best ? [best.username] : [];
  challenge.winner = best?.username || null;
  challenge.standings = ranked;
  challenge.status = "completed";
  challenge.completedAt = challenge.completedAt || new Date().toISOString();
  return true;
}

async function applyChallengeStats(username, challenge, env) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const file = await readUser(username, env);
    if (!file) return;
    const data = file.data;
    data.profile = data.profile && typeof data.profile === "object" ? data.profile : {};
    const stats = data.profile.challengeStats && typeof data.profile.challengeStats === "object"
      ? data.profile.challengeStats : {
        total: { wins: 0, losses: 0, draws: 0 },
        custom: { wins: 0, losses: 0, draws: 0 }, levels: {}, processedIds: [], recent: []
      };
    stats.total = stats.total || { wins: 0, losses: 0, draws: 0 };
    stats.custom = stats.custom || { wins: 0, losses: 0, draws: 0 };
    stats.levels = stats.levels && typeof stats.levels === "object" ? stats.levels : {};
    stats.processedIds = Array.isArray(stats.processedIds) ? stats.processedIds : [];
    stats.recent = Array.isArray(stats.recent) ? stats.recent : [];
    if (stats.processedIds.includes(challenge.id)) return;

    const participants = Array.isArray(challenge.participants) && challenge.participants.length
      ? challenge.participants : [challenge.challenger, challenge.recipient].filter(Boolean);
    const own = challenge.results?.[username];
    if (!own || !participants.includes(username)) return;
    const outcome = challenge.winner === username ? "win" : "loss";
    const bucket = outcome === "win" ? "wins" : "losses";
    stats.total[bucket] = (Number(stats.total[bucket]) || 0) + 1;
    if (challenge.mode === "custom") {
      stats.custom[bucket] = (Number(stats.custom[bucket]) || 0) + 1;
    } else {
      const level = stats.levels[challenge.levelId] || { wins: 0, losses: 0, draws: 0 };
      level[bucket] = (Number(level[bucket]) || 0) + 1;
      level.name = challenge.levelName;
      level.medalEarned = (Number(level.wins) || 0) >= 10;
      stats.levels[challenge.levelId] = level;
    }
    stats.processedIds.push(challenge.id);
    stats.processedIds = stats.processedIds.slice(-500);
    stats.recent.unshift({
      id: challenge.id,
      opponents: participants.filter(name => name !== username),
      mode: challenge.mode, levelId: challenge.levelId, levelName: challenge.levelName,
      outcome, score: own.score, winner: challenge.winner, completedAt: challenge.completedAt
    });
    stats.recent = stats.recent.slice(0, 30);
    data.profile.challengeStats = stats;
    data.economy = normalizeGameEconomy(data);
    if (participants.length === 5 && challenge.winner === username && !data.economy.achievements.challenge_four) {
      data.economy.achievements.challenge_four = new Date().toISOString();
    }
    data.updatedAt = new Date().toISOString();
    try {
      await writeUser(username, data, file.sha, env);
      return;
    } catch (error) {
      if ((error.status !== 409 && error.status !== 422) || attempt === 3) throw error;
    }
  }
}


function challengeBetTransactions(profile) {
  return Array.isArray(profile?.challengeBetTransactions) ? profile.challengeBetTransactions.filter(value => typeof value === "string").slice(-1000) : [];
}
async function applyChallengeBetTransaction(username, challengeId, kind, amount, env) {
  if (!["stake", "refund", "payout"].includes(kind) || !Number.isSafeInteger(amount) || amount < 1) {
    const error = new Error("Movimentação de moedas inválida."); error.status = 400; throw error;
  }
  const txId = kind + ":" + challengeId;
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = await readUser(username, env);
    if (!file) { const error = new Error("Conta do participante não encontrada."); error.status = 404; throw error; }
    const data = file.data;
    data.profile = data.profile && typeof data.profile === "object" ? data.profile : {};
    let transactions = challengeBetTransactions(data.profile);
    const stakeTx = "stake:" + challengeId;
    const refundTx = "refund:" + challengeId;
    const payoutTx = "payout:" + challengeId;
    if (kind === "payout" && transactions.includes(payoutTx)) return { applied: false, coins: normalizeGameEconomy(data).coins };
    if (kind === "stake" && transactions.includes(stakeTx)) return { applied: false, coins: normalizeGameEconomy(data).coins };
    if (kind === "refund" && transactions.includes(refundTx)) return { applied: false, coins: normalizeGameEconomy(data).coins };
    const economy = normalizeGameEconomy(data);
    if (kind === "stake") {
      if (economy.coins < amount) { const error = new Error("Um dos participantes não tem mais moedas suficientes para aceitar esta aposta."); error.status = 400; throw error; }
      economy.coins -= amount;
      transactions = transactions.filter(value => value !== refundTx);
    } else if (kind === "refund") {
      if (!transactions.includes(stakeTx)) return { applied: false, coins: economy.coins };
      economy.coins = Math.min(1_000_000_000, economy.coins + amount);
      transactions = transactions.filter(value => value !== stakeTx);
    } else {
      economy.coins = Math.min(1_000_000_000, economy.coins + amount);
      economy.totalEarned = Math.min(1_000_000_000, economy.totalEarned + amount);
    }
    data.profile.challengeBetTransactions = [...transactions, txId].slice(-1000);
    data.economy = economy; data.updatedAt = new Date().toISOString();
    try { await writeUser(username, data, file.sha, env); return { applied: true, coins: economy.coins }; }
    catch (error) { if ((error.status !== 409 && error.status !== 422) || attempt === 4) throw error; }
  }
  throw new Error("Não foi possível atualizar o saldo da aposta.");
}
async function respondToBetChallenge(id, decision, username, env) {
  if (!/^[a-f0-9]{32}$/.test(id)) { const error = new Error("Identificador do desafio inválido."); error.status = 400; throw error; }
  if (decision !== "accept" && decision !== "reject") { const error = new Error("Escolha aceitar ou rejeitar o desafio."); error.status = 400; throw error; }
  let file = await readJsonFile(challengeFilePath(id), env);
  if (!file?.data) { const error = new Error("Desafio não encontrado."); error.status = 404; throw error; }
  let challenge = file.data;
  if (challenge.betMode !== true || username !== challenge.recipient) { const error = new Error("Somente a pessoa convidada pode responder a esta aposta."); error.status = 403; throw error; }
  if (decision === "reject") {
    if (challenge.status !== "pending_acceptance") { const error = new Error("Este convite já foi respondido ou está em confirmação."); error.status = 409; throw error; }
    challenge.status = "rejected"; challenge.rejectedAt = new Date().toISOString();
    await writeJsonFile(challengeFilePath(id), challenge, file.sha, env, "Recusar aposta do desafio " + id);
    return safeChallengeSummary(challenge, username);
  }
  if (!Number.isSafeInteger(challenge.stake) || challenge.stake < 1) { const error = new Error("O valor da aposta não é válido."); error.status = 400; throw error; }
  if (["accepted", "waiting_participants", "completed"].includes(challenge.status)) return safeChallengeSummary(challenge, username);
  if (challenge.status !== "pending_acceptance" && challenge.status !== "accepting") { const error = new Error("Este convite não está mais disponível."); error.status = 409; throw error; }
  const names = [challenge.challenger, challenge.recipient];
  const records = await Promise.all(names.map(name => readUser(name, env)));
  if (records.some(record => !record)) { const error = new Error("Não foi possível localizar os dois perfis."); error.status = 404; throw error; }
  const hasStake = records.map(record => challengeBetTransactions(record.data.profile).includes("stake:" + id));
  const insufficient = records.some((record, index) => !hasStake[index] && normalizeGameEconomy(record.data).coins < challenge.stake);
  if (insufficient) {
    for (let i = 0; i < names.length; i++) if (hasStake[i]) {
      try { await applyChallengeBetTransaction(names[i], id, "refund", challenge.stake, env); }
      catch (error) { console.error("Falha ao devolver aposta durante validação:", error); }
    }
    if (challenge.status === "accepting") {
      const latest = await readJsonFile(challengeFilePath(id), env);
      if (latest?.data?.status === "accepting") { latest.data.status = "pending_acceptance"; await writeJsonFile(challengeFilePath(id), latest.data, latest.sha, env, "Liberar convite de aposta " + id); }
    }
    const error = new Error("A aposta não pode ser aceita porque um dos participantes não tem mais moedas suficientes. Nenhuma moeda foi mantida como cobrança."); error.status = 400; throw error;
  }
  if (challenge.status === "pending_acceptance") {
    challenge.status = "accepting"; challenge.acceptingAt = new Date().toISOString();
    try { await writeJsonFile(challengeFilePath(id), challenge, file.sha, env, "Confirmar aceite da aposta " + id); }
    catch (error) {
      if (error.status !== 409 && error.status !== 422) throw error;
      file = await readJsonFile(challengeFilePath(id), env); challenge = file?.data;
      if (challenge?.status === "accepted") return safeChallengeSummary(challenge, username);
      if (challenge?.status !== "accepting") throw error;
    }
  }
  try {
    await applyChallengeBetTransaction(challenge.challenger, id, "stake", challenge.stake, env);
    await applyChallengeBetTransaction(challenge.recipient, id, "stake", challenge.stake, env);
  } catch (error) {
    const latest = await readJsonFile(challengeFilePath(id), env);
    if (latest?.data?.status === "accepting") {
      const currentRecords = await Promise.all(names.map(name => readUser(name, env)));
      for (let i = 0; i < names.length; i++) if (currentRecords[i] && challengeBetTransactions(currentRecords[i].data.profile).includes("stake:" + id)) {
        try { await applyChallengeBetTransaction(names[i], id, "refund", challenge.stake, env); }
        catch (refundError) { console.error("Falha ao estornar aposta:", refundError); }
      }
      const retry = await readJsonFile(challengeFilePath(id), env);
      if (retry?.data?.status === "accepting") { retry.data.status = "pending_acceptance"; await writeJsonFile(challengeFilePath(id), retry.data, retry.sha, env, "Reabrir convite após falha de aposta " + id); }
    }
    throw error;
  }
  const latest = await readJsonFile(challengeFilePath(id), env);
  if (!latest?.data) { const error = new Error("Não foi possível concluir a aceitação."); error.status = 409; throw error; }
  if (latest.data.status === "accepted") return safeChallengeSummary(latest.data, username);
  if (latest.data.status !== "accepting") { const error = new Error("O convite mudou de estado durante a aceitação."); error.status = 409; throw error; }
  latest.data.status = "accepted"; latest.data.acceptedAt = new Date().toISOString();
  await writeJsonFile(challengeFilePath(id), latest.data, latest.sha, env, "Aceitar aposta do desafio " + id);
  return safeChallengeSummary(latest.data, username);
}

async function submitChallengeResult(id, body, username, env) {
  if (!/^[a-f0-9]{32}$/.test(id)) {
    const error = new Error("Identificador do desafio inválido.");
    error.status = 400;
    throw error;
  }
  const file = await readJsonFile(challengeFilePath(id), env);
  if (!file) {
    const error = new Error("Este desafio não foi encontrado.");
    error.status = 404;
    throw error;
  }
  const challenge = file.data;
  const participants = Array.isArray(challenge.participants) && challenge.participants.length
    ? challenge.participants : [challenge.challenger, challenge.recipient].filter(Boolean);
  if (!participants.includes(username)) {
    const error = new Error("Este desafio não pertence à sua conta.");
    error.status = 403;
    throw error;
  }
  if (challenge.results?.[username]) {
    const error = new Error("Seu resultado neste desafio já foi registrado.");
    error.status = 409;
    throw error;
  }
  if (challenge.betMode === true && !["accepted", "waiting_participants", "completed"].includes(challenge.status)) { const error = new Error("Este desafio com aposta ainda aguarda a aceitação do adversário."); error.status = 409; throw error; }
  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (answers.length !== 10) {
    const error = new Error("O desafio precisa ter exatamente 10 respostas registradas.");
    error.status = 400;
    throw error;
  }

  const questions = buildChallengeQuestions(challenge.seed, challenge.tables, challenge.optionCount);
  let score = 0;
  let totalMs = 0;
  const answerLog = [];
  for (let i = 0; i < questions.length; i++) {
    const item = answers[i] || {};
    const elapsed = Number(item.elapsedMs);
    const value = item.value === null || item.value === undefined ? null : Number(item.value);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60_000 ||
        (value !== null && !Number.isSafeInteger(value))) {
      const error = new Error("Uma das respostas do desafio está inválida.");
      error.status = 400;
      throw error;
    }
    const inTime = elapsed <= 5_000;
    const correct = inTime && value === questions[i].answer;
    if (correct) score += 1;
    totalMs += Math.min(5_000, elapsed);
    answerLog.push({ correct, timedOut: !inTime || value === null, elapsedMs: Math.round(elapsed) });
  }

  const proposedResult = {
    score,
    correct: score,
    wrong: 10 - score,
    totalMs: Math.round(totalMs),
    answers: answerLog,
    submittedAt: new Date().toISOString()
  };

  let persistedChallenge = null;
  let sha = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const latest = attempt === 0 ? file : await readJsonFile(challengeFilePath(id), env);
    if (!latest) {
      const error = new Error("Este desafio não foi encontrado.");
      error.status = 404;
      throw error;
    }
    if (latest.data.results?.[username]) {
      persistedChallenge = latest.data;
      sha = latest.sha;
      break;
    }

    persistedChallenge = latest.data;
    persistedChallenge.results = persistedChallenge.results || {};
    persistedChallenge.results[username] = proposedResult;
    finalizeChallengeRecord(persistedChallenge);
    try {
      sha = await writeJsonFile(
        challengeFilePath(id), persistedChallenge, latest.sha, env,
        "Registrar resultado do desafio " + id + " - " + username
      );
      break;
    } catch (error) {
      if ((error.status !== 409 && error.status !== 422) || attempt === 4) throw error;
      persistedChallenge = null;
    }
  }
  if (!persistedChallenge) {
    const error = new Error("Não foi possível salvar seu resultado. Atualize a lista e tente novamente.");
    error.status = 409;
    throw error;
  }
  const isCompleted = persistedChallenge.status === "completed";
  if (isCompleted) {
    const participants = Array.isArray(persistedChallenge.participants) && persistedChallenge.participants.length
      ? persistedChallenge.participants : [persistedChallenge.challenger, persistedChallenge.recipient].filter(Boolean);
    await Promise.all(participants.map(async participant => {
      try { await applyChallengeStats(participant, persistedChallenge, env); }
      catch (error) { console.error("Não foi possível atualizar o histórico de desafios de " + participant + ":", error); }
    }));
    if (persistedChallenge.betMode === true && persistedChallenge.winner && Number.isSafeInteger(persistedChallenge.stake) && persistedChallenge.stake > 0) {
      try {
        await applyChallengeBetTransaction(persistedChallenge.winner, persistedChallenge.id, "payout", persistedChallenge.stake * 2, env);
        const latest = await readJsonFile(challengeFilePath(id), env);
        if (latest?.data && latest.data.betPaid !== true) { latest.data.betPaid = true; await writeJsonFile(challengeFilePath(id), latest.data, latest.sha, env, "Pagar aposta do desafio " + id); }
        persistedChallenge.betPaid = true;
      } catch (error) { console.error("Não foi possível pagar a aposta do desafio " + id + ":", error); }
    }
  }
  return {
    challenge: safeChallengeSummary(persistedChallenge, username),
    result: persistedChallenge.results[username],
    completed: isCompleted,
    sha
  };
}


function communitySummary(record) {
  const profile = record.profile && typeof record.profile === "object" ? record.profile : {};
  const history = safeHistory(record.history);
  const questions = Object.values(history.questions).filter(item => item && typeof item === "object");
  const correct = questions.reduce((sum, item) => sum + (Number(item.correct) || 0), 0);
  const wrong = questions.reduce((sum, item) => sum + (Number(item.wrong) || 0), 0);
  const sessions = Array.isArray(history.sessions) ? history.sessions : [];
  const recordedSessionMs = sessions.reduce((sum, item) => sum + (Number(item?.timeMs) || 0), 0);
  const timeMs = Math.max(0, Number(profile.studyTimeMs) || 0, recordedSessionMs);
  const economy = normalizeGameEconomy(record);
  const stats = profile.challengeStats && typeof profile.challengeStats === "object" ? profile.challengeStats : {};
  const total = stats.total || {};
  const medals = Object.entries(stats.levels || {})
    .filter(([, level]) => Number(level?.wins) >= 10)
    .map(([id, level]) => ({ id, name: level.name || id }));
  const achievementTitles = {
    training_first: "Primeiro Ciclo", training_5: "Ritmo de Treino", training_25: "Disciplina",
    adventure_first: "A Jornada Começa", adventure_5: "Explorador", adventure_13: "Desbravador",
    adventure_26: "Lenda da Tabuada", perfect_first: "Precisão de Ouro", perfect_5: "Mestre da Precisão",
    combo_5: "Sequência Brilhante", coins_100: "Primeiras Economias", coins_500: "Tesouro da Tabuada",
    collector_5: "Colecionador", challenge_four: "Lenda dos Quatro",
    tournament_easy_top3: "Pódio Mensal Fácil", tournament_easy_top10: "Top 10 Fácil",
    tournament_medium_top3: "Pódio Mensal Médio", tournament_medium_top10: "Top 10 Médio",
    tournament_hard_top3: "Pódio Mensal Difícil", tournament_hard_top10: "Top 10 Difícil",
    tournament_perfect50: "50 Acertos no Torneio"
  };
  const titles = Object.keys(economy.achievements).map(id => achievementTitles[id]).filter(Boolean).slice(0, 12);
  const awards = Object.entries(profile.tournamentAwards && typeof profile.tournamentAwards === "object" ? profile.tournamentAwards : {})
    .map(([month, award]) => ({ month, difficulty: String(award?.difficulty || "Torneio"), rank: Math.max(0, Number(award?.rank) || 0), score: Math.max(0, Number(award?.score) || 0), frame: String(award?.frame || "") }))
    .filter(award => /^\d{4}-\d{2}$/.test(award.month) && award.rank > 0)
    .sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
  return {
    username: record.username,
    displayName: profile.displayName || record.username,
    avatar: profile.avatar || "imagem:0",
    correct, wrong, attempts: correct + wrong, timeMs,
    coins: economy.coins, totalEarned: economy.totalEarned,
    trainingCycles: economy.trainingCycles, completedStages: economy.completedStages.length,
    achievementCount: Object.keys(economy.achievements).length,
    titles, medals, awards,
    challengeWins: Number(total.wins) || 0,
    challengeLosses: Number(total.losses) || 0,
    challengeTotal: (Number(total.wins) || 0) + (Number(total.losses) || 0),
    tournamentFrame: profile.tournamentFrame || null
  };
}
async function loadCommunitySummaries(env) {
  if (communitySummaryCache.records && Date.now() < communitySummaryCache.expiresAt) {
    return communitySummaryCache.records;
  }
  if (communitySummaryCache.pending) return communitySummaryCache.pending;
  const pending = (async () => {
    const entries = await githubRequest(
      "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DIRECTORY +
      "?ref=" + encodeURIComponent(GH_BRANCH), env
    );
    if (!Array.isArray(entries)) throw new Error("A pasta de participantes não retornou uma lista.");
    const folders = entries.filter(item => item.type === "dir" && usernameIsValid(item.name))
      .slice(0, COMMUNITY_MAX_USERS);
    const records = [];
    for (let offset = 0; offset < folders.length; offset += 6) {
      const batch = folders.slice(offset, offset + 6);
      const summaries = await Promise.all(batch.map(async item => {
        try {
          const record = await readUser(item.name, env);
          return record ? communitySummary(record.data) : null;
        } catch { return null; }
      }));
      records.push(...summaries.filter(Boolean));
    }
    return records;
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


function currentSaoPauloMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit"
  }).formatToParts(date);
  return parts.find(part => part.type === "year")?.value + "-" +
    parts.find(part => part.type === "month")?.value;
}
function previousMonthKey(month) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 2, 1));
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
}
function tournamentFilePath(month) {
  return "torneio-mensal-" + month + ".json";
}
function tournamentRandom(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildTournamentQuestions(seed, difficulty) {
  const preset = TOURNAMENT_PRESETS[difficulty];
  if (!preset) return [];
  const random = tournamentRandom(seed);
  const pool = [];
  for (const table of preset.tables) for (let factor = 1; factor <= 10; factor++) pool.push({ a: table, b: factor });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 50).map(fact => {
    const answer = fact.a * fact.b;
    const choices = new Set([answer]);
    while (choices.size < preset.options) {
      const spread = Math.max(8, Math.ceil(answer * 0.25));
      const offset = 1 + Math.floor(random() * spread);
      choices.add(random() < 0.5 ? answer + offset : Math.max(0, answer - offset));
    }
    const options = [...choices];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { ...fact, answer, options };
  });
}
function rankTournament(board, difficulty, username) {
  const entries = Object.entries(board.results?.[difficulty] || {})
    .filter(([, result]) => (Number(result.score) || 0) >= TOURNAMENT_MIN_VALID_SCORE)
    .map(([name, result]) => ({
      username: name, score: Number(result.score) || 0, totalMs: Number(result.totalMs) || 0,
      perfect: result.perfect === true
    }));
  entries.sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.username.localeCompare(b.username));
  const position = entries.findIndex(item => item.username === username) + 1;
  return { difficulty, total: entries.length, top10: entries.slice(0, 10), position: position || null, own: position ? entries[position - 1] : null };
}
async function ensureTournamentBoard(month, env) {
  const path = tournamentFilePath(month);
  const existing = await readJsonFile(path, env);
  if (existing) return existing;
  const data = {
    version: 1, month, createdAt: new Date().toISOString(),
    seeds: {
      easy: crypto.getRandomValues(new Uint32Array(1))[0] || 1,
      medium: crypto.getRandomValues(new Uint32Array(1))[0] || 2,
      hard: crypto.getRandomValues(new Uint32Array(1))[0] || 3
    },
    results: { easy: {}, medium: {}, hard: {} }
  };
  try {
    const sha = await writeJsonFile(path, data, null, env, "Abrir torneio mensal " + month);
    return { data, sha };
  } catch (error) {
    if (error.status !== 409 && error.status !== 422) throw error;
    const latest = await readJsonFile(path, env);
    if (!latest) throw error;
    return latest;
  }
}
async function updateTournamentBoard(month, difficulty, username, result, env) {
  const path = tournamentFilePath(month);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await ensureTournamentBoard(month, env);
    const data = current.data;
    data.results = data.results || { easy: {}, medium: {}, hard: {} };
    data.results[difficulty] = data.results[difficulty] || {};
    const previous = data.results[difficulty][username];
    if (previous && (Number(previous.score) || 0) >= TOURNAMENT_MIN_VALID_SCORE) {
      return { board: data, alreadySubmitted: true };
    }
    // Results saved by the older version below 60% can be replaced after retry.
    data.results[difficulty][username] = result;
    try {
      const sha = await writeJsonFile(path, data, current.sha, env, "Registrar resultado mensal de " + username);
      return { board: data, sha, alreadySubmitted: false };
    } catch (error) {
      if ((error.status !== 409 && error.status !== 422) || attempt === 4) throw error;
    }
  }
  throw new Error("Não foi possível registrar o resultado do torneio.");
}
async function awardFinishedTournament(userFile, month, board, env) {
  const profile = userFile.data.profile && typeof userFile.data.profile === "object" ? userFile.data.profile : {};
  const participation = profile.monthlyTournaments?.[month];
  if (!participation?.difficulty || !participation?.result) return null;
  const difficulty = participation.difficulty;
  const ranking = rankTournament(board, difficulty, userFile.data.username);
  if (!ranking.position) return null;
  const existingAward = profile.tournamentAwards?.[month];
  if (existingAward) return { ...existingAward, rank: ranking.position, top10: ranking.top10, alreadyAwarded: true };
  const rank = ranking.position;
  const economy = normalizeGameEconomy(userFile.data);
  const newAchievements = [];
  let frame = null;
  if (rank <= 3) {
    const id = "tournament_" + difficulty + "_top3";
    if (!economy.achievements[id]) { economy.achievements[id] = new Date().toISOString(); newAchievements.push(id); }
    frame = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";
  } else if (rank <= 10) {
    const id = "tournament_" + difficulty + "_top10";
    if (!economy.achievements[id]) { economy.achievements[id] = new Date().toISOString(); newAchievements.push(id); }
    frame = "top10";
  }
  if (participation.result.score === 50 && !economy.achievements.tournament_perfect50) {
    economy.achievements.tournament_perfect50 = new Date().toISOString();
    newAchievements.push("tournament_perfect50");
  }
  profile.tournamentAwards = profile.tournamentAwards || {};
  if (!profile.tournamentAwards[month]) profile.tournamentAwards[month] = {
    difficulty, rank, score: participation.result.score, frame, completedAt: new Date().toISOString()
  };
  const frameScore = { gold: 4, silver: 3, bronze: 2, top10: 1 };
  if ((frameScore[frame] || 0) > (frameScore[profile.tournamentFrame] || 0)) profile.tournamentFrame = frame;
  userFile.data.profile = profile;
  userFile.data.economy = economy;
  const sha = await writeUser(userFile.data.username, userFile.data, userFile.sha, env);
  return { sha, rank, frame, newAchievements };
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
          buildId: WORKER_BUILD_ID,
          features: { groupChallenges: true, monthlyTournament: true, compactCommunity: true, fastestChallengeWins: true, betChallenges: true, publicExpandedProfiles: true, atomicAdventureRewards: true, registeredPlayerNames: true, freeCompatible: true, tournamentMinimumScore: 30, adaptiveTournamentTimers: true, publicChallengeStats: true },
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
        buildId: WORKER_BUILD_ID,
        features: { groupChallenges: true, monthlyTournament: true, compactCommunity: true, fastestChallengeWins: true, betChallenges: true, publicExpandedProfiles: true, atomicAdventureRewards: true, registeredPlayerNames: true, freeCompatible: true, tournamentMinimumScore: 30, adaptiveTournamentTimers: true, publicChallengeStats: true },
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
          avatar: "imagem:0"
        },
        history: { questions: {}, sessions: [] },
        economy: defaultGameEconomy("imagem:0"),
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

    if (route.startsWith("/api/challenges")) {
      const limited = await rateLimitResponse(env.GAME_ACTION_LIMITER, username + ":challenges",
        "Muitas ações de desafio em pouco tempo. Aguarde um minuto e tente novamente.", origin);
      if (limited) return limited;
    }
    if (route.startsWith("/api/tournament")) {
      const limited = await rateLimitResponse(env.GAME_ACTION_LIMITER, username + ":tournament",
        "Muitas consultas ou tentativas no torneio. Aguarde um minuto e tente novamente.", origin);
      if (limited) return limited;
    }

    if (route === "/api/challenges/players" && request.method === "GET") {
      // Primeiro lista as pastas; depois lê nome, avatar e saldo público.
      // Mesmo com 45 perfis, a consulta fica em no máximo 46 subrequests ao GitHub.
      const entries = await githubRequest(
        "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DIRECTORY +
        "?ref=" + encodeURIComponent(GH_BRANCH), env
      );
      if (!Array.isArray(entries)) throw new Error("A pasta de participantes não retornou uma lista.");
      const folders = entries.filter(item =>
        item.type === "dir" && usernameIsValid(item.name) && item.name !== username
      );
      const publicProfiles = new Map();
      for (let offset = 0; offset < Math.min(folders.length, CHALLENGE_PLAYER_METADATA_MAX); offset += 9) {
        const batch = folders.slice(offset, offset + 9);
        const loaded = await Promise.all(batch.map(async item => {
          try {
            const file = await readUser(item.name, env);
            const profile = file?.data?.profile && typeof file.data.profile === "object"
              ? file.data.profile : {};
            return {
              username: item.name,
              displayName: String(profile.displayName || item.name).slice(0, 24),
              avatar: typeof profile.avatar === "string" ? profile.avatar : "imagem:0",
              coins: normalizeGameEconomy(file.data).coins
            };
          } catch {
            return { username: item.name, displayName: item.name, avatar: "imagem:0", coins: 0 };
          }
        }));
        loaded.forEach(profile => publicProfiles.set(profile.username, profile));
      }
      const players = folders.map(item => publicProfiles.get(item.name) || {
        username: item.name, displayName: item.name, avatar: "imagem:0", coins: 0
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
      return json({ players, totalRegistered: folders.length }, 200, origin);
    }

    if (route === "/api/challenges" && request.method === "GET") {
      const result = await listChallengesFor(username, env);
      return json(result, 200, origin);
    }

    const challengePlayersMatch = route.match(/^\/api\/challenges\/([a-f0-9]{32})\/players$/);
    if (challengePlayersMatch && request.method === "GET") {
      const file = await readJsonFile(challengeFilePath(challengePlayersMatch[1]), env);
      const challenge = file?.data;
      const participants = Array.isArray(challenge?.participants) && challenge.participants.length
        ? challenge.participants : [challenge?.challenger, challenge?.recipient].filter(Boolean);
      if (!challenge || !participants.includes(username)) {
        const error = new Error("Desafio não encontrado para esta conta.");
        error.status = 404;
        throw error;
      }
      // Lê somente os dados públicos atuais dos participantes: nome e avatar.
      // São no máximo 1 leitura do desafio + 5 leituras de perfil por chamada.
      const players = await Promise.all(participants.map(async participant => {
        try {
          const record = await readUser(participant, env);
          const profile = record?.data?.profile && typeof record.data.profile === "object"
            ? record.data.profile : {};
          return {
            username: participant,
            displayName: String(profile.displayName || participant).slice(0, 24),
            avatar: validAvatarKey(profile.avatar) ? profile.avatar : "imagem:0",
            coins: normalizeGameEconomy(record.data).coins
          };
        } catch {
          return { username: participant, displayName: participant, avatar: "imagem:0" };
        }
      }));
      return json({ players }, 200, origin);
    }

    if (route === "/api/challenges" && request.method === "POST") {
      const body = await readJson(request);
      const challenge = await createChallenge(body, username, env);
      return json({ challenge }, 201, origin);
    }

    const challengeRespondMatch = route.match(/^\/api\/challenges\/([a-f0-9]{32})\/respond$/);
    if (challengeRespondMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = await respondToBetChallenge(challengeRespondMatch[1], body.decision, username, env);
      return json({ challenge: result }, 200, origin);
    }

    const challengeResultMatch = route.match(/^\/api\/challenges\/([a-f0-9]{32})\/result$/);
    if (challengeResultMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = await submitChallengeResult(challengeResultMatch[1], body, username, env);
      return json(result, 200, origin);
    }


    if (route === "/api/tournament" && request.method === "GET") {
      const month = currentSaoPauloMonth();
      const previous = previousMonthKey(month);
      const [currentBoard, userFile] = await Promise.all([
        ensureTournamentBoard(month, env), readUser(username, env)
      ]);
      const rankings = Object.keys(TOURNAMENT_PRESETS).map(difficulty =>
        rankTournament(currentBoard.data, difficulty, username)
      );
      let finalNotice = null;
      if (userFile) {
        const previousBoard = await readJsonFile(tournamentFilePath(previous), env);
        const participation = userFile.data.profile?.monthlyTournaments?.[previous];
        if (previousBoard && participation?.difficulty && participation.result) {
          const ranking = rankTournament(previousBoard.data, participation.difficulty, username);
          const award = await awardFinishedTournament(userFile, previous, previousBoard.data, env);
          finalNotice = {
            month: previous, difficulty: participation.difficulty,
            difficultyName: TOURNAMENT_PRESETS[participation.difficulty].name,
            position: ranking.position, total: ranking.total,
            score: participation.result.score, top10: ranking.top10, award
          };
        }
      }
      const latestUser = finalNotice ? await readUser(username, env) : userFile;
      return json({
        month,
        selectedDifficulty: latestUser?.data?.profile?.monthlyTournaments?.[month]?.difficulty || null,
        rankings, finalNotice
      }, 200, origin);
    }

    if (route === "/api/tournament/start" && request.method === "POST") {
      const body = await readJson(request);
      const difficulty = String(body.difficulty || "");
      const preset = TOURNAMENT_PRESETS[difficulty];
      if (!preset) return json({ error: "Escolha uma dificuldade válida para o torneio." }, 400, origin);
      const month = currentSaoPauloMonth();
      const file = await readUser(username, env);
      if (!file) return json({ error: "A conta não foi encontrada." }, 404, origin);
      const profile = file.data.profile && typeof file.data.profile === "object" ? file.data.profile : {};
      profile.monthlyTournaments = profile.monthlyTournaments || {};
      let participation = profile.monthlyTournaments[month];
      if (participation && participation.difficulty !== difficulty) {
        return json({ error: "Você já escolheu " + (TOURNAMENT_PRESETS[participation.difficulty]?.name || "uma dificuldade") +
          " neste mês. Só é permitido participar de uma dificuldade por mês." }, 409, origin);
      }
      if (participation?.result) {
        if ((Number(participation.result.score) || 0) >= TOURNAMENT_MIN_VALID_SCORE) {
          return json({ error: "Você já concluiu seu torneio deste mês." }, 409, origin);
        }
        // A tentativa antiga abaixo de 60% não vale; libere a mesma prova para nova tentativa.
        delete participation.result;
        profile.monthlyTournaments[month] = participation;
        file.data.profile = profile;
        file.data.updatedAt = new Date().toISOString();
        await writeUser(username, file.data, file.sha, env);
      }
      const board = await ensureTournamentBoard(month, env);
      if (!participation) {
        participation = { difficulty, attemptId: randomHex(16), startedAt: new Date().toISOString() };
        profile.monthlyTournaments[month] = participation;
        file.data.profile = profile;
        await writeUser(username, file.data, file.sha, env);
      }
      const questions = buildTournamentQuestions(board.data.seeds[difficulty], difficulty)
        .map(({ answer, ...question }) => question);
      return json({
        month, difficulty, difficultyName: preset.name,
        attemptId: participation.attemptId,
        seed: board.data.seeds[difficulty],
        questions, questionCount: 50, secondsPerQuestion: TOURNAMENT_SECONDS_PER_QUESTION[difficulty],
        minimumScore: TOURNAMENT_MIN_VALID_SCORE, optionCount: preset.options
      }, 200, origin);
    }

    if (route === "/api/tournament/submit" && request.method === "POST") {
      const body = await readJson(request);
      const difficulty = String(body.difficulty || "");
      if (!TOURNAMENT_PRESETS[difficulty]) return json({ error: "Dificuldade inválida." }, 400, origin);
      const month = currentSaoPauloMonth();
      const file = await readUser(username, env);
      const participation = file?.data?.profile?.monthlyTournaments?.[month];
      if (!participation || participation.difficulty !== difficulty || participation.attemptId !== body.attemptId) {
        return json({ error: "Esta participação não corresponde ao torneio mensal iniciado nesta conta." }, 403, origin);
      }
      if (participation.result) return json({ error: "Seu resultado deste mês já foi enviado." }, 409, origin);
      const answers = Array.isArray(body.answers) ? body.answers : [];
      if (answers.length !== 50) return json({ error: "O torneio precisa ter exatamente 50 respostas." }, 400, origin);
      const board = await ensureTournamentBoard(month, env);
      const questions = buildTournamentQuestions(board.data.seeds[difficulty], difficulty);
      const secondsPerQuestion = TOURNAMENT_SECONDS_PER_QUESTION[difficulty];
      const questionLimitMs = secondsPerQuestion * 1000;
      let score = 0, totalMs = 0;
      for (let i = 0; i < 50; i++) {
        const answer = answers[i] || {};
        const elapsed = Number(answer.elapsedMs);
        const value = answer.value === null || answer.value === undefined ? null : Number(answer.value);
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60_000 ||
            (value !== null && !Number.isSafeInteger(value))) {
          return json({ error: "Uma das respostas do torneio está inválida." }, 400, origin);
        }
        if (elapsed <= questionLimitMs && value === questions[i].answer) score++;
        totalMs += Math.min(questionLimitMs, elapsed);
      }
      if (score < TOURNAMENT_MIN_VALID_SCORE) {
        return json({
          error: "Você acertou " + score + "/50. São necessários pelo menos " +
            TOURNAMENT_MIN_VALID_SCORE + "/50 (60%) para validar a participação. Sua tentativa não entrou no ranking. Refaça o torneio na mesma dificuldade.",
          score,
          minimumScore: TOURNAMENT_MIN_VALID_SCORE,
          questionCount: 50,
          secondsPerQuestion,
          retryAllowed: true
        }, 422, origin);
      }
      const result = { score, totalMs: Math.round(totalMs), perfect: score === 50, completedAt: new Date().toISOString() };
      const updatedBoard = await updateTournamentBoard(month, difficulty, username, result, env);
      const storedResult = updatedBoard.board.results[difficulty][username];
      participation.result = storedResult;
      file.data.profile.monthlyTournaments[month] = participation;
      file.data.updatedAt = new Date().toISOString();
      await writeUser(username, file.data, file.sha, env);
      const ranking = rankTournament(updatedBoard.board, difficulty, username);
      return json({
        result: storedResult, position: ranking.position, total: ranking.total, top10: ranking.top10,
        month, difficulty, perfect: result.perfect
      }, 200, origin);
    }

    if ((route === "/api/game/reward" || route === "/api/game/shop") && request.method === "POST") {
      const limited = await rateLimitResponse(env.GAME_ACTION_LIMITER, username,
        "Muitas ações de jogo em pouco tempo. Aguarde um minuto e tente novamente.", origin);
      if (limited) return limited;
      const body = await readJson(request);
      const record = await readUser(username, env);
      if (!record) return json({ error: "A conta não foi encontrada." }, 404, origin);
      const economy = normalizeGameEconomy(record.data);
      let coinsAdded = 0, alreadyClaimed = false, changed = false;

      if (route === "/api/game/reward") {
        if (body.type === "training_cycle") {
          const claimId = typeof body.claimId === "string" ? body.claimId : "";
          if (!/^[A-Za-z0-9:_-]{8,100}$/.test(claimId)) {
            return json({ error: "Identificador de ciclo inválido." }, 400, origin);
          }
          if (economy.trainingClaimIds.includes(claimId)) {
            alreadyClaimed = true;
          } else {
            economy.trainingClaimIds.push(claimId);
            economy.trainingClaimIds = economy.trainingClaimIds.slice(-500);
            economy.trainingCycles += 1;
            economy.coins += 10;
            economy.totalEarned += 10;
            coinsAdded = 10;
            changed = true;
          }
        } else if (body.type === "adventure_stage") {
          const stageId = Number(body.stageId);
          if (!Number.isInteger(stageId) || stageId < 1 || stageId > ADVENTURE_STAGE_COUNT) {
            return json({ error: "Fase inválida." }, 400, origin);
          }
          const incoming = body.adventureProgress;
          const incomingStage = incoming?.stages?.[String(stageId)];
          if (incoming && typeof incoming === "object" && incomingStage?.completed === true) {
            const profile = record.data.profile && typeof record.data.profile === "object"
              ? record.data.profile : {};
            const current = profile.adventureProgress && typeof profile.adventureProgress === "object"
              ? profile.adventureProgress : { version: 1, unlockedStage: 0, xp: 0, stages: {} };
            const stages = current.stages && typeof current.stages === "object" ? { ...current.stages } : {};
            const safeInteger = (value, max) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
            const prior = stages[String(stageId)] && typeof stages[String(stageId)] === "object"
              ? stages[String(stageId)] : {};
            stages[String(stageId)] = {
              ...prior,
              completed: true,
              attempts: Math.max(safeInteger(prior.attempts, 100000), safeInteger(incomingStage.attempts, 100000)),
              stars: Math.max(safeInteger(prior.stars, 3), safeInteger(incomingStage.stars, 3)),
              bestCorrect: Math.max(safeInteger(prior.bestCorrect, 10), safeInteger(incomingStage.bestCorrect, 10)),
              bestTotal: safeInteger(incomingStage.bestTotal, 10) || safeInteger(prior.bestTotal, 10),
              lastCorrect: safeInteger(incomingStage.lastCorrect, 10),
              bestCombo: Math.max(safeInteger(prior.bestCombo, 10), safeInteger(incomingStage.bestCombo, 10)),
              completedAt: prior.completedAt || incomingStage.completedAt || new Date().toISOString(),
              lastPlayedAt: incomingStage.lastPlayedAt || new Date().toISOString()
            };
            profile.adventureProgress = {
              version: 1,
              unlockedStage: Math.max(
                safeInteger(current.unlockedStage, ADVENTURE_STAGE_COUNT - 1),
                safeInteger(incoming.unlockedStage, ADVENTURE_STAGE_COUNT - 1)
              ),
              xp: Math.max(safeInteger(current.xp, 100000000), safeInteger(incoming.xp, 100000000)),
              stages,
              lastStageId: stageId
            };
            record.data.profile = profile;
            changed = true;
          }
          const stageProgress = record.data.profile?.adventureProgress?.stages?.[String(stageId)];
          if (!stageProgress || stageProgress.completed !== true) {
            return json({ error: "A conclusão da fase não foi enviada corretamente. Tente concluir a fase novamente." }, 409, origin);
          }
          if (Number(stageProgress.stars) === 3 && !economy.perfectStages.includes(stageId)) {
            economy.perfectStages.push(stageId);
            changed = true;
          }
          if (Number(stageProgress.bestCombo) >= 5 && !economy.comboStages.includes(stageId)) {
            economy.comboStages.push(stageId);
            changed = true;
          }
          if (economy.completedStages.includes(stageId)) {
            alreadyClaimed = true;
          } else {
            economy.completedStages.push(stageId);
            economy.coins += 50;
            economy.totalEarned += 50;
            coinsAdded = 50;
            changed = true;
          }
        } else {
          return json({ error: "Tipo de recompensa inválido." }, 400, origin);
        }
      } else {
        const avatarKey = body.avatarKey;
        if (!validAvatarKey(avatarKey) || avatarKey === "imagem:0") {
          return json({ error: "Avatar inválido ou já disponível gratuitamente." }, 400, origin);
        }
        if (economy.ownedAvatars.includes(avatarKey)) {
          return json({ economy, alreadyOwned: true, coinsAdded: 0, newAchievements: [] }, 200, origin);
        }
        const price = avatarKey.startsWith("gif:") ? 1500 : 100;
        if (economy.coins < price) {
          return json({ error: "Você ainda não tem moedas suficientes. Este avatar custa " + price + " moedas." }, 400, origin);
        }
        economy.coins -= price;
        economy.ownedAvatars.push(avatarKey);
        changed = true;
      }

      const newAchievements = evaluateGameAchievements(economy);
      if (changed || newAchievements.length) {
        record.data.economy = economy;
        record.data.updatedAt = new Date().toISOString();
        const sha = await writeUser(username, record.data, record.sha, env);
        return json({ economy, coinsAdded, alreadyClaimed, newAchievements, sha, updatedAt: record.data.updatedAt }, 200, origin);
      }
      return json({ economy, coinsAdded, alreadyClaimed, newAchievements, sha: record.sha, updatedAt: record.data.updatedAt }, 200, origin);
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
          ? {
              ...record.data.profile,
              ...body.profile,
              studyTimeMs: Math.max(Number(record.data.profile?.studyTimeMs) || 0, Number(body.profile.studyTimeMs) || 0),
              challengeStats: record.data.profile?.challengeStats || body.profile.challengeStats,
              monthlyTournaments: {
                ...(body.profile.monthlyTournaments || {}),
                ...(record.data.profile?.monthlyTournaments || {})
              },
              tournamentAwards: {
                ...(body.profile.tournamentAwards || {}),
                ...(record.data.profile?.tournamentAwards || {})
              },
              tournamentFrame: record.data.profile?.tournamentFrame || body.profile.tournamentFrame
            }
          : record.data.profile,
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
