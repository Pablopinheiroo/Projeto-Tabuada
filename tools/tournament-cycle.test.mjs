import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8");
const constantsStart = source.indexOf("const TOURNAMENT_PRESETS = {");
const constantsEnd = source.indexOf("const CHALLENGE_PRESETS = {", constantsStart);
const helpersStart = source.indexOf("function currentSaoPauloMonth(date = new Date()) {");
const helpersEnd = source.indexOf("function rankTournament(", helpersStart);

assert.ok(constantsStart >= 0 && constantsEnd > constantsStart, "Não foi possível localizar as configurações do torneio.");
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "Não foi possível localizar as funções do ciclo e das questões.");

const isolatedSource = [
  source.slice(constantsStart, constantsEnd),
  source.slice(helpersStart, helpersEnd),
  "globalThis.tournamentTest = { currentSaoPauloMonth, tournamentFilePath, tournamentCycleByIndex, currentTournamentCycle, buildTournamentQuestions, isTournamentSeasonKey, tournamentSeasonKeyLabel };"
].join("\n");

const context = {};
vm.runInNewContext(isolatedSource, context, { timeout: 5000 });
const { currentTournamentCycle, tournamentCycleByIndex, tournamentFilePath, buildTournamentQuestions, isTournamentSeasonKey, tournamentSeasonKeyLabel } = context.tournamentTest;

const firstSeasonStart = new Date("2026-11-11T03:00:00.000Z");
const firstSeasonEnd = new Date("2026-12-11T03:00:00.000Z");
const beforeRenewal = currentTournamentCycle(new Date(firstSeasonEnd.getTime() - 1));
const atRenewal = currentTournamentCycle(firstSeasonEnd);

assert.equal(beforeRenewal.number, 1, "A primeira temporada terminou antes de completar 30 dias.");
assert.equal(beforeRenewal.key, "2026-11", "A primeira temporada não preservou o quadro mensal que já existia.");
assert.equal(beforeRenewal.startsAt, firstSeasonStart.toISOString());
assert.equal(beforeRenewal.endsAt, firstSeasonEnd.toISOString());
assert.equal(atRenewal.number, 2, "A nova temporada não iniciou no instante da renovação.");
assert.equal(atRenewal.key, "ciclo-0001");
assert.equal(atRenewal.startsAt, firstSeasonEnd.toISOString());
assert.equal(new Date(atRenewal.endsAt).getTime() - new Date(atRenewal.startsAt).getTime(), 30 * 24 * 60 * 60 * 1000);
assert.equal(tournamentCycleByIndex(2).key, "ciclo-0002");
assert.equal(tournamentFilePath("2026-11"), "torneio-mensal-2026-11.json");
assert.equal(tournamentFilePath("ciclo-0001"), "torneio-ciclo-0001.json");
assert.equal(isTournamentSeasonKey("2026-11"), true, "A compatibilidade com prêmios mensais antigos foi perdida.");
assert.equal(isTournamentSeasonKey("ciclo-0001"), true, "Prêmios de temporadas de 30 dias não foram reconhecidos.");
assert.equal(isTournamentSeasonKey("ciclo-0001-extra"), false, "Uma chave inválida foi aceita como temporada.");
assert.equal(tournamentSeasonKeyLabel("ciclo-0001"), "Temporada 2");
assert.equal(tournamentSeasonKeyLabel("2026-11"), "novembro de 2026");

const reports = {};
for (const difficulty of ["easy", "medium", "hard"]) {
  const questions = buildTournamentQuestions(246813579, difficulty);
  const sameSeedQuestions = buildTournamentQuestions(246813579, difficulty);
  const otherSeedQuestions = buildTournamentQuestions(975318642, difficulty);

  assert.equal(questions.length, 50, difficulty + ": o torneio precisa ter 50 questões.");
  const multiplicationKeys = questions.map(question => {
    const low = Math.min(question.a, question.b);
    const high = Math.max(question.a, question.b);
    return low + "x" + high;
  });
  assert.equal(new Set(multiplicationKeys).size, 50,
    difficulty + ": há uma multiplicação repetida (incluindo a forma invertida).");

  for (const [index, question] of questions.entries()) {
    assert.equal(question.answer, question.a * question.b,
      difficulty + ": resposta incorreta na questão " + (index + 1) + ".");
    assert.ok(Array.isArray(question.options) && question.options.includes(question.answer),
      difficulty + ": a alternativa correta não está presente.");
    assert.equal(new Set(question.options).size, question.options.length,
      difficulty + ": há alternativas numéricas repetidas.");
  }

  assert.equal(JSON.stringify(questions), JSON.stringify(sameSeedQuestions),
    difficulty + ": a mesma temporada não gera sempre a mesma prova.");
  assert.notEqual(
    JSON.stringify(questions.map(question => [question.a, question.b])),
    JSON.stringify(otherSeedQuestions.map(question => [question.a, question.b])),
    difficulty + ": sementes diferentes não alteraram a ordem aleatória."
  );
  reports[difficulty] = { questions: questions.length, uniqueMultiplications: 50 };
}

console.log(JSON.stringify({
  result: "PASS",
  cycleDays: 30,
  firstRenewal: firstSeasonEnd.toISOString(),
  nextCycleKey: atRenewal.key,
  difficulties: reports
}, null, 2));
