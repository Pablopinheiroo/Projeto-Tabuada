import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
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
check(workerSource.includes("invalidateCommunitySummaryCache()")&&
  workerSource.includes("generation !== communitySummaryCache.generation")&&
  workerSource.includes("updatedAt: record.updatedAt || profile.updatedAt || null"),
  "O cache público da comunidade não é invalidado ou marcado com a versão dos dados.");
check(workerSource.includes("mergeHistorySnapshots(")&&workerSource.includes("body.baseSha"),
  "A API não protege o histórico contra snapshots antigos.");
const workerTestSource=workerSource.replace("export default {","globalThis.__workerDefault = {");
const workerContext={Date,Set,Map,Object,Array,Number,String,Math,RegExp,JSON,TextEncoder,TextDecoder,Uint8Array,Response,Headers,URL};
vm.runInNewContext(workerTestSource+"\nglobalThis.__mergeHistorySnapshots=mergeHistorySnapshots;globalThis.__normalizeGameEconomy=normalizeGameEconomy;",workerContext);
const normalizedEconomy=workerContext.__normalizeGameEconomy({
  profile:{avatar:"imagem:0"},
  economy:{coins:15,totalEarned:20,trainingQuestionProgress:8,trainingQuestionClaimIds:["claim-1"]}
});
check(normalizedEconomy.trainingQuestionProgress===8&&normalizedEconomy.trainingQuestionClaimIds.includes("claim-1"),
  "A economia do usuário não preserva as questões pendentes para a próxima recompensa de treinamento.");
const trainingRewardBranch=workerSource.slice(
  workerSource.indexOf('if (body.type === "training_cycle")'),
  workerSource.indexOf('} else if (body.type === "adventure_stage")')
);
check(trainingRewardBranch.includes('body.type === "training_questions"')&&
  trainingRewardBranch.includes("economy.trainingQuestionProgress + questionCount")&&
  trainingRewardBranch.includes("coinsAdded = earnedBatches * 5")&&
  trainingRewardBranch.includes("trainingQuestionClaimIds.includes(claimId)"),
  "A API não soma as questões entre sessões e libera 5 moedas a cada 10 questões.");
const cycleRewardBranch=trainingRewardBranch.slice(0,trainingRewardBranch.indexOf('} else if (body.type === "training_questions")'));
check(!cycleRewardBranch.includes("economy.coins +=")&&!cycleRewardBranch.includes("economy.totalEarned +="),
  "O treinamento ainda concede moedas somente por completar o ciclo.");
const olderHistory={questions:{"2x3":{a:2,b:3,attempts:7,correct:5,wrong:2,totalTimeMs:7000,lastAt:"2026-11-08T10:00:00Z"},"4x5":{a:4,b:5,attempts:2,correct:2,wrong:0,totalTimeMs:1500}},sessions:[{date:"2026-11-08T10:00:00Z",mode:"training",answered:7,hits:5,misses:2,timeMs:7000}]};
const newerHistory={questions:{"2x3":{a:2,b:3,attempts:12,correct:9,wrong:3,totalTimeMs:12000,lastAt:"2026-11-09T10:00:00Z"},"6x7":{a:6,b:7,attempts:3,correct:3,wrong:0,totalTimeMs:2500}},sessions:[{date:"2026-11-09T10:00:00Z",mode:"training",answered:12,hits:9,misses:3,timeMs:12000}]};
const mergedHistory=workerContext.__mergeHistorySnapshots(newerHistory,olderHistory);
check(mergedHistory.questions["2x3"].attempts===12&&mergedHistory.questions["4x5"].attempts===2&&mergedHistory.questions["6x7"].attempts===3,
  "A ponderação de histórico permitiu que um snapshot antigo reduzisse o progresso mais novo.");
check(mergedHistory.sessions.length===2,
  "A união dos históricos não preservou as sessões distintas.");
const tiedHistory=workerContext.__mergeHistorySnapshots(
  {questions:{"9x9":{a:9,b:9,attempts:5,correct:4,wrong:1,totalTimeMs:5000,lastAt:"2026-11-09T10:00:00Z"}},sessions:[]},
  {questions:{"9x9":{a:9,b:9,attempts:5,correct:3,wrong:2,totalTimeMs:6000,lastAt:"2026-11-10T10:00:00Z"}},sessions:[]}
);
check(tiedHistory.questions["9x9"].correct===4&&tiedHistory.questions["9x9"].wrong===1,
  "Um snapshot antigo, com a mesma quantidade de tentativas, substituiu o registro atual.");

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
check(html.includes("function showProfileOptions()")&&html.includes("function closeProfileOptions()")&&
  html.includes("stopOptionMusicPreview();")&&html.includes("profileOptionsOpen&&!optionPreview")&&
  html.includes("function previewMusicVolume()")&&html.includes("setTimeout(stopOptionMusicPreview,1200)"),
 "A música geral deve ficar pausada em Opções e somente as prévias das barras devem tocar.");
check(html.includes("$('openProfile').addEventListener('click',()=>openProfileScreen());")&&
  html.includes("$('navProfile').addEventListener('click',()=>openProfileScreen());"),
 "Os atalhos do perfil não podem confundir o evento de clique com a opção de abrir Estatísticas.");
check(html.includes('id="openProfileStats"')&&html.includes('id="openProfileOptions"')&&html.includes('id="profileOptionsPanel"'),"Os atalhos de Estatísticas e Opções não estão no cartão de perfil.");
check(!html.includes('id="resumeProfile"')&&!html.includes('id="addNumbers"')&&!html.includes('id="toggleProfileStats"'),"Os botões antigos continuam no perfil.");
check(html.includes("SFX_OUTPUT_BOOST")&&html.includes("function previewSfxVolume()"),"O controle e a prévia do volume dos efeitos estão ausentes.");
check(html.includes('id="profileMusicVolume"')&&html.includes("MUSIC_VOLUME_CACHE_KEY")&&html.includes("function restoreProfileMusicVolume()")&&html.includes('id="resetProfileMusicVolume"'),
 "O volume da música não é configurável nem restaurável.");
check(html.includes("function resetProfileMusicVolume()")&&html.includes("function syncAudioResetButtons()"),
 "O reset da música ou o ocultamento automático dos botões de reset está ausente.");
check(html.includes('id="saveProfileAudioPreferences"')&&html.includes("💾 Salvar como preferência da conta")&&html.includes("async function saveProfileAudioPreferences()")&&html.includes("Padrão salvo na sua conta"),"O salvamento como preferência da conta está ausente.");
check(html.includes("profile.musicVolume=volumeLevel")&&html.includes("profile.sfxVolume=sfxVolumeLevel"),"O salvamento não inclui os dois volumes no perfil remoto.");
check(html.includes("challengeVolumeLimit/100*volumeLevel"),"A música dos desafios não respeita o volume global salvo.");
check(html.includes("uiSfxBuffers.set(src,buffer)")&&html.includes("source.start(audioContext.currentTime+.002)")&&html.includes("createSoftUiClickBuffer(variant)"),
 "Efeitos sonoros não são decodificados e reproduzidos em memória.");
check(html.includes('id="profileSfxVolume"')&&html.includes("SFX_VOLUME_CACHE_KEY"),
 "O perfil não oferece volume independente e persistente para os efeitos da interface.");
check(html.includes('id="profileGameSfxVolume"')&&html.includes("GAME_SFX_VOLUME_CACHE_KEY")&&html.includes("function restoreProfileGameSfxVolume()")&&html.includes("gameSfxVolumeLevel=.04"),
 "O volume separado do modo jogo não está configurado com 4% por padrão.");
check(html.includes("function previewGameSfxVolume()")&&html.includes("playUiSound(name,'game',true)")&&html.includes("function resetProfileGameSfxVolume()"),
 "A prévia ou a redefinição do volume do modo jogo está ausente.");
check(html.includes("playFeedback(!!entry.correct,entry.mode==='training'?'game':'interface')")&&html.includes("playUiSound('verify','game')")&&html.includes("playUiSound('click','game')"),
 "Os efeitos de Verificar, Acertei, Errei e Tive dificuldade não estão ligados ao canal do modo jogo.");
check(html.includes("profile.gameSfxVolume=gameSfxVolumeLevel"),
 "O volume do modo jogo não é salvo no perfil e na nuvem.");
check(html.includes("A música geral fica pausada nesta tela")&&html.includes("breve prévia da trilha")&&
  html.includes("som de clique é reproduzido como prévia"),
 "A tela Opções não explica que a música geral fica pausada e que cada barra reproduz sua própria prévia.");
check(html.includes("function closeProfileOptions()")&&html.includes("closeProfileScreen();")&&html.includes("function closeProfileStats(){\n closeProfileScreen();"),
 "Os botões de retorno de Opções e Estatísticas não levam ao menu principal.");
check(!html.includes("Biblioteca com 100 trilhas gratuitas")&&!html.includes('class="music-note"'),
 "A descrição longa da biblioteca musical ainda aparece.");
check(html.includes('id="musicMenuToggle" type="button" aria-expanded="false"')&&html.includes('class="music-controls hidden" id="musicControls"')&&html.includes("setMusicMenuExpanded(false)"),
 "O player musical não inicia minimizado ou não volta minimizado ao atualizar a página.");
check(html.includes('id="badgeInfoPopover"')&&html.includes("function openBadgeInfoPopover(trigger)")&&html.includes("function closeBadgeInfoPopover(restoreFocus=true)")&&html.includes("data-badge-info-trigger")&&html.includes("data-badge-info-close"),
 "O balão de informações de conquistas e títulos ou seus controles de fechamento estão ausentes.");
check(html.includes(".wallet-inline>span:first-child{display:inline-flex;align-items:center")&&html.includes(".community-coins-metric strong{display:flex;align-items:center"),
 "O alinhamento vertical das moedas no perfil ou na comunidade está ausente.");
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
check(html.includes("function formatCommunityDisplayName(value)")&&html.includes("displayName:formatCommunityDisplayName("),
 "O nome público da comunidade não recebe a formatação em título.");
check(html.includes("field.matches('#loginUsername,#registerUsername')"),
 "A digitação no campo de usuário ainda recebe um efeito sonoro extra do jogo.");
check(html.indexOf('<button id="right"')<html.indexOf('<button id="wrong"')&&
  html.indexOf('<button id="wrong"')<html.indexOf('<button id="markDifficulty"'),
 "Os botões de treinamento não estão na ordem Acertei, Errei e Tive dificuldade.");
check(html.includes('<button id="navShop" type="button">🛒 Loja</button>')&&
  html.includes('id="shopTitle">🛒 Loja de avatares</h2>')&&!html.includes("🛍️"),
 "O ícone da Loja não usa o cesto de compras.");
check(html.includes("const isProfile=containerId==='profileAvatarGrid';")&&html.includes(".filter(item=>!isProfile||item.isOwned)")&&html.includes("function renderAvatarShop()")&&html.includes("/api/game/shop"),
 "O perfil não está limitado aos avatares adquiridos ou a Loja perdeu a compra com moedas.");
check(html.includes("Comprar · '+price.toLocaleString('pt-BR')+' moedas")&&!html.includes("Loja de avatares <small class=\"shop-rules\""),
 "Os avatares bloqueados continuam aparecendo no editor do perfil em vez de ficarem na Loja.");
check(html.includes('id="communitySection"')&&html.includes("function setMainContentSections(")&&
  html.includes("function showCommunityOnly()")&&html.includes("function showShopOnly()"),
 "O menu não controla a exibição exclusiva das seções Loja, Comunidade e modalidades.");
check(html.includes("function pauseTrainingQuestionClock()")&&html.includes("function resumeTrainingQuestionClock()")&&
  html.includes("pauseTrainingQuestionClock();")&&html.includes("questionClockPaused?0:performance.now()")&&
  html.includes("data-dismiss-celebration")&&!html.includes("setTimeout(()=>overlay.remove(),5200)"),
 "A tela de parabéns precisa pausar o cronômetro até ser fechada, sem desaparecer sozinha.");
check(html.includes("deck.push({a:current.a,b:current.b});")&&
  html.includes("sessionSkipped++;")&&html.includes("position++;")&&html.includes("next();saveCheckpoint();"),
 "Marcar Tive dificuldade deve avançar e colocar a mesma conta novamente no ciclo.");
check(html.includes("function showAchievementCongratulations(ids,extra='')")&&
  html.includes("🎉 Parabéns! Você conquistou:")&&html.includes("achievement-congrats")&&
  html.includes("showAchievementCongratulations(result.newAchievements"),
 "O alerta de parabéns por novas conquistas está ausente.");
check(!html.includes('id="shopBackToGame"')&&!html.includes("$('shopBackToGame').addEventListener")&&
  html.includes("topReturn.classList.toggle('hidden',shop)"),
 "A Loja ainda possui mais de uma opção de Voltar ao jogo.");
check(html.includes("async function saveProgressNow(")&&!html.includes("ACTIVE_TIME_SYNC_MS")&&
  !html.includes("scheduleCloudSave")&&!html.includes("Próximo salvamento automático"),
  "O salvamento automático por tempo deve estar removido e o salvamento deve ser explícito.");
check(logoutCode.length>0&&logoutCode.includes("flushCloudSave(true)")&&logoutCode.includes("retryPendingGameRewards()"),
  "Sair da conta não tenta concluir os salvamentos/recompensas pendentes.");
check(html.includes("pendingActiveMs>0?loadHistory():remoteHistory"), "O login não preserva o histórico local que ainda não foi sincronizado.");
check(html.includes("Último salvamento: "), "O perfil não mostra o rótulo do último salvamento.");
check(html.includes("sessionCompletedQuestionCount++")&&html.includes("claimGameReward('training_questions'")&&
  html.includes("completedQuestions:sessionCompletedQuestionCount"),
  "O treino não conta as questões concluídas ou não solicita a recompensa a cada 10 questões.");
check(html.includes("function exitAdventureStageAndSave()")&&html.includes("function exitChallengeMatchAndSave()")&&
  html.includes("function exitTournamentMatchAndSave()")&&html.includes("await saveProgressNow('Treinamento')")&&
  html.includes("await saveProgressNow('Desafio')")&&html.includes("await saveProgressNow('Torneio')"),
  "Um dos modos de jogo não salva o histórico ao sair da partida.");
check(html.includes("await saveProgressNow('Perfil')")&&html.includes("await saveProgressNow('Alteração de senha')")&&
  html.includes("await saveProgressNow('Preferências de áudio')"),
  "As modificações do perfil, senha ou opções não executam salvamento explícito.");
const explicitSaveContract = {
  timedAutosaveRemoved: true,
  saveTrainingOnExit: true,
  saveAdventureOnExit: true,
  saveChallengeOnExit: true,
  saveTournamentOnExit: true,
  saveProfilePasswordAndOptionsOnSave: true,
  trainingCoinsPerTenQuestions: 5
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
  const typingSoundCalls=await page.evaluate(()=>{
    const calls=[],original=window.playUiSound;
    window.playUiSound=(...args)=>calls.push(args);
    const login=document.querySelector("#loginUsername");
    login.dispatchEvent(new KeyboardEvent("keydown",{key:"j",bubbles:true}));
    const regular=document.createElement("input");
    regular.id="smokeRegularTextInput";
    document.body.appendChild(regular);
    regular.dispatchEvent(new KeyboardEvent("keydown",{key:"j",bubbles:true}));
    regular.remove();
    window.playUiSound=original;
    return calls.map(args=>args[0]);
  });
  check(JSON.stringify(typingSoundCalls)===JSON.stringify(["key"]),
    name+": o campo de login reproduziu um som extra durante a digitação ("+JSON.stringify(typingSoundCalls)+").");
  const feedbackOrder=await page.locator("#judge button").evaluateAll(items=>items.map(item=>item.id));
  check(JSON.stringify(feedbackOrder)===JSON.stringify(["right","wrong","markDifficulty"]),
    name+": os botões de resposta estão fora da ordem solicitada ("+JSON.stringify(feedbackOrder)+").");
  const formattedNames=await page.evaluate(()=>["jonas","jonas ribeiro","  JONAS   RIBEIRO  ","ana-maria"].map(formatCommunityDisplayName));
  check(JSON.stringify(formattedNames)===JSON.stringify(["Jonas","Jonas Ribeiro","Jonas Ribeiro","Ana-Maria"]),
    name+": a capitalização do nome na comunidade está incorreta ("+JSON.stringify(formattedNames)+").");
  check((await page.locator("#navShop").textContent()).includes("🛒")&&
    (await page.locator("#shopTitle").textContent()).includes("🛒"),
    name+": o ícone de cesto de compras não aparece no atalho e no título da Loja.");
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
    profilesData[activeProfile] = { displayName: "Perfil de teste", featuredTitles: [] };
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
  check((await page.locator("#closeProfileStats").textContent()).includes("Voltar ao jogo"),
     name + ": o botão das estatísticas não indica retorno à página inicial do jogo.");
  await page.locator("#closeProfileStats").click();
  check(!(await page.locator("#setup").evaluate(el => el.classList.contains("hidden"))) &&
    await page.locator("#profileScreen").evaluate(el => el.classList.contains("hidden")),
    name + ": voltar das estatísticas não retornou ao menu principal.");
  await page.locator("#openProfile").click();
  check(await page.locator("#backFromProfileTop").isVisible(),name+": o botão Voltar ao jogo não aparece no início de Meu perfil.");
  const profileTopOrder=await page.evaluate(()=>({button:document.querySelector("#backFromProfileTop").getBoundingClientRect().top,title:document.querySelector("#profileMainPanel h2").getBoundingClientRect().top}));
  check(profileTopOrder.button<profileTopOrder.title,name+": o botão Voltar ao jogo não está acima do título Meu perfil.");
  await page.locator("#backFromProfileTop").click();
  check(await page.locator("#profileScreen").evaluate(el=>el.classList.contains("hidden"))&&!(await page.locator("#setup").evaluate(el=>el.classList.contains("hidden"))),name+": o botão superior não retornou ao jogo.");
  await page.locator("#openProfile").click();
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
    gameEconomy={version:1,coins:2400,totalEarned:3000,trainingCycles:30,completedStages:[],perfectStages:[],comboStages:[],trainingClaimIds:[],ownedAvatars:['imagem:0','imagem:1','gif:2'],achievements:{}};
    selectedProfileAvatar='imagem:0';
    renderAvatarGrid('profileAvatarGrid',selectedProfileAvatar,key=>{selectedProfileAvatar=key;});
    renderAvatarShop();
  });
  check(await page.locator("#profileAvatarGrid .avatar-choice").count()===3,
    name+": Meu perfil não mostra somente os três avatares que já pertencem à conta.");
  check(await page.locator("#profileAvatarGrid .avatar-choice.locked").count()===0&&
    await page.locator("#profileAvatarGrid [data-avatar-buy]").count()===0,
    name+": ainda há avatares bloqueados ou para comprar dentro de Meu perfil.");
  check(await page.locator("#avatarShopGrid .shop-avatar-card").count()===23,
    name+": a Loja não listou os 23 avatares que antes ficavam bloqueados.");
  check(await page.locator("#avatarShopGrid .shop-avatar-card.locked").count()===0&&
    await page.locator("#avatarShopGrid [data-avatar-buy]").count()===21&&
    await page.locator("#avatarShopGrid .shop-avatar-card.owned").count()===2,
    name+": a Loja não separou corretamente itens adquiridos e itens à venda.");
  check((await page.locator("#shopCoins").textContent()).trim()==="2.400",
    name+": o saldo de moedas não apareceu na Loja.");
  await page.evaluate(async()=>{
    const original=window.apiRequest;
    window.__shopRequest=null;
    window.apiRequest=async(path,options)=>{
      if(path!=="/api/game/shop")throw new Error("Rota inesperada: "+path);
      window.__shopRequest={path,method:options.method,body:options.body};
      return {economy:{...gameEconomy,coins:gameEconomy.coins-100,ownedAvatars:[...gameEconomy.ownedAvatars,"imagem:2"]},sha:"shop-smoke-sha",newAchievements:[]};
    };
    try{await purchaseAvatar("imagem:2");}finally{window.apiRequest=original;}
  });
  const shopPurchase=await page.evaluate(()=>window.__shopRequest);
  check(shopPurchase?.path==="/api/game/shop"&&shopPurchase?.method==="POST"&&shopPurchase?.body?.avatarKey==="imagem:2",
    name+": a compra não foi enviada ao servidor pela rota oficial da Loja.");
  check(await page.locator("#profileAvatarGrid .avatar-choice").count()===4&&
    await page.locator("#avatarShopGrid .shop-avatar-card.owned").count()===3&&
    (await page.locator("#shopCoins").textContent()).trim()==="2.300",
    name+": o avatar comprado não passou para a coleção e o saldo não foi atualizado.");
  await page.evaluate(()=>{
    document.querySelector("#profileScreen").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
  });
  await page.locator("#navShop").click();
  check(!(await page.locator("#shopScreen").evaluate(el=>el.classList.contains("hidden"))),
    name+": o botão Loja não abriu a nova seção.");
  await page.locator("#navCommunity").click();
  check(await page.locator("#shopScreen").evaluate(el=>el.classList.contains("hidden")),
    name+": ao voltar para Comunidade, a seção Loja não foi ocultada.");
  await page.locator("#openProfile").click();
  const profileReturnState=await page.evaluate(()=>({
    gameHidden:document.querySelector("#game").classList.contains("hidden"),
    setupHidden:document.querySelector("#setup").classList.contains("hidden"),
    profileScreenHidden:document.querySelector("#profileScreen").classList.contains("hidden"),
    profileMainHidden:document.querySelector("#profileMainPanel").classList.contains("hidden"),
    activeProfile,
    profileStatus:document.querySelector("#profileStatus")?.textContent
  }));
  check(!profileReturnState.profileScreenHidden&&!profileReturnState.profileMainHidden,
    name+": o perfil não abriu novamente após retornar ao menu: "+JSON.stringify(profileReturnState));
  await page.evaluate(()=>{
    gameEconomy.achievements={training_first:new Date("2026-11-08T10:00:00.000Z").toISOString(),training_5:true,training_25:true,adventure_first:true};
    profilesData[activeProfile].featuredTitles=[];
    profilesData[activeProfile].featuredAwards=["achievement:training_first","medal:recruta","award:2026-10"];
    profilesData[activeProfile].challengeStats={total:{wins:12},levels:{recruta:{wins:12}}};
    profilesData[activeProfile].tournamentAwards={"2026-10":{rank:2,score:42,difficulty:"Fácil",frame:"Prata"}};
    renderAchievementShelf();
    renderChallengeProfileStats();
    renderFeaturedAwardsEditor();
    renderProfileFeaturedTitlesEditor();
  });
  check(await page.locator("#featuredTitlesEditor input[name='featuredTitle']").count()===4,
    name+": o perfil não listou os quatro títulos desbloqueados para escolha.");
  check(await page.locator("#profileFeaturedTitlesDisplay .profile-featured-title-chip").count()===3,
    name+": a prévia automática não mostrou três títulos quando nenhum foi escolhido.");
  await page.locator("#achievementShelf .achievement-card.unlocked").first().click();
  check(await page.locator("#badgeInfoPopover").isVisible()&&
    (await page.locator("#badgeInfoPopoverTitle").textContent()).includes("Primeiro Ciclo")&&
    (await page.locator("#badgeInfoPopoverText").textContent()).includes("Conclua seu primeiro ciclo"),
    name+": clicar em uma conquista do Meu perfil não mostrou a descrição de aquisição.");
  await page.locator("#badgeInfoPopoverClose").click();
  check(await page.locator("#badgeInfoPopover").evaluate(el=>el.classList.contains("hidden")),
    name+": o botão X não fechou o balão de conquista.");
  await page.locator("#profileFeaturedTitlesDisplay .profile-featured-title-chip").first().click();
  check(await page.locator("#badgeInfoPopover").isVisible()&&
    (await page.locator("#badgeInfoPopoverText").textContent()).includes("Conclua seu primeiro ciclo"),
    name+": clicar em um título de Meu perfil não mostrou como foi adquirido.");
  await page.locator("body").evaluate(el=>el.click());
  check(await page.locator("#badgeInfoPopover").evaluate(el=>el.classList.contains("hidden")),
    name+": clicar fora do balão não o fechou.");
  await page.locator("#challengeMedalShelf .achievement-card.unlocked").first().click();
  check((await page.locator("#badgeInfoPopoverText").textContent()).includes("10 desafios no nível Recruta"),
    name+": a medalha do perfil não explicou a condição de 10 vitórias.");
  await page.locator("#badgeInfoPopoverClose").click();
  await page.locator("#tournamentAwardShelf .achievement-card.unlocked").first().click();
  check((await page.locator("#badgeInfoPopoverText").textContent()).includes("42/50 pontos"),
    name+": a premiação do torneio não mostrou a explicação de aquisição.");
  await page.locator("#badgeInfoPopoverClose").click();
  await page.locator("#profileFeaturedDisplay .profile-featured-badge").first().click();
  check(await page.locator("#badgeInfoPopover").isVisible(),
    name+": os destaques selecionados de Meu perfil não abriram o balão.");
  await page.locator("#badgeInfoPopoverClose").click();
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

  await page.evaluate(()=>{
    document.querySelector("#setup").classList.add("hidden");
    document.querySelector("#game").classList.remove("hidden");
    if(questionTimer!==null)clearInterval(questionTimer);
    questionTimer=null;questionStartedAt=0;questionElapsedBeforeStart=0;questionClockPaused=false;
    selected=[{n:2,mode:"normal"}];deck=[{a:2,b:3}];position=0;round=1;hits=0;misses=0;
    roundCorrect=new Set();trainingRoundTarget=1;current={a:2,b:3};revealed=true;
    currentQuestionTimeMs=125;currentQuestionTimeStopped=true;currentDifficultyMarked=false;
    sessionAnswers=[];sessionSkipped=0;sessionQuestionTimeMs=0;sessionStartedAt=performance.now();
    markCurrentQuestionDifficulty();
  });
  const difficultyRepeat=await page.evaluate(()=>({
    deckLength:deck.length,position,current:{a:current?.a,b:current?.b},
    skipped:sessionSkipped,time:sessionQuestionTimeMs,revealed
  }));
  check(difficultyRepeat.deckLength===2&&difficultyRepeat.position===1&&
    difficultyRepeat.current.a===2&&difficultyRepeat.current.b===3&&
    difficultyRepeat.skipped===1&&difficultyRepeat.time===125&&!difficultyRepeat.revealed,
    name+": ao marcar dificuldade, a questão não avançou ou não foi colocada novamente no ciclo: "+JSON.stringify(difficultyRepeat));
  await page.evaluate(()=>{
    if(questionTimer!==null)clearInterval(questionTimer);
    questionTimer=null;questionStartedAt=0;questionElapsedBeforeStart=0;questionClockPaused=false;
    current=null;document.querySelector("#game").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
  });

  await page.evaluate(()=>{
    document.querySelector("#setup").classList.add("hidden");
    document.querySelector("#game").classList.remove("hidden");
    current={a:3,b:4};revealed=false;questionClockPaused=false;
    questionStartedAt=0;questionElapsedBeforeStart=0;
    beginQuestionClock();
  });
  await page.waitForTimeout(350);
  await page.evaluate(()=>showTrainingCycleCelebration({coinsAdded:10},false,false));
  const clockPausedBefore=await page.evaluate(()=>({
    paused:questionClockPaused,timer:questionTimer===null,startedAt:questionStartedAt,elapsed:questionElapsedBeforeStart,
    overlay:!!document.querySelector(".training-celebration-overlay"),
    closeButtons:document.querySelectorAll(".training-celebration-close").length
  }));
  check(clockPausedBefore.paused&&clockPausedBefore.timer&&clockPausedBefore.startedAt===0&&
    clockPausedBefore.overlay&&clockPausedBefore.closeButtons===1,
    name+": o cronômetro continuou ativo ou faltou o botão de fechar na tela de parabéns: "+JSON.stringify(clockPausedBefore));
  await page.waitForTimeout(350);
  const clockPausedAfter=await page.evaluate(()=>questionElapsedBeforeStart);
  check(Math.abs(clockPausedAfter-clockPausedBefore.elapsed)<1,
    name+": o tempo do jogo continuou avançando enquanto a tela de parabéns estava aberta.");
  await page.locator(".training-celebration-close").click();
  const clockResumed=await page.evaluate(()=>({
    paused:questionClockPaused,timer:questionTimer!==null,startedAt:questionStartedAt
  }));
  check(!clockResumed.paused&&clockResumed.timer&&clockResumed.startedAt>0,
    name+": o cronômetro não voltou a funcionar depois de fechar a tela de parabéns.");
  await page.waitForTimeout(250);
  const clockAfterResume=await page.evaluate(()=>questionElapsedBeforeStart+Math.max(0,performance.now()-questionStartedAt));
  check(clockAfterResume>clockPausedAfter,
    name+": o cronômetro não retomou a contagem depois de fechar a tela.");
  await page.evaluate(()=>{
    if(questionTimer!==null)clearInterval(questionTimer);
    questionTimer=null;questionStartedAt=0;questionElapsedBeforeStart=0;questionClockPaused=false;
    current=null;document.querySelector("#game").classList.add("hidden");
    showAchievementCongratulations(["training_first"]);
  });
  check(await page.locator("#gameRewardToast").isVisible()&&
    (await page.locator("#gameRewardToast").textContent()).includes("Parabéns!")&&
    (await page.locator("#gameRewardToast").textContent()).includes("Primeiro Ciclo")&&
    await page.locator("#gameRewardToast").evaluate(el=>el.classList.contains("achievement-congrats")),
    name+": a conquista não mostrou o alerta de parabenização destacado.");
  await page.evaluate(()=>{
    if(rewardToastTimer!==null)clearTimeout(rewardToastTimer);
    rewardToastTimer=null;
    document.querySelector("#gameRewardToast").classList.add("hidden");
    document.querySelector("#gameRewardToast").classList.remove("achievement-congrats");
    document.querySelector("#setup").classList.remove("hidden");
  });

  const musicWasPlayingBeforeOptions = await page.evaluate(() => !!(soundOn && soundtrackAudio && !soundtrackAudio.paused));
  await page.locator("#openProfileOptions").click();
  check(!(await page.locator("#profileOptionsPanel").evaluate(el => el.classList.contains("hidden"))), name + ": a tela Opções não abriu.");
  check(await page.locator("#siteMusicBox").evaluate(el => el.classList.contains("hidden")), name + ": o player musical ficou visível em Opções.");
  await page.waitForFunction(()=>document.querySelector("#soundtrackAudio").paused,null,{timeout:4000});
  check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused),name+": a música geral não foi pausada ao abrir Opções.");
  check(await page.locator("#profileSfxVolume").isVisible(), name + ": o controle de efeitos da interface não aparece.");
  check(await page.locator("#profileGameSfxVolume").isVisible(),name+": o controle de efeitos do modo jogo não aparece.");
  check(await page.locator("#profileMusicVolume").isVisible(), name + ": o controle de música não aparece.");
  check((await page.locator("#profileMusicVolume").inputValue())==="70",name+": o volume padrão da música não começa em 70%.");
  check((await page.locator("#profileSfxVolume").inputValue())==="90",name+": o volume padrão da interface não começa em 90%.");
  check((await page.locator("#profileGameSfxVolume").inputValue())==="4",name+": o volume padrão do modo jogo não começa em 4%.");
  for(const id of ["#resetProfileMusicVolume","#resetProfileSfxVolume","#resetProfileGameSfxVolume"])
    check(!(await page.locator(id).isVisible()),name+": "+id+" deveria ficar oculto quando já está no padrão.");
  await page.evaluate(() => {
    window.__previewCalls=0;window.__gamePreviewCalls=0;window.__audioPreferenceWrites=0;window.__audioPreferencePayload=null;
    window.cloudTokenReady=()=>true;
    window.writeRemoteUser=async(username,payload)=>{
      window.__audioPreferenceWrites++;
      window.__audioPreferencePayload=JSON.parse(JSON.stringify(payload));
      return "smoke-audio-sha";
    };
    remoteUserData={version:1,username:activeProfile,profile:{},history:{questions:{},sessions:[]}};
    remoteUserSha="smoke-audio-sha";
    window.__originalPlayUiSound=window.playUiSound;
    window.playUiSound=function(name,channel='interface',optionPreview=false){
      if(channel==='game')window.__gamePreviewCalls++;
      else if(name==="click")window.__previewCalls++;
      return window.__originalPlayUiSound(name,channel,optionPreview);
    };
  });
  const beforeInterfacePreview=await page.evaluate(()=>window.__previewCalls);
  await page.locator("#profileSfxVolume").evaluate(element=>{element.value="55";element.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.waitForFunction(previous=>window.__previewCalls>previous,beforeInterfacePreview,{timeout:3000});
  check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused),
    name+": a música de fundo tocou junto com a prévia da interface.");
  const beforeGamePreview=await page.evaluate(()=>window.__gamePreviewCalls);
  await page.locator("#profileGameSfxVolume").evaluate(element=>{element.value="45";element.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.waitForFunction(previous=>window.__gamePreviewCalls>=previous+4,beforeGamePreview,{timeout:4000});
  check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused),
    name+": a música de fundo tocou junto com a prévia do modo jogo.");
  await page.locator("#profileMusicVolume").evaluate(element=>{element.value="43";element.dispatchEvent(new Event("input",{bubbles:true}));});
  check((await page.locator("#profileSfxVolumeValue").textContent()).trim()==="55%",name+": o volume dos efeitos da interface não atualizou.");
  check((await page.locator("#profileGameSfxVolumeValue").textContent()).trim()==="45%",name+": o volume dos efeitos do modo jogo não atualizou.");
  check((await page.locator("#profileMusicVolumeValue").textContent()).trim()==="43%",name+": o volume da música não atualizou.");
  check((await page.locator("#volumeValue").textContent()).trim()==="43%",name+": o volume musical geral não sincronizou.");
  check(await page.evaluate(()=>Math.abs(sfxVolumeLevel-.55)<.01),name+": o volume dos efeitos da interface não foi aplicado.");
  check(await page.evaluate(()=>Math.abs(gameSfxVolumeLevel-.45)<.01),name+": o volume dos efeitos do modo jogo não foi aplicado.");
  check(await page.evaluate(()=>Math.abs(volumeLevel-.43)<.01),name+": o volume da música não foi aplicado.");
  await page.waitForFunction(()=>optionMusicPreviewActive&&!document.querySelector("#soundtrackAudio").paused,null,{timeout:4000});
  await page.waitForTimeout(1350);
  check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused)&&
    await page.evaluate(()=>!optionMusicPreviewActive),
    name+": a prévia da música não terminou ou a trilha geral continuou tocando.");
  await page.waitForFunction(()=>uiSfxGain&&Math.abs(uiSfxGain.gain.value-.55)<.02,null,{timeout:3000});
  await page.waitForFunction(()=>gameSfxGain&&Math.abs(gameSfxGain.gain.value-.45)<.02,null,{timeout:3000});
  await page.waitForFunction(()=>window.__previewCalls>0&&window.__gamePreviewCalls>0,null,{timeout:3000});
  check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused),
    name+": a música de fundo tocou junto com as prévias dos efeitos da interface ou do modo jogo.");
  for(const id of ["#resetProfileMusicVolume","#resetProfileSfxVolume","#resetProfileGameSfxVolume"])
    check(await page.locator(id).isVisible(),name+": após alterar o volume, "+id+" deveria aparecer.");
  await page.locator("#resetProfileGameSfxVolume").click();
  check((await page.locator("#profileGameSfxVolume").inputValue())==="4"&&
    (await page.locator("#profileGameSfxVolumeValue").textContent()).trim()==="4%",
    name+": o modo jogo não retornou ao padrão de 4%.");
  check(await page.evaluate(()=>Math.abs(gameSfxVolumeLevel-.04)<.001),name+": não aplicou 4% ao modo jogo.");
  check(!(await page.locator("#resetProfileGameSfxVolume").isVisible()),name+": o reset do modo jogo deveria sumir no padrão.");
  await page.locator("#resetProfileSfxVolume").click();
  check((await page.locator("#profileSfxVolume").inputValue())==="90"&&
    (await page.locator("#profileSfxVolumeValue").textContent()).trim()==="90%",
    name+": a interface não retornou ao padrão de 90%.");
  check(!(await page.locator("#resetProfileSfxVolume").isVisible()),name+": o reset da interface deveria sumir no padrão.");
  await page.locator("#resetProfileMusicVolume").click();
  check((await page.locator("#profileMusicVolume").inputValue())==="70"&&
    (await page.locator("#profileMusicVolumeValue").textContent()).trim()==="70%",
    name+": a música não retornou ao padrão de 70%.");
  check(await page.evaluate(()=>Math.abs(volumeLevel-.70)<.001),name+": não aplicou 70% à música.");
  check(!(await page.locator("#resetProfileMusicVolume").isVisible()),name+": o reset da música deveria sumir no padrão.");
  await page.waitForFunction(()=>optionMusicPreviewActive&&!document.querySelector("#soundtrackAudio").paused,null,{timeout:4000});
  await page.waitForTimeout(1350);
  check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused)&&
    await page.evaluate(()=>!optionMusicPreviewActive),
    name+": a restauração de 70% não tocou e encerrou somente a prévia da música.");
  await page.locator("#profileSfxVolume").evaluate(element=>{element.value="55";element.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.locator("#profileGameSfxVolume").evaluate(element=>{element.value="45";element.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.locator("#profileMusicVolume").evaluate(element=>{element.value="43";element.dispatchEvent(new Event("input",{bubbles:true}));});
  for(const id of ["#resetProfileMusicVolume","#resetProfileSfxVolume","#resetProfileGameSfxVolume"])
    check(await page.locator(id).isVisible(),name+": os botões de reset deveriam reaparecer após sair do padrão.");
  await page.locator("#saveProfileAudioPreferences").click();
  await page.waitForFunction(()=>window.__audioPreferenceWrites===1,null,{timeout:5000});
  const savedAudioProfile=await page.evaluate(()=>({
    sfx:profilesData[activeProfile]?.sfxVolume,game:profilesData[activeProfile]?.gameSfxVolume,music:profilesData[activeProfile]?.musicVolume,
    remoteSfx:window.__audioPreferencePayload?.profile?.sfxVolume,remoteGame:window.__audioPreferencePayload?.profile?.gameSfxVolume,
    remoteMusic:window.__audioPreferencePayload?.profile?.musicVolume
  }));
  check(Math.abs(savedAudioProfile.sfx-.55)<.01&&Math.abs(savedAudioProfile.game-.45)<.01&&Math.abs(savedAudioProfile.music-.43)<.01,name+": os três volumes não foram salvos no perfil local.");
  check(Math.abs(savedAudioProfile.remoteSfx-.55)<.01&&Math.abs(savedAudioProfile.remoteGame-.45)<.01&&Math.abs(savedAudioProfile.remoteMusic-.43)<.01,name+": os três volumes não foram enviados à nuvem.");
  check((await page.locator("#saveProfileAudioPreferences").textContent()).includes("Salvar como preferência da conta"),
    name+": o botão não foi renomeado corretamente.");
  check((await page.locator("#profileAudioSaveStatus").textContent()).includes("Padrão salvo na sua conta"),name+": confirmação do salvamento não apareceu.");
  check((await page.locator("#closeProfileOptions").textContent()).includes("Voltar ao jogo"),
     name+": o botão de Opções não indica retorno à página inicial do jogo.");
  await page.locator("#closeProfileOptions").click();
  check(await page.locator("#profileOptionsPanel").evaluate(el=>el.classList.contains("hidden"))&&
    await page.locator("#profileScreen").evaluate(el=>el.classList.contains("hidden"))&&
    !(await page.locator("#setup").evaluate(el=>el.classList.contains("hidden"))),
    name+": o botão de Opções não retornou ao menu principal.");
  check(!(await page.locator("#siteMusicBox").evaluate(el=>el.classList.contains("hidden"))),
    name+": o player de música não voltou a aparecer no menu principal depois de fechar Opções.");
  if(musicWasPlayingBeforeOptions)await page.waitForFunction(()=>!document.querySelector("#soundtrackAudio").paused,null,{timeout:5000});
  else check(await page.locator("#soundtrackAudio").evaluate(el=>el.paused),
    name+": a música voltou a tocar após fechar Opções, apesar de estar pausada antes.");
  await page.evaluate(()=>{
    setVolume(100);
    sfxVolumeLevel=.90;gameSfxVolumeLevel=.04;
    restoreProfileSfxVolume();restoreProfileGameSfxVolume();restoreProfileMusicVolume();
  });
  check((await page.locator("#globalVolume").inputValue())==="43",name+": o volume da música não foi restaurado ao retornar.");
  check(await page.evaluate(()=>Math.abs(sfxVolumeLevel-.55)<.01),name+": o volume da interface não foi restaurado.");
  check(await page.evaluate(()=>Math.abs(gameSfxVolumeLevel-.45)<.01),name+": o volume do modo jogo não foi restaurado.");

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
      titles: ["Primeiro Ciclo","Explorador","Disciplina","A Jornada Começa"],
      medals: [{id:"recruta",name:"Recruta",wins:12}],
      awards: [{month:"2026-10",difficulty:"Fácil",rank:2,score:42,frame:"Prata"}],
      featuredAwards: ["achievement:training_first","medal:recruta","award:2026-10"],
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
  const communityStatsColor = await page.locator(".community-rank-public-stats").first().evaluate(element => getComputedStyle(element).color);
  check(communityStatsColor === "rgb(16, 43, 73)",
    name + ": estatísticas da comunidade continuam com pouco contraste (" + communityStatsColor + ").");
  await page.evaluate(async()=>{
    communityCache[0].featuredTitles=[];
    await renderCommunityRanking();
  });
  const automaticTitles=await page.locator(".community-rank-title-chip").allTextContents();
  check(automaticTitles.length===3&&automaticTitles.some(value=>value.includes("Primeiro Ciclo"))&&automaticTitles.some(value=>value.includes("Explorador"))&&automaticTitles.some(value=>value.includes("Disciplina"))&&!automaticTitles.some(value=>value.includes("A Jornada Começa")),
    name+": sem escolhas, a comunidade não mostrou exatamente os três primeiros títulos conquistados.");
  const communityGridColumns=await page.locator(".community-profile-details").first().evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(" ").length);
  check(communityGridColumns===1,name+": as seções do perfil público não estão organizadas uma abaixo da outra ("+communityGridColumns+").");
  await page.locator(".community-rank-title-section .community-rank-title-chip").first().click();
  check(await page.locator("#badgeInfoPopover").isVisible()&&
    (await page.locator("#badgeInfoPopoverText").textContent()).includes("Conclua seu primeiro ciclo"),
    name+": o título na comunidade não abriu o balão com a condição de aquisição.");
  await page.locator("#badgeInfoPopoverClose").click();

  await page.locator(".community-rank-card").first().evaluate(element=>{element.open=true;});
  const challengePosition = await page.locator(".community-profile-details").first().evaluate(element => {
    const challenge = element.querySelector(".community-challenge-details");
    const metrics = element.querySelector(".community-profile-detail-grid");
    return !!challenge && !!metrics && element.firstElementChild === challenge &&
      (challenge.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  check(challengePosition, name + ": os desafios não aparecem logo abaixo das estatísticas ao expandir o perfil.");
  const ownCoinAlignment=await page.locator(".wallet-inline > span:first-child").evaluate(el=>{
    const coin=el.querySelector(".coin-symbol").getBoundingClientRect(),value=el.querySelector("strong").getBoundingClientRect();
    return Math.abs((coin.top+coin.height/2)-(value.top+value.height/2));
  });
  check(ownCoinAlignment<=1.5,name+": a moeda em Seu perfil não está centralizada na vertical com o valor ("+ownCoinAlignment+"px).");
  const communityCoinAlignment=await page.locator(".community-coins-metric strong").first().evaluate(el=>{
    const coin=el.querySelector(".coin-symbol").getBoundingClientRect(),value=el.getBoundingClientRect();
    return Math.abs((coin.top+coin.height/2)-(value.top+value.height/2));
  });
  check(communityCoinAlignment<=1.5,name+": a moeda de Moedas disponíveis na comunidade não está centralizada ("+communityCoinAlignment+"px).");
  const publicMedal=page.locator(".community-profile-details .community-rank-chip.medal").first();
  await publicMedal.click();
  check((await page.locator("#badgeInfoPopoverText").textContent()).includes("10 desafios no nível Recruta"),
    name+": medalha do perfil público não explicou como foi conquistada.");
  await page.locator("body").evaluate(el=>el.click());
  check(await page.locator("#badgeInfoPopover").evaluate(el=>el.classList.contains("hidden")),
    name+": o balão da comunidade não fechou ao clicar fora.");
  const publicAward=page.locator(".community-profile-details .community-rank-chip.medal").nth(1);
  await publicAward.click();
  check((await page.locator("#badgeInfoPopoverText").textContent()).includes("42/50 pontos"),
    name+": premiação da comunidade não explicou a posição e a pontuação.");
  await page.locator("#badgeInfoPopoverClose").click();
  await page.locator(".community-featured-badge").first().click();
  check(await page.locator("#badgeInfoPopover").isVisible(),
    name+": o destaque selecionado do perfil público não abriu o balão.");
  await page.locator("#badgeInfoPopoverClose").click();
  await page.screenshot({ path: "artifacts/" + name + "-comunidade.png", fullPage: true });
  // Confere que o cache mantém a versão mais recente em caso de resposta atrasada ou data empatada.
  await page.evaluate(()=>{
    const newest={username:"weighted_user",displayName:"Nome novo",updatedAt:"2026-11-09T10:00:00.000Z",
      correct:18,wrong:4,attempts:22,timeMs:60000,titles:["Primeiro Ciclo","Explorador"],featuredTitles:["adventure_5"],featuredAwards:[]};
    const older={username:"weighted_user",displayName:"Nome antigo",updatedAt:"2026-11-08T10:00:00.000Z",
      correct:10,wrong:3,attempts:13,timeMs:30000,titles:["Primeiro Ciclo"],featuredTitles:[],featuredAwards:[]};
    communityCache=[newest];
    const merged=mergeCommunityRecords([older])[0];
    if(merged.displayName!=="Nome novo"||merged.correct!==18||merged.wrong!==4||
      merged.featuredTitles.length!==1||merged.titles.length!==2)throw new Error("O cache do ranking regrediu dados públicos.");
    const tied=mergeCommunityRecords([{...older,displayName:"Nome empatado",updatedAt:newest.updatedAt}])[0];
    if(tied.displayName!=="Nome novo"||tied.correct!==18)throw new Error("Uma data empatada substituiu a versão atual do perfil.");
    communityCache=[];
  });
  // Duas respostas chegam fora de ordem: a resposta antiga não pode sobrescrever a nova.
  await page.evaluate(async()=>{
    const originalApiRequest=window.apiRequest;
    const pending=[];
    communityCache=[];communityCacheAt=0;
    window.apiRequest=(path)=>path==="/api/community"?new Promise(resolve=>pending.push(resolve)):originalApiRequest(path);
    const baseRecord={username:"race_user",avatar:"imagem:0",coins:40,totalEarned:80,trainingCycles:2,completedStages:1,
      achievementCount:2,challengeWins:0,challengeLosses:0,challengeDraws:0,challengeTotal:0,
      titles:["Primeiro Ciclo"],medals:[],awards:[],featuredAwards:[],featuredTitles:[],
      profile:{displayName:"Perfil"},history:{questions:{},sessions:[]}};
    const oldRecord={...baseRecord,displayName:"Nome antigo",correct:10,wrong:3,attempts:13,timeMs:30000,updatedAt:"2026-11-08T10:00:00.000Z"};
    const freshRecord={...baseRecord,displayName:"Nome novo",correct:18,wrong:4,attempts:22,timeMs:60000,updatedAt:"2026-11-09T10:00:00.000Z"};
    const oldRender=renderCommunityRanking();
    const newRender=renderCommunityRanking();
    pending[1]({records:[freshRecord]});
    await newRender;
    pending[0]({records:[oldRecord]});
    await oldRender;
    window.apiRequest=originalApiRequest;
  });
  check((await page.locator(".community-rank-display-title").first().textContent()).trim()==="Nome Novo",
    name+": uma resposta antiga da comunidade sobrescreveu o perfil mais recente.");
  check((await page.locator(".community-rank-public-stats").first().textContent()).includes("18")&&
    (await page.locator(".community-rank-public-stats").first().textContent()).includes("4"),
    name+": os acertos e erros públicos foram substituídos por valores de uma resposta antiga.");


  await page.evaluate(()=>{
    document.querySelector("#profileScreen").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
    setMainContentSections({hub:true,community:true});
  });
  const mainSections=["modeHub","trainingModePanel","adventureMapView","adventureIntroView","adventurePlayView","adventureResultView","challengeModeView","tournamentModeView","communitySection","shopScreen"];
  const getVisibleMainSections=()=>page.evaluate(ids=>Object.fromEntries(ids.map(id=>[id,!document.getElementById(id).classList.contains("hidden")])),mainSections);
  const assertMusicMenuMinimized=async(label)=>{
    const state=await page.evaluate(()=>{
      const box=document.querySelector("#siteMusicBox");
      const toggle=document.querySelector("#musicMenuToggle");
      const controls=document.querySelector("#musicControls");
      return {
        visible:!!box&&!box.classList.contains("hidden")&&box.getClientRects().length>0,
        expanded:toggle?.getAttribute("aria-expanded")==="true",
        controlsHidden:!!controls&&controls.classList.contains("hidden")
      };
    });
    check(state.visible&&!state.expanded&&state.controlsHidden,
      name+": o menu de música deve ficar visível e minimizado em "+label+": "+JSON.stringify(state));
  };
  const assertVisibleSections=async(expected,label)=>{
    const actual=await getVisibleMainSections();
    const visible=Object.keys(actual).filter(id=>actual[id]).sort();
    const wanted=[...expected].sort();
    check(JSON.stringify(visible)===JSON.stringify(wanted),name+": seções incorretas em "+label+": "+JSON.stringify(visible));
    await assertMusicMenuMinimized(label);
  };
  await assertVisibleSections(["modeHub","communitySection"],"menu inicial");
  await page.locator("#navShop").click();
  await assertVisibleSections(["shopScreen"],"Loja");
  const shopReturnButtons=await page.locator("button").evaluateAll(items=>items.filter(button=>
    button.getClientRects().length&&/Voltar ao jogo/i.test(button.textContent||"")).map(button=>button.id));
  check(JSON.stringify(shopReturnButtons)===JSON.stringify(["bottomReturnToGame"]),
    name+": a Loja deve ter uma única opção visível de Voltar ao jogo: "+JSON.stringify(shopReturnButtons));
  await page.locator("#navCommunity").click();
  await assertVisibleSections(["communitySection"],"Comunidade");
  await page.locator("#topReturnToGame").click();
  await assertVisibleSections(["modeHub","communitySection"],"Voltar ao jogo");

  // Abrir o perfil a partir da Loja e voltar deve sempre levar à página inicial do jogo.
  await page.locator("#navShop").click();
  await page.locator("#navProfile").click();
  check(!(await page.locator("#profileScreen").evaluate(el=>el.classList.contains("hidden"))),
    name+": o atalho Meu perfil não abriu a tela do perfil a partir da Loja.");
  await page.locator("#backFromProfileTop").click();
  await assertVisibleSections(["modeHub","communitySection"],"Voltar ao jogo pelo Meu perfil");

  // Estatísticas também devem sair para a página inicial, e não restaurar a Loja.
  await page.evaluate(()=>{
    setMainContentSections({shop:true});
    openProfileScreen(true);
  });
  check(!(await page.locator("#shopScreen").evaluate(el=>el.classList.contains("hidden"))),
    name+": o cenário de origem da Loja não foi preparado para as Estatísticas.");
  check(!(await page.locator("#profileStatsPanel").evaluate(el=>el.classList.contains("hidden"))),
    name+": Minhas estatísticas não abriram.");
  check((await page.locator("#closeProfileStats").textContent()).includes("Voltar ao jogo"),
    name+": o botão das estatísticas não está identificado como Voltar ao jogo.");
  await page.locator("#closeProfileStats").click();
  await assertVisibleSections(["modeHub","communitySection"],"Voltar ao jogo pelas Estatísticas");

  // Opções seguem a mesma regra, mesmo abertas depois da Loja.
  await page.evaluate(()=>{
    setMainContentSections({shop:true});
    openProfileScreen();
    showProfileOptions();
  });
  check(!(await page.locator("#shopScreen").evaluate(el=>el.classList.contains("hidden"))),
    name+": o cenário de origem da Loja não foi preparado para Opções.");
  check(!(await page.locator("#profileOptionsPanel").evaluate(el=>el.classList.contains("hidden"))),
    name+": Opções não abriram.");
  check((await page.locator("#closeProfileOptions").textContent()).includes("Voltar ao jogo"),
    name+": o botão de Opções não está identificado como Voltar ao jogo.");
  await page.locator("#closeProfileOptions").click();
  await assertVisibleSections(["modeHub","communitySection"],"Voltar ao jogo pelas Opções");

  await page.locator("#openTrainingMode").click();
  check(!(await page.locator("#trainingModePanel").evaluate(el => el.classList.contains("hidden"))), name + ": botão Treinamento não abriu a modalidade.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("TREINAMENTO"), name + ": música não mudou para Treinamento.");
  await assertVisibleSections(["trainingModePanel"],"Treinamento");
  await page.locator("#backToModeHubTraining").click();
  await assertVisibleSections(["modeHub","communitySection"],"retorno do Treinamento");

  await page.locator("#openAdventureMode").click();
  check(!(await page.locator("#adventureMapView").evaluate(el => el.classList.contains("hidden"))), name + ": botão Modo Jogo não abriu o mapa da aventura.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("MODO JOGO"), name + ": música não mudou para Modo Jogo.");
  await assertVisibleSections(["adventureMapView"],"Modo Jogo");
  await page.locator("#backToModeHubMap").click();
  await assertVisibleSections(["modeHub","communitySection"],"retorno do Modo Jogo");

  await page.locator("#openChallengeMode").click();
  check(!(await page.locator("#challengeModeView").evaluate(el => el.classList.contains("hidden"))), name + ": botão Desafio não abriu a modalidade.");
  check(!(await page.locator("#challengeHomePanel").evaluate(el => el.classList.contains("hidden"))), name + ": menu inicial do Desafio não apareceu.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("DESAFIO"), name + ": música não mudou para Desafio.");
  await assertVisibleSections(["challengeModeView","communitySection"],"Desafio com Comunidade");
  await page.evaluate(()=>{setMusicMenuExpanded(true);showChallengeSubPanel("challengePlayPanel");});
  await assertMusicMenuMinimized("partida de Desafio");
  await page.evaluate(()=>showChallengeSubPanel("challengeHomePanel"));
  await page.locator("#backFromChallenge").click();
  await assertVisibleSections(["modeHub","communitySection"],"retorno do Desafio");

  await page.locator("#openTournamentMode").click();
  check(!(await page.locator("#tournamentModeView").evaluate(el => el.classList.contains("hidden"))), name + ": botão Torneio não abriu a modalidade.");
  check(!(await page.locator("#tournamentHomePanel").evaluate(el => el.classList.contains("hidden"))), name + ": menu inicial do Torneio não apareceu.");
  check((await page.locator("#musicCategoryKicker").textContent()).includes("TORNEIO"), name + ": música não mudou para Torneio.");
  await assertVisibleSections(["tournamentModeView","communitySection"],"Torneio com Comunidade");
  await page.locator("#backFromTournament").click();
  await assertVisibleSections(["modeHub","communitySection"],"retorno do Torneio");

  const finalOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth
  }));
  check(finalOverflow.document <= finalOverflow.viewport + 1, name + ": há rolagem horizontal nas modalidades (" + JSON.stringify(finalOverflow) + ").");
  check(pageErrors.length === 0, name + ": erros JavaScript no navegador: " + pageErrors.join(" | "));

  viewportResults.push({ name, viewport, homeOverflow, chartOverflow, finalOverflow, audio });
  await page.close();
}

async function testExplicitSave(browser) {
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
        body: JSON.stringify({ sha: "explicit-save-smoke-new-sha" })
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
      const username = "explicit-save-smoke";
      sessionStorage.setItem(API_TOKEN_KEY, "fake-session-token");
      sessionStorage.setItem(AUTH_SESSION_KEY, username);
      activeProfile = username;
      remoteUserSha = "old-sha";
      remoteUserData = {
        version: 1, username, profile: { studyTimeMs: 0 },
        history: { questions: {}, sessions: [] }, updatedAt: "2026-11-09T12:00:00.000Z"
      };
      profilesData[username] = { displayName: "Perfil salvo no botão", studyTimeMs: 0 };
      historyData = {
        questions: {
          "77x1": { a: 77, b: 1, attempts: 1, correct: 0, wrong: 1, totalTimeMs: 800, bestTimeMs: 800 }
        },
        sessions: [{ id:"training-explicit-1", date:"2026-11-09T12:10:00.000Z", mode:"training", answered:1, hits:0, misses:1 }]
      };
      pendingActiveMs = 10 * 60 * 1000;
      studyTimeBaseMs = 0;
      activeTimeTimer = null;
      savePendingActiveTime(username);
      persistProfiles();
      saveHistory();
    });

    await page.waitForTimeout(250);
    check(writes.length === 0,
      "O histórico foi enviado automaticamente sem a pessoa clicar em salvar ou sair da partida.");

    const firstSaved = await page.evaluate(()=>saveProgressNow("Treinamento",{refreshCommunity:false}));
    check(firstSaved&&writes.length===1,
      "O botão de salvamento explícito não enviou o histórico ao servidor.");
    check(writes[0].history?.questions?.["77x1"]?.wrong===1&&
      Number(writes[0].profile?.studyTimeMs)>=10*60*1000,
      "O salvamento explícito não incluiu o erro e o tempo acumulado.");

    await page.evaluate(() => {
      pendingActiveMs += 20 * 60 * 1000;
      profilesData[activeProfile].studyTimeMs = studyTimeBaseMs + pendingActiveMs;
      savePendingActiveTime(activeProfile);
    });
    await page.waitForTimeout(300);
    check(writes.length===1,
      "O tempo acumulado voltou a disparar salvamento automático.");

    const secondSaved = await page.evaluate(()=>saveProgressNow("Sair da partida",{refreshCommunity:false}));
    check(secondSaved&&writes.length===2,
      "O segundo salvamento não ocorreu após a ação explícita de sair.");
    check(Number(writes[1].profile?.studyTimeMs)>=30*60*1000,
      "O salvamento ao sair não incluiu todo o tempo que ainda estava pendente.");
    const lastSavedLabel = (await page.locator("#profileLastSavedAt").textContent()) || "";
    check(lastSavedLabel.startsWith("Último salvamento:"),
      "O perfil não exibiu a data e o horário do último salvamento.");

    return { result: "PASS", explicitSaves: writes.length, autoSavesWithoutAction: 0, lastSavedLabel };
  } finally {
    await page.close();
  }
}

try {
  await testViewport("celular", { width: 390, height: 844 }, true);
  await testViewport("celular-pequeno", { width: 360, height: 800 }, true);
  await testViewport("computador", { width: 1366, height: 900 }, false);
  var explicitSaveResult = await testExplicitSave(browser);
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
    explicitSave: explicitSaveContract
  },
  explicitSave: explicitSaveResult,
  browser: viewportResults
}, null, 2));
