import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";

const ROOT = process.cwd();
const SITE_URL = process.env.SITE_URL || "http://127.0.0.1:4173/";
const fail = (message) => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/music/manifest.json"), "utf8"));
const categories = ["principal", "treinamento", "desafio", "modo-jogo", "torneio"];
check(manifest.version === 4, "Versão inesperada do catálogo musical.");
check(manifest.minimum_tracks_per_category === 20, "Cada área deve ter 20 faixas.");
check(manifest.minimum_total_tracks === 100, "O catálogo deve conter 100 faixas distintas.");
check(manifest.minimum_duration_seconds >= 30, "A duração mínima declarada está abaixo de 30 segundos.");
const hashes = new Set();
const srcs = new Set();
const allIds = new Set();
const musicSummary = {};
let totalBytes = 0;
for (const category of categories) {
  const tracks = manifest.playlists && manifest.playlists[category];
  check(Array.isArray(tracks) && tracks.length === 20, category + ": deveria ter exatamente 20 faixas.");
  for (const track of tracks) {
    check(track.id && !allIds.has(track.id), track.name + ": faixa repetida entre áreas.");
    check(!/(?:climax|variation|alternate|remix|version[\s_-]*2|\bv2\b)/i.test(track.id + " " + track.name),
      track.name + ": versão alternativa não pode contar como música distinta.");
    allIds.add(track.id);
    check(track.duration_seconds >= 30, track.name + ": duração inferior a 30 segundos.");
    check(track.src.startsWith("assets/music/") && track.src.endsWith(".mp3"), track.name + ": caminho de áudio inválido.");
    check(track.license === "CC0 1.0", track.name + ": a licença não é CC0 1.0.");
    check(track.author && track.source && track.source.startsWith("https://opengameart.org/"),
      track.name + ": crédito ou fonte original ausente.");
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
    check(!hashes.has(hash), track.name + ": áudio duplicado.");
    hashes.add(hash);
    totalBytes += bytes.length;
  }
  musicSummary[category] = { tracks: tracks.length, titles: tracks.map(track=>track.name), license: "CC0 1.0" };
}
check(hashes.size === 100 && srcs.size === 100 && allIds.size === 100, "O catálogo não contém 100 faixas distintas.");
check(totalBytes > 10000000, "O tamanho total dos áudios parece inválido.");
const sfxManifest=JSON.parse(fs.readFileSync(path.join(ROOT,"assets/sfx/manifest.json"),"utf8"));
check(sfxManifest.license==="CC0 1.0","Efeitos não estão marcados como CC0.");
const sfxPaths=new Set(),sfxHashes=new Set();
for(const [effect,files] of Object.entries(sfxManifest.effects)){
 check(Array.isArray(files)&&files.length>0,"Efeito sem arquivo: "+effect);
 for(const file of files){
  const record=sfxManifest.files.find(item=>item.src===file);
  check(!!record&&record.license==="CC0 1.0"&&record.creator==="Kenney","Crédito/licença ausente: "+file);
  const isVerifyAlias=effect==="verify"&&file==="assets/sfx/kenney/open_001.ogg";
  if(sfxPaths.has(file))check(isVerifyAlias,"Arquivo de efeito repetido: "+file);
  else sfxPaths.add(file);
  const bytes=fs.readFileSync(path.join(ROOT,file));
  check(bytes.length>1000&&bytes.subarray(0,4).toString("ascii")==="OggS","OGG inválido: "+file);
  const hash=crypto.createHash("sha256").update(bytes).digest("hex");
  if(sfxHashes.has(hash))check(isVerifyAlias,"Áudio de efeito duplicado: "+file);
  else sfxHashes.add(hash);
 }
}
check(sfxManifest.effects.verify?.[0]==="assets/sfx/kenney/open_001.ogg"&&!sfxManifest.effects.click.includes(sfxManifest.effects.verify[0]),"O botão Verificar precisa de um som diferente do clique.");
check(sfxPaths.size===14&&sfxHashes.size===14,"Esperados 14 arquivos OGG originais CC0 distintos.");
check(sfxManifest.effects.click.length===3&&sfxManifest.generated_effects?.click?.length===4,"O clique padrão deve ter três sons originais e quatro variações suaves novas.");

const workerSource = fs.readFileSync(path.join(ROOT, "worker/src/index.js"), "utf8");
check(workerSource.includes("const featuredTitles = Array.isArray(profile.featuredTitles)") &&
  workerSource.includes("selectableTitleIds.has(id)") &&
  workerSource.includes("featuredAwards, featuredTitles"),
  "A API da comunidade não devolve os três títulos públicos escolhidos pelo perfil.");

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
check(html.includes("loadUiSfx();")&&html.includes("playUiSound('key')")&&html.includes("document.addEventListener('click',event=>")&&!html.includes("document.addEventListener('pointerdown',event=>"),"O clique padrão deve tocar somente quando o botão executa a ação.");
check(html.includes("SOFT_UI_CLICK_VARIANTS")&&html.includes("prepareSoftUiClickBuffers()")&&html.includes("const SFX_OUTPUT_BOOST=1.0;"),"As quatro variações suaves ou a redução de ganho dos efeitos estão ausentes.");
check(html.includes('data-sfx="verify"')&&html.includes("button.dataset.sfx||'click'"),"O botão Verificar não usa seu efeito próprio.");
check(html.includes("profileOptionsOpen||")&&html.includes("function showProfileOptions()")&&html.includes("function closeProfileOptions()"),"A música não é pausada e restaurada na tela Opções.");
check(html.includes('id="openProfileStats"')&&html.includes('id="openProfileOptions"')&&html.includes('id="profileOptionsPanel"'),"Os atalhos de Estatísticas e Opções não estão no cartão de perfil.");
check(!html.includes('id="resumeProfile"')&&!html.includes('id="addNumbers"')&&!html.includes('id="toggleProfileStats"'),"Os botões antigos continuam no perfil.");
check(html.includes("SFX_OUTPUT_BOOST")&&html.includes("function previewSfxVolume()"),"O controle e a prévia do volume dos efeitos estão ausentes.");
check(html.includes('id="profileMusicVolume"')&&html.includes("MUSIC_VOLUME_CACHE_KEY")&&html.includes("function restoreProfileMusicVolume()"),"O volume da música não é configurável nem restaurado por conta.");
check(html.includes('id="saveProfileAudioPreferences"')&&html.includes("async function saveProfileAudioPreferences()")&&html.includes("Padrão salvo na sua conta"),"O salvamento do padrão de áudio da conta está ausente.");
check(html.includes("profile.musicVolume=volumeLevel")&&html.includes("profile.sfxVolume=sfxVolumeLevel"),"O salvamento não inclui os dois volumes no perfil remoto.");
check(html.includes("challengeVolumeLimit/100*volumeLevel"),"A música dos desafios não respeita o volume global salvo.");
check(html.includes("uiSfxBuffers.set(src,buffer)")&&html.includes("source.start(audioContext.currentTime+.002)")&&html.includes("createSoftUiClickBuffer(variant)"),
 "Efeitos sonoros não são decodificados e reproduzidos em memória.");
check(html.includes('id="profileSfxVolume"')&&html.includes("SFX_VOLUME_CACHE_KEY"),
 "O perfil não oferece volume independente e persistente para os efeitos.");
check(!html.includes("Biblioteca com 100 trilhas gratuitas")&&!html.includes('class="music-note"'),
 "A descrição longa da biblioteca musical ainda aparece.");
check(html.includes('id="musicMenuToggle" type="button" aria-expanded="false"')&&html.includes('class="music-controls hidden" id="musicControls"')&&html.includes("setMusicMenuExpanded(false)"),
 "O player musical não inicia minimizado ou não volta minimizado ao atualizar a página.");
check(!html.includes("Perfil pronto. Escolha as tabuadas e inicie um novo treino.")&&html.includes("$('profileStatus').textContent='';"),
 "A descrição de perfil pronto ainda aparece para um perfil sem progresso.");
check(html.includes("playUiSound('select')")&&html.includes("playUiSound(value===null?'timeout':'select')"),
 "Sons de seleção e tempo esgotado não estão ligados às respostas.");
check(!html.includes("'<small>@'+escapeHtml(user.username)+'</small>'+")&&html.includes("community-rank-display-title"),
 "A comunidade continua exibindo o @usuário duplicado.");
check(html.includes("community-rank-title-section")&&html.includes("community-rank-titles")&&html.includes("community-challenge-details"),
 "A comunidade não apresenta títulos e desafios na nova posição.");
check(html.includes("featuredTitlesEditor")&&html.includes("profilesData[activeProfile].featuredTitles=selectedTitles")&&html.includes("function renderProfileFeaturedTitlesEditor()"),
 "O perfil não permite escolher e salvar até três títulos públicos.");
check(html.includes("unlockedTitleItems.slice(0,3)")&&html.includes("selectedTitleItems.length")&&html.includes("const achievementBadges=communityTitles.map")&&html.includes("(achievementBadges||"),
 "A comunidade não limita os títulos aos três escolhidos ou aos três primeiros conquistados.");
check(html.includes(".community-profile-details{display:grid!important;grid-template-columns:minmax(0,1fr)!important")&&html.includes(".community-profile-details .community-profile-detail-chips{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important"),
 "O perfil expandido não organiza as seções uma abaixo da outra com os itens em linhas horizontais.");
check(html.includes(".community-rank-public-stats{color:#102b49"),
 "O texto de estatísticas da comunidade continua com contraste baixo.");
check(html.includes('<button id="navCommunity" type="button">🌐 Comunidade</button>'),
 "O ícone anterior da comunidade não foi restaurado.");
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
  await page.waitForFunction(() => uiSfxBuffers.size === 18, null, { timeout: 30000 });
  check(await page.evaluate(() => uiSfxBuffers.size) === 18,
    name + ": os 14 áudios originais e as quatro variações suaves não foram pré-carregados.");
  const clickActionTiming = await page.evaluate(() => {
    const events=[];
    const original=window.playUiSound;
    const musicUnlock=unlockMusic,audioUnlock=unlockUiAudio;
    window.playUiSound=name=>events.push('sound:'+name);
    // Isola este teste dos desbloqueios de música/áudio, sem afetar a
    // verificação do som genérico em fase de propagação.
    document.removeEventListener('click',musicUnlock,true);
    document.removeEventListener('pointerdown',audioUnlock,true);
    const button=document.createElement('button');
    button.type='button';button.textContent='Teste de clique';
    button.addEventListener('click',()=>{events.push('action');button.disabled=true;});
    document.body.appendChild(button);
    let afterPress=[],afterClick=[];
    try{
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
      afterPress=events.slice();
      button.click();
      afterClick=events.slice();
    }finally{
      button.remove();
      window.playUiSound=original;
      document.addEventListener('click',musicUnlock,true);
      document.addEventListener('pointerdown',audioUnlock,true);
    }
    return {afterPress,afterClick};
  });
  check(clickActionTiming.afterPress.length===0,
    name + ": o som tocou no toque/pressionamento antes da execução do botão.");
  check(JSON.stringify(clickActionTiming.afterClick)===JSON.stringify(['action','sound:click']),
    name + ": o som não tocou uma única vez depois da execução da ação do botão ("+JSON.stringify(clickActionTiming)+").");
  await page.waitForFunction(
    () => document.querySelectorAll("#trackSelect option").length === 20,
    null,
    { timeout: 30000 }
  );
  check((await page.locator("#trackSelect").inputValue()) !== "0",
    name + ": a tela inicial repetiu a última faixa salva em vez de escolher outra.");
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
  await page.waitForFunction(() => audioContext && audioContext.state === "running", null, { timeout: 5000 });
  check(await page.locator("#registerForm").isVisible(), name + ": botão Cadastrar não abriu o formulário.");
  await page.locator("#showLogin").click();
  check(!(await page.locator("#loginForm").evaluate(el => el.classList.contains("hidden"))), name + ": botão Voltar ao login não funcionou.");

  const musicMenu = page.locator("#musicMenuToggle");
  check(await musicMenu.getAttribute("aria-expanded") === "false",
    name + ": o player musical não iniciou minimizado.");
  check(await page.locator("#musicControls").evaluate(el => el.classList.contains("hidden")),
    name + ": os controles musicais aparecem abertos na entrada.");
  await musicMenu.click();
  check(await musicMenu.getAttribute("aria-expanded") === "true",
    name + ": o menu musical não expandiu ao tocar nele.");
  check(await page.locator("#musicControls").isVisible(),
    name + ": os controles não apareceram após expandir.");
  await page.reload({waitUntil:"domcontentloaded",timeout:60000});
  await page.locator("#authScreen").waitFor({state:"visible",timeout:20000});
  await page.waitForFunction(() => document.querySelectorAll("#trackSelect option").length === 20,null,{timeout:30000});
  check(await page.locator("#musicMenuToggle").getAttribute("aria-expanded") === "false",
    name + ": após atualizar a página, o player musical não voltou minimizado.");
  check(await page.locator("#musicControls").evaluate(el => el.classList.contains("hidden")),
    name + ": após atualizar, os controles musicais continuam abertos.");
  await page.locator("#musicMenuToggle").click();
  check(await page.locator("#musicControls").isVisible(),
    name + ": o player não voltou a expandir após a atualização.");

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
    const categorySources = await page.evaluate(value => {
      setMusicCategory(value, true, true);
      return musicTrackCollections[value].map(track => track.src);
    }, category);
    check(categorySources.length === 20, name + ": a coleção " + category + " não apresenta quatro opções.");
    check(await page.locator("#trackSelect option").count() === 20, name + ": o seletor " + category + " não apresenta quatro faixas.");
    await page.waitForFunction(
      sources => {
        const src = document.querySelector("#soundtrackAudio").src;
        return sources.some(source => src.includes("/" + source));
      },
      categorySources,
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
    activeProfile = "perfil-smoke";
    profilesData[activeProfile] = { displayName: "Perfil de teste", sfxVolume: 0.82, featuredTitles: [] };
    document.querySelector("#authScreen").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
    refreshProfileIdentity();
  });
  await page.locator("#openProfileStats").click();
  check(!(await page.locator("#profileStatsPanel").evaluate(el => el.classList.contains("hidden"))), name + ": o botão Minhas estatísticas não abriu os gráficos.");
  check(await page.locator("#profileMainPanel").evaluate(el => el.classList.contains("hidden")), name + ": a tela principal do perfil não foi substituída pelas estatísticas.");
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
  await page.locator("#closeProfileStats").click();
  check(!(await page.locator("#profileMainPanel").evaluate(el => el.classList.contains("hidden"))), name + ": voltar das estatísticas não restaurou o perfil.");
  await page.evaluate(()=>{
    gameEconomy.achievements={training_first:true,training_5:true,training_25:true,adventure_first:true};
    profilesData[activeProfile].featuredTitles=[];
    renderProfileFeaturedTitlesEditor();
  });
  check(await page.locator("#featuredTitlesEditor input[name='featuredTitle']").count()===4,
    name+": o perfil não listou os quatro títulos desbloqueados para escolha.");
  check(await page.locator("#profileFeaturedTitlesDisplay .profile-featured-title-chip").count()===3,
    name+": a prévia automática não mostrou três títulos quando nenhum foi escolhido.");
  await page.locator("#featuredTitlesEditor input[name='featuredTitle']").nth(0).check();
  await page.locator("#featuredTitlesEditor input[name='featuredTitle']").nth(1).check();
  await page.locator("#featuredTitlesEditor input[name='featuredTitle']").nth(2).check();
  await page.locator("#featuredTitlesEditor input[name='featuredTitle']").nth(3).click();
  check(await page.locator("#featuredTitlesEditor input[name='featuredTitle']:checked").count()===3,
    name+": o editor permitiu selecionar mais de três títulos.");
  check(await page.locator("#profileFeaturedTitlesDisplay .profile-featured-title-chip").count()===3,
    name+": a prévia não destacou os três títulos selecionados.");
  await page.locator("#featuredTitlesEditor input[name='featuredTitle']:checked").evaluateAll(items=>items.forEach(item=>{item.checked=false;item.dispatchEvent(new Event("change",{bubbles:true}));}));
  check(await page.locator("#profileFeaturedTitlesDisplay .profile-featured-title-chip").count()===3,
    name+": ao limpar as escolhas, a prévia não voltou aos três títulos automáticos.");
  await page.locator("#backFromProfile").click();

  const musicWasPlayingBeforeOptions = await page.evaluate(() => !!(soundOn && soundtrackAudio && !soundtrackAudio.paused));
  await page.locator("#openProfileOptions").click();
  check(!(await page.locator("#profileOptionsPanel").evaluate(el => el.classList.contains("hidden"))), name + ": a tela Opções não abriu.");
  check(await page.locator("#siteMusicBox").evaluate(el => el.classList.contains("hidden")), name + ": o player musical ficou visível em Opções.");
  check(await page.locator("#soundtrackAudio").evaluate(el => el.paused), name + ": a música não pausou ao abrir Opções.");
  check(await page.locator("#profileSfxVolume").isVisible(), name + ": o controle de efeitos não aparece.");
  check(await page.locator("#profileMusicVolume").isVisible(), name + ": o controle de música não aparece.");
  await page.evaluate(() => {
    window.__previewCalls=0;window.__audioPreferenceWrites=0;window.__audioPreferencePayload=null;
    window.cloudTokenReady=()=>true;
    window.writeRemoteUser=async(username,payload)=>{
      window.__audioPreferenceWrites++;
      window.__audioPreferencePayload=JSON.parse(JSON.stringify(payload));
      return "smoke-audio-sha";
    };
    remoteUserData={version:1,username:activeProfile,profile:{},history:{questions:{},sessions:[]}};
    remoteUserSha="smoke-audio-sha";
    window.__originalPlayUiSound=window.playUiSound;
    window.playUiSound=function(name){if(name==="click")window.__previewCalls++;return window.__originalPlayUiSound(name);};
  });
  await page.locator("#profileSfxVolume").evaluate(element=>{element.value="55";element.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.locator("#profileMusicVolume").evaluate(element=>{element.value="43";element.dispatchEvent(new Event("input",{bubbles:true}));});
  check((await page.locator("#profileSfxVolumeValue").textContent()).trim()==="55%",name+": o volume dos efeitos não atualizou.");
  check((await page.locator("#profileMusicVolumeValue").textContent()).trim()==="43%",name+": o volume da música não atualizou.");
  check((await page.locator("#volumeValue").textContent()).trim()==="43%",name+": o volume musical geral não sincronizou.");
  check(await page.evaluate(()=>Math.abs(sfxVolumeLevel-.55)<.01),name+": o volume dos efeitos não foi aplicado.");
  check(await page.evaluate(()=>Math.abs(volumeLevel-.43)<.01),name+": o volume da música não foi aplicado.");
  await page.waitForFunction(()=>uiSfxGain&&Math.abs(uiSfxGain.gain.value-.55)<.02,null,{timeout:3000});
  await page.waitForFunction(()=>window.__previewCalls>0,null,{timeout:3000});
  await page.locator("#saveProfileAudioPreferences").click();
  await page.waitForFunction(()=>window.__audioPreferenceWrites===1,null,{timeout:5000});
  const savedAudioProfile=await page.evaluate(()=>({
    sfx:profilesData[activeProfile]?.sfxVolume,music:profilesData[activeProfile]?.musicVolume,
    remoteSfx:window.__audioPreferencePayload?.profile?.sfxVolume,
    remoteMusic:window.__audioPreferencePayload?.profile?.musicVolume
  }));
  check(Math.abs(savedAudioProfile.sfx-.55)<.01&&Math.abs(savedAudioProfile.music-.43)<.01,name+": volumes não foram salvos no perfil local.");
  check(Math.abs(savedAudioProfile.remoteSfx-.55)<.01&&Math.abs(savedAudioProfile.remoteMusic-.43)<.01,name+": volumes não foram enviados à nuvem.");
  check((await page.locator("#profileAudioSaveStatus").textContent()).includes("Padrão salvo na sua conta"),name+": confirmação do salvamento não apareceu.");
  await page.locator("#closeProfileOptions").click();
  check(await page.locator("#profileOptionsPanel").evaluate(el=>el.classList.contains("hidden")),name+": fechar Opções falhou.");
  if(musicWasPlayingBeforeOptions)await page.waitForFunction(()=>!document.querySelector("#soundtrackAudio").paused,null,{timeout:5000});
  await page.evaluate(()=>{
    setVolume(100);
    sfxVolumeLevel=.82;
    restoreProfileSfxVolume();
    restoreProfileMusicVolume();
  });
  check((await page.locator("#globalVolume").inputValue())==="43",name+": o volume da música salvo não foi restaurado no retorno à conta.");
  check(await page.evaluate(()=>Math.abs(sfxVolumeLevel-.55)<.01),name+": o volume de efeitos salvo não foi restaurado no retorno à conta.");

  await page.evaluate(async () => {
    document.querySelector("#profileScreen").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
    communityCache = [{
      username: "maria_27", displayName: "Maria Silva",
      profile: { displayName: "Maria Silva", avatar: "imagem:0" },
      featuredTitles: ["adventure_5","adventure_first"],
      history: { questions: {}, sessions: [] },
      correct: 120, wrong: 5, timeMs: 123456,
      coins: 130, totalEarned: 250, challengeTotal: 2,
      challengeWins: 1, challengeLosses: 1, challengeDraws: 0,
      titles: ["Primeiro Ciclo","Explorador","Disciplina","A Jornada Começa"], medals: [], awards: [], featuredAwards: [],
      achievements: { training_first: true }, economy: { coins: 130, achievements: { training_first: true } }
    }];
    communityCacheAt = Date.now();
    communityPage = 0;
    await renderCommunityRanking();
  });
  const communityIdentity = page.locator(".community-rank-identity").first();
  check(!(await communityIdentity.textContent()).includes("@maria_27"),
    name + ": a comunidade ainda exibe o @usuário duplicado.");
  const selectedCommunityTitles = await page.locator(".community-rank-title-section .community-rank-title-chip").allTextContents();
  check(selectedCommunityTitles.length===2&&selectedCommunityTitles.some(value=>value.includes("Explorador"))&&selectedCommunityTitles.some(value=>value.includes("A Jornada Começa")),
    name + ": a comunidade não exibiu somente os títulos selecionados pelo dono do perfil.");
  const publicOrder = await page.locator(".community-rank-summary").first().evaluate(element=>{
    const stats=element.querySelector(".community-rank-public-stats");
    const titles=element.querySelector(".community-rank-title-section");
    return !!stats&&!!titles&&(stats.compareDocumentPosition(titles)&Node.DOCUMENT_POSITION_FOLLOWING)!==0;
  });
  check(publicOrder,name+": acertos, erros e tempo não aparecem antes dos títulos.");
  await page.evaluate(async()=>{
    communityCache[0].profile.featuredTitles=[];
    await renderCommunityRanking();
  });
  const automaticTitles=await page.locator(".community-rank-title-chip").allTextContents();
  check(automaticTitles.length===3&&automaticTitles.some(value=>value.includes("Primeiro Ciclo"))&&automaticTitles.some(value=>value.includes("Explorador"))&&automaticTitles.some(value=>value.includes("Disciplina"))&&!automaticTitles.some(value=>value.includes("A Jornada Começa")),
    name+": sem escolhas, a comunidade não mostrou exatamente os três primeiros títulos conquistados.");
  const communityGridColumns=await page.locator(".community-profile-details").first().evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(" ").length);
  check(communityGridColumns===1,name+": as seções do perfil público não estão organizadas uma abaixo da outra ("+communityGridColumns+").");
  const communityStatsColor = await page.locator(".community-rank-public-stats").first().evaluate(element => getComputedStyle(element).color);
  check(communityStatsColor === "rgb(16, 43, 73)",
    name + ": estatísticas da comunidade continuam com pouco contraste (" + communityStatsColor + ").");
  await page.locator(".community-rank-card").first().evaluate(element=>{element.open=true;});
  const challengePosition = await page.locator(".community-profile-details").first().evaluate(element => {
    const challenge = element.querySelector(".community-challenge-details");
    const metrics = element.querySelector(".community-profile-detail-grid");
    return !!challenge && !!metrics && element.firstElementChild === challenge &&
      (challenge.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  check(challengePosition, name + ": os desafios não aparecem logo abaixo das estatísticas ao expandir o perfil.");
  await page.screenshot({ path: "artifacts/" + name + "-comunidade.png", fullPage: true });

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
    await page.evaluate(() => {
      sessionStorage.setItem(API_TOKEN_KEY, "fake-session-token");
      sessionStorage.setItem(AUTH_SESSION_KEY, "autosave-smoke");
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
