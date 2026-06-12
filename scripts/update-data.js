import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rawDir = path.join(root, "data", "raw");
const processedDir = path.join(root, "data", "processed");

const SOURCES = {
  cup: "https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt",
  results: "https://raw.githubusercontent.com/martj42/international_results/master/results.csv",
  fifaRanking: "https://inside.fifa.com/fifa-world-ranking/men",
};

const TEAM_ALIASES = {
  "Bosnia & Herzegovina": ["Bosnia and Herzegovina"],
  "Cape Verde": ["Cabo Verde"],
  "Czech Republic": ["Czechia"],
  "DR Congo": ["Congo DR", "Democratic Republic of the Congo"],
  "Ivory Coast": ["Côte d'Ivoire", "Cote d'Ivoire"],
  "South Korea": ["Korea Republic"],
  Turkey: ["Türkiye", "Turkiye"],
  USA: ["United States", "United States of America"],
  Curaçao: ["Curacao"],
};

function normalizeTeam(name) {
  const clean = name.trim();
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (canonical === clean || aliases.includes(clean)) return canonical;
  }
  return clean;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "worldcup-ai-predictor/0.1",
      Accept: "text/plain,text/csv,text/html,*/*",
    },
  });
  if (!res.ok) throw new Error(`${url} ${res.status} ${res.statusText}`);
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function parseCup(text) {
  const groups = [];
  const teams = [];
  const matches = [];
  const lines = text.split(/\r?\n/);
  let currentGroup = "";
  let currentDate = "";

  for (const line of lines) {
    const groupLine = line.match(/^Group\s+([A-L])\s+\|\s+(.+)$/);
    if (groupLine) {
      const group = groupLine[1];
      const groupTeams = groupLine[2].trim().split(/\s{2,}/).map(normalizeTeam);
      groups.push({ group, teams: groupTeams });
      for (const team of groupTeams) teams.push({ name: team, group });
      continue;
    }

    const section = line.match(/^▪\s+Group\s+([A-L])/);
    if (section) {
      currentGroup = section[1];
      continue;
    }

    const dateLine = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+June\s+(\d{1,2})/);
    if (dateLine) {
      currentDate = `2026-06-${dateLine[2].padStart(2, "0")}`;
      continue;
    }

    const matchLine = line.match(/^\s*(\d{1,2}:\d{2})\s+(UTC[+-]\d+)\s+(.+?)\s+v\s+(.+?)\s+@\s+(.+?)\s*$/);
    if (matchLine && currentGroup && currentDate) {
      matches.push({
        id: `G${currentGroup}-${String(matches.filter((match) => match.group === currentGroup).length + 1).padStart(2, "0")}`,
        stage: "小组赛",
        group: currentGroup,
        date: currentDate,
        time: matchLine[1],
        timezone: matchLine[2],
        homeTeam: normalizeTeam(matchLine[3]),
        awayTeam: normalizeTeam(matchLine[4]),
        city: matchLine[5].trim(),
      });
    }
  }

  return { groups, teams, matches };
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function matchK(tournament) {
  if (/FIFA World Cup/i.test(tournament)) return 60;
  if (/qualification|qualifier|Euro|Copa|Gold Cup|Asian Cup|African Cup|Nations/i.test(tournament)) return 40;
  return 22;
}

function buildRatings(results) {
  const ratings = new Map();
  const histories = new Map();
  const sorted = [...results].sort((a, b) => a.date.localeCompare(b.date));

  for (const row of sorted) {
    const home = normalizeTeam(row.home_team);
    const away = normalizeTeam(row.away_team);
    const homeScore = Number(row.home_score);
    const awayScore = Number(row.away_score);
    if (!home || !away || Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;

    const homeRating = ratings.get(home) ?? 1500;
    const awayRating = ratings.get(away) ?? 1500;
    const neutral = row.neutral === "TRUE";
    const homeAdvantage = neutral ? 0 : 55;
    const expectedHome = expectedScore(homeRating + homeAdvantage, awayRating);
    const actualHome = homeScore === awayScore ? 0.5 : homeScore > awayScore ? 1 : 0;
    const margin = Math.abs(homeScore - awayScore);
    const marginFactor = Math.log(margin + 1) * 1.35 || 1;
    const change = matchK(row.tournament) * marginFactor * (actualHome - expectedHome);

    ratings.set(home, homeRating + change);
    ratings.set(away, awayRating - change);

    for (const [team, gf, ga, result] of [
      [home, homeScore, awayScore, actualHome],
      [away, awayScore, homeScore, 1 - actualHome],
    ]) {
      if (!histories.has(team)) histories.set(team, []);
      histories.get(team).push({
        date: row.date,
        tournament: row.tournament,
        gf,
        ga,
        points: result === 1 ? 3 : result === 0.5 ? 1 : 0,
      });
    }
  }

  return { ratings, histories };
}

function scoreTeam(team, ratings, histories) {
  const games = histories.get(team) ?? [];
  const recent = games.filter((game) => game.date >= "2024-01-01").slice(-24);
  const worldCup = games.filter((game) => game.tournament === "FIFA World Cup").slice(-20);
  const recentPoints = recent.length ? recent.reduce((sum, game) => sum + game.points, 0) / (recent.length * 3) : 0.45;
  const recentGoalBalance = recent.length
    ? recent.reduce((sum, game) => sum + game.gf - game.ga, 0) / recent.length
    : 0;
  const historyPoints = worldCup.length
    ? worldCup.reduce((sum, game) => sum + game.points, 0) / (worldCup.length * 3)
    : 0.4;

  return {
    elo: Math.round(ratings.get(team) ?? 1500),
    recentScore: Math.round(Math.max(0, Math.min(100, recentPoints * 75 + 20 + recentGoalBalance * 4))),
    historyScore: Math.round(Math.max(0, Math.min(100, historyPoints * 85 + (worldCup.length ? 8 : 0)))),
    recentGames: recent.length,
    worldCupGames: worldCup.length,
    recentGoalsFor: recent.reduce((sum, game) => sum + game.gf, 0),
    recentGoalsAgainst: recent.reduce((sum, game) => sum + game.ga, 0),
  };
}

function estimateFifaRanks(teamStats) {
  return [...teamStats]
    .sort((a, b) => b.elo - a.elo)
    .map((team, index) => ({ name: team.name, rank: index + 1, source: "elo-estimate" }));
}

async function tryFetchFifaRanks(teamNames) {
  try {
    const html = await fetchText(SOURCES.fifaRanking);
    const ranks = [];
    for (const team of teamNames) {
      const names = [team, ...(TEAM_ALIASES[team] ?? [])].map((value) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      const pattern = new RegExp(`(?:rank|ranking)[^\\d]{0,40}(\\d{1,3})[^<]{0,200}(?:${names.join("|")})`, "i");
      const match = html.match(pattern);
      if (match) ranks.push({ name: team, rank: Number(match[1]), source: "fifa-page" });
    }
    return ranks;
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(rawDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });

  const [cupText, resultsText] = await Promise.all([
    fetchText(SOURCES.cup),
    fetchText(SOURCES.results),
  ]);

  await writeFile(path.join(rawDir, "cup.txt"), cupText, "utf8");
  await writeFile(path.join(rawDir, "results.csv"), resultsText, "utf8");

  const cup = parseCup(cupText);
  const results = parseCsv(resultsText);
  const { ratings, histories } = buildRatings(results);
  const teamStats = cup.teams.map((team) => ({
    ...team,
    ...scoreTeam(team.name, ratings, histories),
  }));

  const fifaPageRanks = await tryFetchFifaRanks(teamStats.map((team) => team.name));
  const fallbackRanks = estimateFifaRanks(teamStats);
  const fifaRanks = teamStats.map((team) => {
    return fifaPageRanks.find((rank) => rank.name === team.name)
      ?? fallbackRanks.find((rank) => rank.name === team.name);
  });

  const rankMap = new Map(fifaRanks.map((item) => [item.name, item]));
  const processed = {
    generatedAt: new Date().toISOString(),
    sources: SOURCES,
    groups: cup.groups,
    teams: teamStats.map((team) => ({
      ...team,
      fifaRank: rankMap.get(team.name)?.rank ?? null,
      fifaRankSource: rankMap.get(team.name)?.source ?? "unavailable",
      isHost: ["USA", "Canada", "Mexico"].includes(team.name),
    })),
    matches: cup.matches,
  };

  await writeFile(path.join(processedDir, "worldcup-data.json"), JSON.stringify(processed, null, 2), "utf8");
  await writeFile(path.join(root, "public", "worldcup-data.json"), JSON.stringify(processed, null, 2), "utf8");
  console.log(`更新完成：${processed.teams.length} 支球队，${processed.matches.length} 场小组赛。`);
}

main().catch(async (error) => {
  try {
    const cached = await readFile(path.join(processedDir, "worldcup-data.json"), "utf8");
    await writeFile(path.join(root, "public", "worldcup-data.json"), cached, "utf8");
    console.warn(`拉取失败，已沿用缓存：${error.message}`);
  } catch {
    console.error(error);
    process.exitCode = 1;
  }
});
