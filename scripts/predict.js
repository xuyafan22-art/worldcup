import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "data", "processed", "worldcup-data.json");
const playerPath = path.join(root, "data", "player-ratings.json");
const outputPath = path.join(root, "public", "predictions.json");

const MAX_GOALS = 7;
const HOSTS = new Set(["USA", "Canada", "Mexico"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function poisson(k, lambda) {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** k) / factorial;
}

function normalize(value, min, max) {
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function softmax(values) {
  const max = Math.max(...values);
  const scores = values.map((value) => Math.exp(value - max));
  const total = scores.reduce((sum, value) => sum + value, 0);
  return scores.map((value) => Number((value / total).toFixed(4)));
}

function makeStrengthModel(teams, playerRatings) {
  const elos = teams.map((team) => team.elo);
  const minElo = Math.min(...elos);
  const maxElo = Math.max(...elos);
  const maxRank = Math.max(...teams.map((team) => team.fifaRank ?? teams.length));

  return teams.map((team) => {
    const playerData = playerRatings.teams?.[team.name];
    const player = playerData?.score;
    const eloScore = normalize(team.elo, minElo, maxElo);
    const fifaScore = team.fifaRank ? normalize(maxRank + 1 - team.fifaRank, 1, maxRank) : eloScore;
    const playerScore = typeof player === "number" ? clamp(player, 0, 100) : null;
    const knownWeight = playerScore === null ? 0.95 : 1;
    const base =
      (eloScore * 0.45 + fifaScore * 0.1 + team.recentScore * 0.25 + team.historyScore * 0.15
        + (playerScore ?? 0) * 0.05) / knownWeight;
    const strength = clamp(base + (HOSTS.has(team.name) ? 3 : 0), 1, 99);

    return {
      ...team,
      playerScore,
      playerDataSource: playerRatings.source?.sourceRepo ?? null,
      playerMarketValue: playerData?.marketValue ?? null,
      playerTopFiveValue: playerData?.topFiveValue ?? null,
      playerAverageAge: playerData?.averageAge ?? null,
      playerSquadSize: playerData?.squadSize ?? 0,
      playerCaps: playerData?.caps ?? 0,
      playerGoals: playerData?.goals ?? 0,
      topPlayers: playerData?.topPlayers ?? [],
      strength: Number(strength.toFixed(2)),
      attack: Number(clamp(0.78 + strength / 92 + team.recentGoalsFor / Math.max(team.recentGames, 1) / 12, 0.65, 2.05).toFixed(3)),
      defense: Number(clamp(1.18 - strength / 145 + team.recentGoalsAgainst / Math.max(team.recentGames, 1) / 18, 0.55, 1.3).toFixed(3)),
    };
  });
}

function predictMatch(home, away, neutral = false) {
  const hostBoost = !neutral && HOSTS.has(home.name) ? 0.11 : 0;
  const awayHostBoost = !neutral && HOSTS.has(away.name) ? 0.08 : 0;
  const diff = (home.strength - away.strength) / 100;
  const homeGoals = clamp(1.25 * home.attack * away.defense + diff * 0.78 + hostBoost, 0.18, 3.4);
  const awayGoals = clamp(1.15 * away.attack * home.defense - diff * 0.72 + awayHostBoost, 0.18, 3.2);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bestScore = "0-0";
  let bestScoreProbability = 0;
  const scorelines = [];

  for (let h = 0; h <= MAX_GOALS; h += 1) {
    for (let a = 0; a <= MAX_GOALS; a += 1) {
      const probability = poisson(h, homeGoals) * poisson(a, awayGoals);
      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;

      if (probability > bestScoreProbability) {
        bestScoreProbability = probability;
        bestScore = `${h}-${a}`;
      }
      scorelines.push({ score: `${h}-${a}`, probability });
    }
  }

  const total = homeWin + draw + awayWin;
  const normalizeProbability = (value) => Number((value / total).toFixed(4));

  return {
    homeTeam: home.name,
    awayTeam: away.name,
    homeWin: normalizeProbability(homeWin),
    draw: normalizeProbability(draw),
    awayWin: normalizeProbability(awayWin),
    expectedGoals: {
      home: Number(homeGoals.toFixed(2)),
      away: Number(awayGoals.toFixed(2)),
    },
    predictedScore: bestScore,
    topScores: scorelines
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5)
      .map((item) => ({ score: item.score, probability: Number(item.probability.toFixed(4)) })),
  };
}

function pickScoreForOutcome(topScores, outcome) {
  const found = topScores.find((item) => {
    const [home, away] = item.score.split("-").map(Number);
    if (outcome === "home") return home > away;
    if (outcome === "away") return away > home;
    return home === away;
  });

  if (found) return found.score;
  if (outcome === "home") return "1-0";
  if (outcome === "away") return "0-1";
  return "1-1";
}

function gpt55PredictMatch(home, away, basePrediction, neutral = false) {
  const strengthBias = (home.strength - away.strength) / 100;
  const formBias = (home.recentScore - away.recentScore) / 100;
  const historyBias = (home.historyScore - away.historyScore) / 100;
  const playerBias = ((home.playerScore ?? 50) - (away.playerScore ?? 50)) / 100;
  const hostBias = neutral ? 0 : (HOSTS.has(home.name) ? 0.09 : 0) - (HOSTS.has(away.name) ? 0.07 : 0);
  const totalBias = strengthBias * 0.9 + formBias * 0.22 + historyBias * 0.16 + playerBias * 0.12 + hostBias;
  const uncertainty = Math.abs(totalBias);

  const [homeWin, draw, awayWin] = softmax([
    Math.log(basePrediction.homeWin) + totalBias,
    Math.log(basePrediction.draw) - uncertainty * 0.32,
    Math.log(basePrediction.awayWin) - totalBias,
  ]);
  const outcome = homeWin >= draw && homeWin >= awayWin ? "home" : awayWin >= draw ? "away" : "draw";

  return {
    label: "GPT5.5预测",
    basis: "更看重阵容上限、近期状态和大赛底蕴，用于和程序预测做对照。",
    homeTeam: home.name,
    awayTeam: away.name,
    homeWin,
    draw,
    awayWin,
    predictedScore: pickScoreForOutcome(basePrediction.topScores, outcome),
  };
}

function outcomeFromProbabilities(prediction, random) {
  if (random < prediction.homeWin) return "home";
  if (random < prediction.homeWin + prediction.draw) return "draw";
  return "away";
}

function simulateScore(prediction, outcome, rng) {
  const candidates = prediction.topScores
    .filter((item) => {
      const [home, away] = item.score.split("-").map(Number);
      if (outcome === "home") return home > away;
      if (outcome === "away") return away > home;
      return home === away;
    });
  if (!candidates.length) return outcome === "home" ? [1, 0] : outcome === "away" ? [0, 1] : [1, 1];

  const total = candidates.reduce((sum, item) => sum + item.probability, 0);
  let pick = rng() * total;
  for (const item of candidates) {
    pick -= item.probability;
    if (pick <= 0) return item.score.split("-").map(Number);
  }
  return candidates[0].score.split("-").map(Number);
}

function seededRng(seed = 2026) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function groupTable(group, matches, teamMap, rng) {
  const table = new Map(group.teams.map((team) => [team, {
    team,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    wins: 0,
  }]));

  for (const match of matches) {
    const prediction = predictMatch(teamMap.get(match.homeTeam), teamMap.get(match.awayTeam));
    const outcome = outcomeFromProbabilities(prediction, rng());
    const [homeGoals, awayGoals] = simulateScore(prediction, outcome, rng);
    const home = table.get(match.homeTeam);
    const away = table.get(match.awayTeam);
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.points += 3;
      home.wins += 1;
    } else if (homeGoals < awayGoals) {
      away.points += 3;
      away.wins += 1;
    } else {
      home.points += 1;
      away.points += 1;
    }
  }

  return [...table.values()].sort((a, b) =>
    b.points - a.points
    || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
    || b.goalsFor - a.goalsFor
    || b.wins - a.wins
    || teamMap.get(b.team).strength - teamMap.get(a.team).strength,
  );
}

function knockoutWinner(a, b, teamMap, rng) {
  const prediction = predictMatch(teamMap.get(a), teamMap.get(b), true);
  const drawShare = prediction.draw / 2;
  return rng() < prediction.homeWin + drawShare ? a : b;
}

function simulateTournament(data, teamMap, iterations = 10000) {
  const rng = seededRng(20260612);
  const counters = new Map(data.teams.map((team) => [team.name, {
    team: team.name,
    groupFirst: 0,
    groupSecond: 0,
    round32: 0,
    round16: 0,
    quarter: 0,
    semi: 0,
    final: 0,
    champion: 0,
    points: 0,
  }]));

  const groupMatches = new Map(data.groups.map((group) => [
    group.group,
    data.matches.filter((match) => match.group === group.group),
  ]));

  for (let i = 0; i < iterations; i += 1) {
    const qualifiers = [];
    const thirds = [];

    for (const group of data.groups) {
      const table = groupTable(group, groupMatches.get(group.group), teamMap, rng);
      table.forEach((row) => {
        counters.get(row.team).points += row.points;
      });
      counters.get(table[0].team).groupFirst += 1;
      counters.get(table[1].team).groupSecond += 1;
      qualifiers.push(table[0].team, table[1].team);
      thirds.push(table[2]);
    }

    thirds
      .sort((a, b) => b.points - a.points
        || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
        || b.goalsFor - a.goalsFor
        || teamMap.get(b.team).strength - teamMap.get(a.team).strength)
      .slice(0, 8)
      .forEach((row) => qualifiers.push(row.team));

    qualifiers.forEach((team) => counters.get(team).round32 += 1);
    let round = [...qualifiers].sort((a, b) => teamMap.get(b).strength - teamMap.get(a).strength);
    const advanceRound = (from, toField) => {
      const winners = [];
      for (let left = 0, right = from.length - 1; left < right; left += 1, right -= 1) {
        const winner = knockoutWinner(from[left], from[right], teamMap, rng);
        counters.get(winner)[toField] += 1;
        winners.push(winner);
      }
      return winners.sort((a, b) => teamMap.get(b).strength - teamMap.get(a).strength);
    };

    round = advanceRound(round, "round16");
    round = advanceRound(round, "quarter");
    round = advanceRound(round, "semi");
    round = advanceRound(round, "final");
    const champion = knockoutWinner(round[0], round[1], teamMap, rng);
    counters.get(champion).champion += 1;
  }

  return [...counters.values()].map((item) => ({
    team: item.team,
    averageGroupPoints: Number((item.points / iterations).toFixed(2)),
    groupFirst: Number((item.groupFirst / iterations).toFixed(4)),
    groupSecond: Number((item.groupSecond / iterations).toFixed(4)),
    round32: Number((item.round32 / iterations).toFixed(4)),
    round16: Number((item.round16 / iterations).toFixed(4)),
    quarter: Number((item.quarter / iterations).toFixed(4)),
    semi: Number((item.semi / iterations).toFixed(4)),
    final: Number((item.final / iterations).toFixed(4)),
    champion: Number((item.champion / iterations).toFixed(4)),
  })).sort((a, b) => b.champion - a.champion);
}

function buildKnockoutWindows(tournament, teamMap) {
  const likelyRound32 = tournament
    .filter((team) => team.round32 > 0.15)
    .sort((a, b) => b.round32 - a.round32 || teamMap.get(b.team).strength - teamMap.get(a.team).strength)
    .slice(0, 32);

  while (likelyRound32.length < 32) {
    const next = tournament
      .filter((team) => !likelyRound32.some((item) => item.team === team.team))
      .sort((a, b) => teamMap.get(b.team).strength - teamMap.get(a.team).strength)[0];
    if (!next) break;
    likelyRound32.push(next);
  }

  const seeded = [...likelyRound32].sort((a, b) =>
    teamMap.get(b.team).strength - teamMap.get(a.team).strength,
  );
  const round32Matches = [];
  for (let left = 0, right = seeded.length - 1; left < right; left += 1, right -= 1) {
    const home = teamMap.get(seeded[left].team);
    const away = teamMap.get(seeded[right].team);
    const prediction = predictMatch(home, away, true);
    round32Matches.push({
      id: `R32-${String(left + 1).padStart(2, "0")}`,
      seed: `${left + 1} v ${right + 1}`,
      status: "模拟窗口",
      homeTeam: home.name,
      awayTeam: away.name,
      prediction,
      gpt55Prediction: gpt55PredictMatch(home, away, prediction, true),
    });
  }

  return {
    note: "官方淘汰赛对阵可在赛后替换；当前窗口按小组出线概率和综合强度生成模拟 32 强路径。",
    rounds: [
      { key: "round32", name: "32 强", slots: 16, matches: round32Matches },
      { key: "round16", name: "16 强", slots: 8, matches: [] },
      { key: "quarter", name: "1/4 决赛", slots: 4, matches: [] },
      { key: "semi", name: "半决赛", slots: 2, matches: [] },
      { key: "final", name: "决赛", slots: 1, matches: [] },
    ],
  };
}

async function main() {
  const [data, playerRatings] = await Promise.all([
    readFile(dataPath, "utf8").then(JSON.parse),
    readFile(playerPath, "utf8").then(JSON.parse).catch(() => ({ teams: {} })),
  ]);

  const teams = makeStrengthModel(data.teams, playerRatings);
  const teamMap = new Map(teams.map((team) => [team.name, team]));
  const matchPredictions = data.matches.map((match) => ({
    ...match,
    prediction: predictMatch(teamMap.get(match.homeTeam), teamMap.get(match.awayTeam)),
  })).map((match) => ({
    ...match,
    gpt55Prediction: gpt55PredictMatch(
      teamMap.get(match.homeTeam),
      teamMap.get(match.awayTeam),
      match.prediction,
    ),
  }));
  const tournament = simulateTournament(data, teamMap);

  const payload = {
    generatedAt: new Date().toISOString(),
    model: {
      name: "Transparent Elo + form + Poisson model",
      comparisonName: "GPT5.5预测",
      iterations: 10000,
      scoreMaxGoals: MAX_GOALS,
    },
    playerData: {
      generatedAt: playerRatings.generatedAt ?? null,
      source: playerRatings.source ?? null,
      note: playerRatings.note ?? null,
      missingTeams: playerRatings.missingTeams ?? [],
    },
    groups: data.groups,
    teams: teams.sort((a, b) => b.strength - a.strength),
    matches: matchPredictions,
    tournament,
    knockoutWindows: buildKnockoutWindows(tournament, teamMap),
  };

  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`预测完成：${payload.matches.length} 场比赛，${payload.tournament.length} 支球队。`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
