import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";

const ROOT = process.cwd();
const SITE_URL = process.env.SITE_URL || "http://127.0.0.1:4173/";
const fail = (message) => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/music/manifest.json"), "utf8"));
const specs = {
  principal: { bpm: [110, 132], energy: [0.82, 1.12], leads: ["square", "saw", "strings", "flute", "keys", "guitar", "pluck", "bell", "brass"], grooves: ["arcade", "dance", "cinematic", "funk", "battle", "adventure", "electro", "rock", "stealth", "ambient", "synthwave"], scales: ["major", "mixolydian", "minor", "dorian", "phrygian", "lydian"] },
  treinamento: { bpm: [88, 110], energy: [0.62, 0.84], leads: ["keys", "bell", "pluck", "flute"], grooves: ["ambient", "funk", "adventure"], scales: ["major", "dorian", "mixolydian"] },
  desafio: { bpm: [144, 170], energy: [1.08, 1.30], leads: ["square", "saw", "guitar", "brass"], grooves: ["dance", "electro", "battle", "rock", "synthwave"], scales: ["minor", "phrygian", "mixolydian", "dorian"] },
  "modo-jogo": { bpm: [108, 132], energy: [0.78, 1.06], leads: ["strings", "flute", "brass", "bell", "guitar"], grooves: ["cinematic", "adventure", "battle"], scales: ["minor", "dorian", "major", "phrygian"] },
  torneio: { bpm: [126, 156], energy: [1.00, 1.22], leads: ["brass", "strings", "saw", "square"], grooves: ["battle", "electro", "cinematic", "rock"], scales: ["minor", "phrygian", "dorian"] }
};

check(manifest.version === 2, "Versão inesperada do manifesto musical.");
check(manifest.minimum_tracks_per_category === 20, "O catálogo não garante 20 faixas por modalidade.");
check(manifest.minimum_duration_seconds >= 30, "A duração mínima declarada está abaixo de 30 segundos.");

const hashes = new Set();
const srcs = new Set();
const musicSummary = {};
let totalBytes = 0;
for (const [category, spec] of Object.entries(specs)) {
  const tracks = manifest.playlists && manifest.playlists[category];
  check(Array.isArray(tracks) && tracks.length === 20, category + ": deveria ter exatamente 20 faixas.");
  const trackIds = new Set();
  for (const track of tracks) {
    check(track.id && !trackIds.has(track.id), category + ": ID vazio ou repetido.");
    trackIds.add(track.id);
    check(track.duration_seconds >= 30, track.name + ": duração inferior a 30 segundos.");
    check(track.arrangement_bars === 36, track.name + ": arranjo não contém as 36 barras previstas.");
    check(track.bpm >= spec.bpm[0] && track.bpm <= spec.bpm[1], track.name + ": BPM fora do perfil de " + category + ".");
    check(track.energy >= spec.energy[0] && track.energy <= spec.energy[1], track.name + ": energia fora do perfil de " + category + ".");
    check(spec.leads.includes(track.lead_instrument), track.name + ": instrumento incompatível com " + category + ".");
    check(spec.grooves.includes(track.rhythm_style), track.name + ": ritmo incompatível com " + category + ".");
    check(spec.scales.includes(track.scale), track.name + ": escala incompatível com " + category + ".");
    check(track.src.startsWith("assets/music/" + category + "/"), track.name + ": caminho fora da coleção.");
    check(!srcs.has(track.src), track.name + ": caminho de áudio repetido.");
    srcs.add(track.src);
    const filePath = path.join(ROOT, track.src);
    check(fs.existsSync(filePath), track.name + ": arquivo de áudio ausente.");
    const bytes = fs.readFileSync(filePath);
    check(bytes.length > 10000, track.name + ": arquivo de áudio vazio ou pequeno demais.");
    const isMp3 = bytes.subarray(0, 3).toString("ascii") === "ID3" ||
      Array.from(bytes.subarray(0, Math.min(4096, bytes.length - 1))).some((value, index, array) =>
        value === 0xff && (array[index + 1] & 0xe0) === 0xe0);
    check(isMp3, track.name + ": cabeçalho MP3 não reconhecido.");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    check(!hashes.has(hash), track.name + ": áudio duplicado em outra faixa.");
    hashes.add(hash);
    totalBytes += bytes.length;
  }
  const unique = (key) => new Set(tracks.map(track => track[key])).size;
  check(unique("lead_instrument") === spec.leads.length, category + ": nem todos os instrumentos previstos estão sendo usados.");
  check(unique("rhythm_style") === spec.grooves.length, category + ": nem todos os ritmos previstos estão sendo usados.");
  check(unique("scale") === spec.scales.length, category + ": nem todas as escalas previstas estão sendo usadas.");
  check(unique("bpm") >= 10, category + ": pouca variedade de andamento.");
  musicSummary[category] = {
    tracks: tracks.length,
    instruments: unique("lead_instrument"),
    rhythms: unique("rhythm_style"),
    scales: unique("scale"),
    distinctBpm: unique("bpm"),
    bpmRange: [Math.min(...tracks.map(t => t.bpm)), Math.max(...tracks.map(t => t.bpm))],
    durationRange: [
      Math.min(...tracks.map(t => t.duration_seconds)),
      Math.max(...tracks.map(t => t.duration_seconds))
    ]
  };
}
check(hashes.size === 100 && srcs.size === 100, "O catálogo não contém 100 arquivos de áudio únicos.");
check(totalBytes > 10000000, "O tamanho total dos áudios parece inválido.");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
check(duplicates.length === 0, "IDs HTML repetidos: " + [...new Set(duplicates)].join(", "));
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(script => script.trim());
check(inlineScripts.length === 1, "Quantidade inesperada de scripts inline.");
new Function(inlineScripts[0]);

const logoutStart=html.indexOf("async function logout(){");
const logoutEnd=html.indexOf("\nfunction escapeHtml",logoutStart);
const logoutCode=logoutStart>=0&&logoutEnd>logoutStart?html.slice(logoutStart,logoutEnd):"";
check(html.includes("const ACTIVE_TIME_SYNC_MS=30*60*1000;"), "O salvamento automático não está configurado para 30 minutos.");
check(logoutCode.length>0&&!logoutCode.includes("flushCloudSave(true)"), "Sair da conta ainda força um salvamento antes dos 30 minutos.");
check(html.includes("pendingActiveMs>0?loadHistory():remoteHistory"), "O login não preserva o histórico local que ainda não foi sincronizado.");
check(html.includes("Último salvamento: "), "O perfil não mostra o rótulo do último salvamento.");
const autosaveContract = {
  thresholdMinutes: 30,
  preservesPartialTimeOnLogout: true,
  restoresLocalHistoryWhenPending: true,
  displaysLastSavedLabel: true
};
const selectorRefs = [...inlineScripts[0].matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
const missingIds = [...new Set(selectorRefs.filter(id => !ids.includes(id)))];
check(missingIds.length === 0, "IDs usados no JavaScript e ausentes do HTML: " + missingIds.join(", "));

const browser = await chromium.launch({ headless: true });
const viewportResults = [];
async function testViewport(name, viewport, mobile = false) {
  const page = await browser.newPage({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    locale: "pt-BR"
  });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("projetoTabuadaUltimaFaixaV2:principal", "0");
  });
  const response = await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  check(response && response.status() === 200, name + ": a página inicial não respondeu com HTTP 200.");
  await page.locator("#authScreen").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelectorAll("#trackSelect option").length === 20,
    null,
    { timeout: 30000 }
  );
  check((await page.locator("#trackSelect").inputValue()) !== "0",
    name + ": a tela inicial repetiu a última faixa salva em vez de escolher outra.");
  const musicNote = (await page.locator(".music-note").textContent()) || "";
  check(musicNote.includes("100 trilhas") && musicNote.includes("20 para cada área"),
    name + ": o site não explica que o catálogo possui 100 músicas.");

  const homeOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  check(homeOverflow.document <= homeOverflow.viewport + 1, name + ": há rolagem horizontal na tela inicial (" + JSON.stringify(homeOverflow) + ").");
  check(await page.locator("#loginUsername").isVisible(), name + ": campo de usuário não está visível.");
  check(await page.locator("#loginPassword").isVisible(), name + ": campo de senha não está visível.");
  const rememberColor = await page.locator(".remember-session").evaluate(element => getComputedStyle(element).color);
  check(rememberColor === "rgb(66, 83, 107)", name + ": texto da opção manter conectado está com contraste incorreto (" + rememberColor + ").");
  const rememberLayout = await page.locator(".remember-session").evaluate(element => {
    const title = element.querySelector("b").getBoundingClientRect();
    const detail = element.querySelector("small").getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { boxHeight: box.height, titleBottom: title.bottom, detailTop: detail.top, detailBottom: detail.bottom, boxBottom: box.bottom };
  });
  check(rememberLayout.boxHeight >= 42 && rememberLayout.detailTop >= rememberLayout.titleBottom + 1 &&
    rememberLayout.detailBottom <= rememberLayout.boxBottom + 1,
    name + ": título e explicação da opção manter conectado estão sobrepostos (" + JSON.stringify(rememberLayout) + ").");

  await page.screenshot({ path: "artifacts/" + name + "-inicio.png", fullPage: true });

  await page.locator("#showRegister").click();
  check(!(await page.locator("#registerForm").evaluate(el => el.classList.contains("hidden"))), name + ": botão Cadastrar não abriu o formulário.");
  await page.locator("#showLogin").click();
  check(!(await page.locator("#loginForm").evaluate(el => el.classList.contains("hidden"))), name + ": botão Voltar ao login não funcionou.");

  const musicMenu = page.locator("#musicMenuToggle");
  await musicMenu.click();
  check(await musicMenu.getAttribute("aria-expanded") === "false", name + ": menu musical não recolheu.");
  check(await page.locator("#musicControls").evaluate(el => el.classList.contains("hidden")), name + ": controles musicais continuam abertos.");
  await musicMenu.click();
  check(await musicMenu.getAttribute("aria-expanded") === "true", name + ": menu musical não expandiu.");

  await page.locator("#trackSelect").selectOption("0");
  await page.waitForFunction(
    () => {
      const audio = document.querySelector("#soundtrackAudio");
      return audio && (audio.currentSrc || audio.src).includes("/assets/music/");
    },
    null,
    { timeout: 15000 }
  );
  const audio = await page.locator("#soundtrackAudio").evaluate(async element => {
    element.muted = true;
    if (element.readyState < 1) {
      await Promise.race([
        new Promise(resolve => element.addEventListener("loadedmetadata", resolve, { once: true })),
        new Promise(resolve => setTimeout(resolve, 15000))
      ]);
    }
    return {
      src: element.currentSrc || element.src,
      duration: element.duration,
      readyState: element.readyState
    };
  });
  check(Number.isFinite(audio.duration) && audio.duration >= 30, name + ": o navegador não carregou a duração da trilha (" + JSON.stringify(audio) + ").");

  await page.locator("#globalVolume").evaluate(element => {
    element.value = "65";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  check((await page.locator("#volumeValue").textContent()).trim() === "65%", name + ": controle de volume não atualizou.");

  const initialTrack = await page.locator("#trackSelect").inputValue();
  await page.locator("#replayTune").click();
  await page.waitForFunction(
    previous => document.querySelector("#trackSelect").value !== previous,
    initialTrack,
    { timeout: 10000 }
  );
  await page.locator("#soundToggle").click();
  check(await page.locator("#soundToggle").getAttribute("aria-pressed") === "false", name + ": botão de pausar música não funcionou.");
  await page.locator("#soundToggle").click();
  check(await page.locator("#soundToggle").getAttribute("aria-pressed") === "true", name + ": botão de retomar música não funcionou.");

  for (const category of ["principal", "treinamento", "desafio", "modo-jogo", "torneio"]) {
    await page.evaluate(value => setMusicCategory(value, true, true), category);
    check(await page.locator("#trackSelect option").count() === 20, name + ": a coleção " + category + " não apresenta 20 opções.");
    await page.waitForFunction(
      value => document.querySelector("#soundtrackAudio").src.includes("/assets/music/" + value + "/"),
      category,
      { timeout: 15000 }
    );
  }

  await page.evaluate(() => {
    historyData.questions = {
      "1x2": {
        a: 1, b: 2, attempts: 4, correct: 3, wrong: 1, totalTimeMs: 12000,
        modes: { training: { attempts: 4, correct: 3, wrong: 1, totalTimeMs: 12000 } }
      },
      "3x4": {
        a: 3, b: 4, attempts: 3, correct: 2, wrong: 1, totalTimeMs: 10500,
        modes: { adventure: { attempts: 3, correct: 2, wrong: 1, totalTimeMs: 10500 } }
      }
    };
    historyData.sessions = [
      { answered: 4, hits: 3, misses: 1 },
      { answered: 5, hits: 4, misses: 1 },
      { answered: 6, hits: 5, misses: 1 }
    ];
    document.querySelector("#authScreen").classList.add("hidden");
    document.querySelector("#profileScreen").classList.remove("hidden");
  });
  await page.locator("#toggleProfileStats").click();
  check(!(await page.locator("#profileStatsPanel").evaluate(el => el.classList.contains("hidden"))), name + ": o painel de estatísticas não abriu.");
  check(await page.locator("#profileStatsRadar svg").count() === 1, name + ": gráfico radar não foi renderizado.");
  check(await page.locator("#profileStatsLine svg").count() === 1, name + ": gráfico de evolução não foi renderizado.");
  check(await page.locator("#profileStatsPie .stats-pie").count() === 1, name + ": gráfico de acertos e erros não foi renderizado.");
  check(await page.locator("#profileStatsModes .stats-mode-row").count() >= 4, name + ": comparação por modalidade não foi renderizada.");

  const chartOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    radar: document.querySelector("#profileStatsRadar svg")?.getBoundingClientRect().width || 0,
    radarBox: document.querySelector("#profileStatsRadar")?.getBoundingClientRect().width || 0
  }));
  check(chartOverflow.document <= chartOverflow.viewport + 1, name + ": os gráficos causam rolagem horizontal (" + JSON.stringify(chartOverflow) + ").");
  check(chartOverflow.radar <= chartOverflow.radarBox + 1, name + ": gráfico radar ultrapassa o cartão.");
  await page.screenshot({ path: "artifacts/" + name + "-graficos.png", fullPage: true });

  await page.evaluate(() => {
    document.querySelector("#profileScreen").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
  });
  await page.locator("#openTrainingMode").click();
  check(!(await page.locator("#trainingModePanel").evaluate(el => el.classList.contains("hidden"))), name + ": botão Treinamento não abriu a modalidade.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("TREINAMENTO"), name + ": música não mudou para Treinamento.");
  await page.locator("#backToModeHubTraining").click();
  await page.locator("#openAdventureMode").click();
  check(!(await page.locator("#adventureMapView").evaluate(el => el.classList.contains("hidden"))), name + ": botão Modo Jogo não abriu o mapa da aventura.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("MODO JOGO"), name + ": música não mudou para Modo Jogo.");
  await page.locator("#backToModeHubMap").click();

  await page.locator("#openChallengeMode").click();
  check(!(await page.locator("#challengeModeView").evaluate(el => el.classList.contains("hidden"))), name + ": botão Desafio não abriu a modalidade.");
  check(!(await page.locator("#challengeHomePanel").evaluate(el => el.classList.contains("hidden"))), name + ": menu inicial do Desafio não apareceu.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("DESAFIO"), name + ": música não mudou para Desafio.");
  await page.locator("#backFromChallenge").click();

  await page.locator("#openTournamentMode").click();
  check(!(await page.locator("#tournamentModeView").evaluate(el => el.classList.contains("hidden"))), name + ": botão Torneio não abriu a modalidade.");
  check(!(await page.locator("#tournamentHomePanel").evaluate(el => el.classList.contains("hidden"))), name + ": menu inicial do Torneio não apareceu.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("TORNEIO"), name + ": música não mudou para Torneio.");
  await page.locator("#backFromTournament").click();

  const finalOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth
  }));
  check(finalOverflow.document <= finalOverflow.viewport + 1, name + ": há rolagem horizontal nas modalidades (" + JSON.stringify(finalOverflow) + ").");
  check(pageErrors.length === 0, name + ": erros JavaScript no navegador: " + pageErrors.join(" | "));

  viewportResults.push({ name, viewport, homeOverflow, chartOverflow, finalOverflow, audio });
  await page.close();
}

async function testAutosave(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "pt-BR" });
  const writes = [];
  await page.route("https://projeto-tabuada-api.nuvemx.workers.dev/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "PUT" && pathname === "/api/me") {
      writes.push(JSON.parse(request.postData() || "{}"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sha: "autosave-smoke-new-sha" })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({})
    });
  });

  try {
    await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => {
      const username = "autosave-smoke";
      sessionStorage.setItem(API_TOKEN_KEY, "fake-session-token");
      sessionStorage.setItem(AUTH_SESSION_KEY, username);
      activeProfile = username;
      remoteUserSha = "old-sha";
      remoteUserData = {
        version: 1, username, profile: { studyTimeMs: 0 },
        history: { questions: {}, sessions: [] }, updatedAt: "2026-11-09T12:00:00.000Z"
      };
      profilesData[username] = {
        displayName: "Perfil local preservado",
        checkpoint: { marker: "não perder" },
        studyTimeMs: 0
      };
      historyData = {
        questions: {
          "77x1": { a: 77, b: 1, attempts: 1, correct: 1, wrong: 0, totalTimeMs: 800, bestTimeMs: 800 }
        },
        sessions: [{ answered: 1, hits: 1, misses: 0 }]
      };
      persistProfiles();
      saveHistory();
      pendingActiveMs = 10 * 60 * 1000;
      savePendingActiveTime(username);
      lastActiveTick = Date.now();
    });

    await page.evaluate(() => logout());
    check(writes.length === 0, "O logout salvou os dados antes de completar 30 minutos.");
    const retainedTenMinutes = await page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem(ACTIVE_TIME_CACHE_KEY) || "{}");
      return map["autosave-smoke"] || 0;
    });
    check(retainedTenMinutes >= 10 * 60 * 1000,
      "Os 10 minutos não foram mantidos no aparelho depois de sair.");

    await page.evaluate(async () => {
      const username = "autosave-smoke";
      await hydrateRemoteUser(username, {
        sha: "remote-sha",
        data: {
          profile: { studyTimeMs: 0 },
          history: { questions: {}, sessions: [] },
          economy: {}
        }
      });
    });
    const restored = await page.evaluate(() => ({
      pending: pendingActiveMs,
      checkpoint: profilesData["autosave-smoke"]?.checkpoint?.marker,
      localQuestion: !!historyData.questions["77x1"]
    }));
    check(restored.pending >= 10 * 60 * 1000, "O período anterior não foi somado ao entrar novamente.");
    check(restored.checkpoint === "não perder" && restored.localQuestion,
      "O histórico e o ponto da partida foram substituídos por dados antigos da nuvem.");
    check(writes.length === 0, "O login disparou um salvamento antes dos 30 minutos.");

    await page.evaluate(() => {
      pendingActiveMs += 20 * 60 * 1000;
      profilesData[activeProfile].studyTimeMs = studyTimeBaseMs + pendingActiveMs;
      savePendingActiveTime(activeProfile);
      scheduleCloudSave();
    });
    await page.waitForFunction(() => cloudSyncBusy === false &&
      remoteUserData?.updatedAt !== "2026-11-09T12:00:00.000Z", null, { timeout: 15000 });
    check(writes.length === 1, "O salvamento não ocorreu uma única vez ao completar 30 minutos.");
    check(Number(writes[0].profile?.studyTimeMs) >= 30 * 60 * 1000,
      "O salvamento não incluiu os 10 + 20 minutos acumulados.");
    const lastSavedLabel = (await page.locator("#profileLastSavedAt").textContent()) || "";
    check(lastSavedLabel.startsWith("Último salvamento:"),
      "O perfil não exibiu a data e o horário do último salvamento.");

    return { result: "PASS", minutesAccumulated: 30, writesAfterThreshold: writes.length, lastSavedLabel };
  } finally {
    await page.close();
  }
}

try {
  await testViewport("celular", { width: 390, height: 844 }, true);
  await testViewport("celular-pequeno", { width: 360, height: 800 }, true);
  await testViewport("computador", { width: 1366, height: 900 }, false);
  var autosaveResult = await testAutosave(browser);
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  result: "PASS",
  music: {
    totalTracks: hashes.size,
    uniqueAudioFiles: srcs.size,
    totalMiB: +(totalBytes / 1024 / 1024).toFixed(1),
    categories: musicSummary
  },
  staticChecks: {
    htmlIds: ids.length,
    duplicateIds: duplicates.length,
    checkedJavaScriptSelectors: new Set(selectorRefs).size,
    missingIds: missingIds.length,
    inlineJavaScriptSyntax: "valid",
    autosave: autosaveContract
  },
  autosave: autosaveResult,
  browser: viewportResults
}, null, 2));
