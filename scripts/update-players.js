import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

const root = process.cwd();
const rawDir = path.join(root, "data", "raw");
const dataPath = path.join(root, "data", "processed", "worldcup-data.json");
const outputPath = path.join(root, "data", "player-ratings.json");

const SOURCES = {
  players: "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz",
  nationalTeams: "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/national_teams.csv.gz",
  sourceRepo: "https://github.com/dcaribou/transfermarkt-datasets",
};

const TEAM_ALIASES = {
  "Bosnia & Herzegovina": ["Bosnia-Herzegovina", "Bosnia and Herzegovina"],
  "Cape Verde": ["Cabo Verde"],
  "Czech Republic": ["Czech Republic", "Czechia"],
  "DR Congo": ["Congo DR", "Democratic Republic of the Congo", "DR Congo"],
  "Ivory Coast": ["Cote d'Ivoire", "Côte d'Ivoire"],
  "South Korea": ["Korea, South", "Korea Republic", "South Korea"],
  Turkey: ["Türkiye", "Turkiye", "Turkey"],
  USA: ["United States", "United States of America", "USA"],
  Curaçao: ["Curacao", "Curaçao"],
};

const CITIZENSHIP_ALIASES = {
  "DR Congo": ["DR Congo", "Congo DR", "Congo", "Democratic Republic of the Congo"],
  "Ivory Coast": ["Cote d'Ivoire", "Côte d'Ivoire", "Ivory Coast"],
  Curaçao: ["Curacao", "Curaçao", "Netherlands Antilles"],
  "Cape Verde": ["Cape Verde", "Cabo Verde"],
};

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function aliasesFor(team) {
  return [team, ...(TEAM_ALIASES[team] ?? [])].map(norm);
}

async function fetchBinary(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "worldcup-ai-predictor/0.1" },
  });
  if (!res.ok) throw new Error(`${url} ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchBinaryWithCache(url, fileName) {
  const cachePath = path.join(rawDir, fileName);
  try {
    const buffer = await fetchBinary(url);
    await writeFile(cachePath, buffer);
    return buffer;
  } catch (error) {
    try {
      const cached = await readFile(cachePath);
      console.warn(`拉取失败，沿用缓存 ${fileName}：${error.message}`);
      return cached;
    } catch {
      throw error;
    }
  }
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function age(dateOfBirth) {
  if (!dateOfBirth) return null;
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.UTC(2026, 5, 11) - date.getTime()) / 365.25 / 24 / 60 / 60 / 1000);
}

function percentile(value, min, max) {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function positionBuckets(players) {
  return players.reduce((acc, player) => {
    acc[player.position] = (acc[player.position] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  await mkdir(rawDir, { recursive: true });
  const worldcup = JSON.parse(await readFile(dataPath, "utf8"));

  const [playersGz, nationalTeamsGz] = await Promise.all([
    fetchBinaryWithCache(SOURCES.players, "players.csv.gz"),
    fetchBinaryWithCache(SOURCES.nationalTeams, "national_teams.csv.gz"),
  ]);

  const players = parseCsv(gunzipSync(playersGz).toString("utf8"));
  const nationalTeams = parseCsv(gunzipSync(nationalTeamsGz).toString("utf8"));
  const teamIdByName = new Map();

  for (const team of nationalTeams) {
    for (const key of [team.name, team.country_name]) {
      if (key) teamIdByName.set(norm(key), team.national_team_id);
    }
  }

  const rawTeams = {};
  const missing = [];

  for (const team of worldcup.teams) {
    const teamId = aliasesFor(team.name).map((key) => teamIdByName.get(key)).find(Boolean);
    const citizenshipAliases = [...aliasesFor(team.name), ...(CITIZENSHIP_ALIASES[team.name] ?? []).map(norm)];

    const squad = players
      .filter((player) => {
        if (teamId && player.current_national_team_id === teamId) return true;
        return citizenshipAliases.includes(norm(player.country_of_citizenship));
      })
      .filter((player) => number(player.market_value_in_eur) > 0)
      .sort((a, b) => number(b.market_value_in_eur) - number(a.market_value_in_eur))
      .slice(0, 26)
      .map((player) => ({
        id: player.player_id,
        name: player.name,
        position: player.position || "Unknown",
        subPosition: player.sub_position || "",
        club: player.current_club_name || "",
        age: age(player.date_of_birth),
        caps: number(player.international_caps),
        goals: number(player.international_goals),
        marketValue: number(player.market_value_in_eur),
        imageUrl: player.image_url || "",
      }));

    const marketValue = squad.reduce((sum, player) => sum + player.marketValue, 0);
    if (!squad.length) {
      missing.push(team.name);
      continue;
    }
    const topFiveValue = squad.slice(0, 5).reduce((sum, player) => sum + player.marketValue, 0);
    const caps = squad.reduce((sum, player) => sum + player.caps, 0);
    const goals = squad.reduce((sum, player) => sum + player.goals, 0);
    const ages = squad.map((player) => player.age).filter((value) => typeof value === "number");
    const averageAge = ages.length ? ages.reduce((sum, value) => sum + value, 0) / ages.length : null;

    rawTeams[team.name] = {
      sourceTeamId: teamId,
      squadSize: squad.length,
      marketValue,
      topFiveValue,
      caps,
      goals,
      averageAge,
      positionBuckets: positionBuckets(squad),
      players: squad,
    };
  }

  const values = Object.values(rawTeams);
  const ranges = {
    marketValue: [Math.min(...values.map((item) => Math.log1p(item.marketValue))), Math.max(...values.map((item) => Math.log1p(item.marketValue)))],
    topFiveValue: [Math.min(...values.map((item) => Math.log1p(item.topFiveValue))), Math.max(...values.map((item) => Math.log1p(item.topFiveValue)))],
    caps: [Math.min(...values.map((item) => item.caps)), Math.max(...values.map((item) => item.caps))],
    goals: [Math.min(...values.map((item) => item.goals)), Math.max(...values.map((item) => item.goals))],
  };

  const teams = Object.fromEntries(Object.entries(rawTeams).map(([name, item]) => {
    const marketScore = percentile(Math.log1p(item.marketValue), ...ranges.marketValue);
    const starScore = percentile(Math.log1p(item.topFiveValue), ...ranges.topFiveValue);
    const capsScore = percentile(item.caps, ...ranges.caps);
    const goalsScore = percentile(item.goals, ...ranges.goals);
    const ageScore = item.averageAge === null ? 50 : Math.max(0, 100 - Math.abs(item.averageAge - 27.5) * 8);
    const balancePenalty = item.positionBuckets.Goalkeeper ? 0 : 6;
    const score = Math.max(1, Math.min(99,
      marketScore * 0.42 + starScore * 0.24 + capsScore * 0.16 + goalsScore * 0.1 + ageScore * 0.08 - balancePenalty,
    ));

    return [name, {
      ...item,
      score: Number(score.toFixed(2)),
      marketValue: Math.round(item.marketValue),
      topFiveValue: Math.round(item.topFiveValue),
      averageAge: item.averageAge === null ? null : Number(item.averageAge.toFixed(1)),
      topPlayers: item.players.slice(0, 8),
    }];
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: SOURCES,
    note: "按 Transfermarkt 公开整理数据中 current_national_team_id 归属，选取每队身价最高的 26 名球员生成评分；不是 FIFA 官方最终报名名单。",
    missingTeams: missing,
    teams,
  };

  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`球员数据完成：${Object.keys(teams).length} 支球队，缺失 ${missing.length} 支。`);
  if (missing.length) console.log(`缺失：${missing.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
