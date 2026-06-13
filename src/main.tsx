import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  CalendarDays,
  Clock3,
  Goal,
  Network,
  RefreshCw,
  Shield,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./styles.css";

type Group = {
  group: string;
  teams: string[];
};

type Player = {
  id: string;
  name: string;
  position: string;
  subPosition: string;
  club: string;
  age: number | null;
  caps: number;
  goals: number;
  marketValue: number;
  imageUrl: string;
};

type Team = {
  name: string;
  group: string;
  elo: number;
  fifaRank: number | null;
  fifaRankSource: string;
  recentScore: number;
  historyScore: number;
  recentGames: number;
  worldCupGames: number;
  isHost: boolean;
  playerScore: number | null;
  strength: number;
  attack: number;
  defense: number;
  playerMarketValue: number | null;
  playerTopFiveValue: number | null;
  playerAverageAge: number | null;
  playerSquadSize: number;
  playerCaps: number;
  playerGoals: number;
  topPlayers: Player[];
};

type MatchPrediction = {
  homeTeam: string;
  awayTeam: string;
  homeWin: number;
  draw: number;
  awayWin: number;
  expectedGoals?: { home: number; away: number };
  predictedScore: string;
  topScores?: Array<{ score: string; probability: number }>;
  label?: string;
  basis?: string;
};

type Match = {
  id: string;
  stage: string;
  group: string;
  date: string;
  time: string;
  timezone: string;
  city: string;
  homeTeam: string;
  awayTeam: string;
  prediction: MatchPrediction;
  gpt55Prediction: MatchPrediction;
};

type TeamPrediction = {
  team: string;
  averageGroupPoints: number;
  groupFirst: number;
  groupSecond: number;
  round32: number;
  round16: number;
  quarter: number;
  semi: number;
  final: number;
  champion: number;
};

type KnockoutMatch = {
  id: string;
  seed: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  prediction: MatchPrediction;
  gpt55Prediction: MatchPrediction;
};

type KnockoutRound = {
  key: string;
  name: string;
  slots: number;
  matches: KnockoutMatch[];
};

type PredictionPayload = {
  generatedAt: string;
  model: {
    name: string;
    comparisonName: string;
    iterations: number;
    scoreMaxGoals: number;
  };
  playerData: {
    generatedAt: string | null;
    source: { sourceRepo?: string; players?: string; nationalTeams?: string } | null;
    note: string | null;
    missingTeams: string[];
  };
  groups: Group[];
  teams: Team[];
  matches: Match[];
  tournament: TeamPrediction[];
  knockoutWindows: {
    note: string;
    rounds: KnockoutRound[];
  };
};

type LiveApiGame = {
  id: string;
  home_score: string | null;
  away_score: string | null;
  home_scorers: string | null;
  away_scorers: string | null;
  group: string;
  local_date: string;
  finished: string;
  time_elapsed: string;
  type: string;
  home_team_name_en?: string;
  away_team_name_en?: string;
};

type LiveMatch = {
  id: string;
  dateKey: string;
  dateTime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  finished: boolean;
  status: "finished" | "live" | "upcoming";
  group: string;
  source: string;
  homeScorers: string[];
  awayScorers: string[];
};

type TimelineMatch = Match & {
  dateTime: Date;
  liveMatch?: LiveMatch;
  livePrediction?: MatchPrediction;
  liveAdjustmentReason?: string;
};

type TeamLiveForm = {
  team: string;
  recentMatches: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  formScore: number;
  trendLabel: string;
};

type Tab = "overview" | "groups" | "matches" | "timeline" | "knockout" | "teams";

const LIVE_SCORE_URL = "https://worldcup26.ir/get/games";
const LIVE_SOURCE_LABEL = "自动比分源，非 FIFA 官方最终确认";

const teamZh: Record<string, string> = {
  Algeria: "阿尔及利亚",
  Argentina: "阿根廷",
  Australia: "澳大利亚",
  Austria: "奥地利",
  Belgium: "比利时",
  "Bosnia & Herzegovina": "波黑",
  Brazil: "巴西",
  Canada: "加拿大",
  "Cape Verde": "佛得角",
  Colombia: "哥伦比亚",
  Croatia: "克罗地亚",
  Curaçao: "库拉索",
  "Czech Republic": "捷克",
  "DR Congo": "刚果（金）",
  Ecuador: "厄瓜多尔",
  Egypt: "埃及",
  England: "英格兰",
  France: "法国",
  Germany: "德国",
  Ghana: "加纳",
  Haiti: "海地",
  Iran: "伊朗",
  Iraq: "伊拉克",
  "Ivory Coast": "科特迪瓦",
  Japan: "日本",
  Jordan: "约旦",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Netherlands: "荷兰",
  "New Zealand": "新西兰",
  Norway: "挪威",
  Panama: "巴拿马",
  Paraguay: "巴拉圭",
  Portugal: "葡萄牙",
  Qatar: "卡塔尔",
  "Saudi Arabia": "沙特阿拉伯",
  Scotland: "苏格兰",
  Senegal: "塞内加尔",
  "South Africa": "南非",
  "South Korea": "韩国",
  Spain: "西班牙",
  Sweden: "瑞典",
  Switzerland: "瑞士",
  Tunisia: "突尼斯",
  Turkey: "土耳其",
  Uruguay: "乌拉圭",
  USA: "美国",
  Uzbekistan: "乌兹别克斯坦",
};

const apiTeamAliases: Record<string, string> = {
  "Bosnia and Herzegovina": "Bosnia & Herzegovina",
  "Cabo Verde": "Cape Verde",
  "Cape Verde": "Cape Verde",
  "Congo DR": "DR Congo",
  "Côte d'Ivoire": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "Czechia": "Czech Republic",
  "Korea Republic": "South Korea",
  "South Korea": "South Korea",
  "Türkiye": "Turkey",
  "Turkiye": "Turkey",
  "United States": "USA",
  "United States of America": "USA",
};

const displayTeam = (name: string) => teamZh[name] ?? name;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const percent = (value: number) => `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
const money = (value: number | null) => {
  if (!value) return "暂无";
  if (value >= 100000000) return `€${(value / 100000000).toFixed(2)}亿`;
  return `€${(value / 10000).toFixed(0)}万`;
};
const fmtDateTime = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

function parseTimezoneOffset(timezone: string) {
  const match = timezone.match(/^UTC([+-])(\d{1,2})$/);
  if (!match) return 0;
  return (match[1] === "+" ? 1 : -1) * Number(match[2]);
}

function normalizeApiTeam(name?: string) {
  if (!name || name === "undefined") return "";
  return apiTeamAliases[name] ?? name;
}

function parseLocalDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return new Date(value);
  const [, month, day, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function parseStaticDate(match: Match) {
  const [hour, minute] = match.time.split(":").map(Number);
  const [year, month, day] = match.date.split("-").map(Number);
  const offset = parseTimezoneOffset(match.timezone);
  return new Date(Date.UTC(year, month - 1, day, (hour || 0) - offset, minute || 0, 0, 0));
}

function localDateKey(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return value.slice(0, 10);
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

function matchKey(date: string, homeTeam: string, awayTeam: string) {
  return `${date}|${homeTeam}|${awayTeam}`;
}

function scorerList(value: string | null) {
  if (!value || value === "null") return [];
  return value
    .replace(/[{}"“”]/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function liveStatus(game: LiveApiGame): LiveMatch["status"] {
  if (game.finished === "TRUE") return "finished";
  if (game.time_elapsed && game.time_elapsed !== "notstarted" && game.time_elapsed !== "finished") return "live";
  return "upcoming";
}

function toLiveMatch(game: LiveApiGame): LiveMatch | null {
  const homeTeam = normalizeApiTeam(game.home_team_name_en);
  const awayTeam = normalizeApiTeam(game.away_team_name_en);
  if (!homeTeam || !awayTeam || game.type !== "group") return null;
  const date = parseLocalDate(game.local_date);
  return {
    id: game.id,
    dateKey: localDateKey(game.local_date),
    dateTime: date.toISOString(),
    homeTeam,
    awayTeam,
    homeScore: game.home_score === null ? null : Number(game.home_score),
    awayScore: game.away_score === null ? null : Number(game.away_score),
    finished: game.finished === "TRUE",
    status: liveStatus(game),
    group: game.group,
    source: LIVE_SOURCE_LABEL,
    homeScorers: scorerList(game.home_scorers),
    awayScorers: scorerList(game.away_scorers),
  };
}

function softmax(values: number[]) {
  const max = Math.max(...values);
  const scores = values.map((value) => Math.exp(value - max));
  const total = scores.reduce((sum, value) => sum + value, 0);
  return scores.map((value) => value / total);
}

function pickScoreForOutcome(prediction: MatchPrediction, outcome: "home" | "draw" | "away") {
  const score = prediction.topScores?.find((item) => {
    const [home, away] = item.score.split("-").map(Number);
    if (outcome === "home") return home > away;
    if (outcome === "away") return away > home;
    return home === away;
  });
  if (score) return score.score;
  if (outcome === "home") return "1-0";
  if (outcome === "away") return "0-1";
  return "1-1";
}

function expectedPointsFor(match: Match, team: string) {
  if (match.homeTeam === team) return match.prediction.homeWin * 3 + match.prediction.draw;
  if (match.awayTeam === team) return match.prediction.awayWin * 3 + match.prediction.draw;
  return 1;
}

function actualPointsFor(live: LiveMatch, team: string) {
  if (live.homeScore === null || live.awayScore === null) return 0;
  const goalsFor = live.homeTeam === team ? live.homeScore : live.awayScore;
  const goalsAgainst = live.homeTeam === team ? live.awayScore : live.homeScore;
  if (goalsFor > goalsAgainst) return 3;
  if (goalsFor === goalsAgainst) return 1;
  return 0;
}

function computeTeamForms(matches: TimelineMatch[]) {
  const byTeam = new Map<string, Array<{ live: LiveMatch; match: Match }>>();
  matches
    .filter((match) => match.liveMatch?.finished)
    .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime())
    .forEach((match) => {
      const live = match.liveMatch!;
      for (const team of [live.homeTeam, live.awayTeam]) {
        if (!byTeam.has(team)) byTeam.set(team, []);
        byTeam.get(team)!.push({ live, match });
      }
    });

  const forms = new Map<string, TeamLiveForm>();
  for (const [team, games] of byTeam.entries()) {
    const recent = games.slice(-5);
    let points = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let expectationDelta = 0;

    recent.forEach(({ live, match }) => {
      if (live.homeScore === null || live.awayScore === null) return;
      const isHome = live.homeTeam === team;
      const gf = isHome ? live.homeScore : live.awayScore;
      const ga = isHome ? live.awayScore : live.homeScore;
      goalsFor += gf;
      goalsAgainst += ga;
      const actual = actualPointsFor(live, team);
      points += actual;
      expectationDelta += actual - expectedPointsFor(match, team);
    });

    const recentMatches = recent.length;
    const goalDifference = goalsFor - goalsAgainst;
    const pointsRate = recentMatches ? points / (recentMatches * 3) : 0.5;
    const goalDiffPerMatch = recentMatches ? goalDifference / recentMatches : 0;
    const goalsForPerMatch = recentMatches ? goalsFor / recentMatches : 0;
    const goalsAgainstPerMatch = recentMatches ? goalsAgainst / recentMatches : 0;
    const expectationPerMatch = recentMatches ? expectationDelta / recentMatches : 0;
    const formScore = clamp(
      50 + (pointsRate - 0.5) * 34 + goalDiffPerMatch * 8 + goalsForPerMatch * 3 - goalsAgainstPerMatch * 3 + expectationPerMatch * 8,
      15,
      90,
    );

    forms.set(team, {
      team,
      recentMatches,
      points,
      goalsFor,
      goalsAgainst,
      goalDifference,
      formScore: Number(formScore.toFixed(1)),
      trendLabel: formScore >= 70 ? "火热" : formScore >= 58 ? "上升" : formScore >= 45 ? "平稳" : "低迷",
    });
  }

  return forms;
}

function livePredict(match: Match, forms: Map<string, TeamLiveForm>) {
  const homeForm = forms.get(match.homeTeam);
  const awayForm = forms.get(match.awayTeam);
  const homeScore = homeForm?.formScore ?? 50;
  const awayScore = awayForm?.formScore ?? 50;
  const formBias = ((homeScore - awayScore) / 100) * 0.75;
  const drawPenalty = Math.abs(homeScore - awayScore) > 18 ? 0.12 : 0;
  const [homeWin, draw, awayWin] = softmax([
    Math.log(match.prediction.homeWin) + formBias,
    Math.log(match.prediction.draw) - drawPenalty,
    Math.log(match.prediction.awayWin) - formBias,
  ]);
  const outcome = homeWin >= draw && homeWin >= awayWin ? "home" : awayWin >= draw ? "away" : "draw";
  const reason = `${displayTeam(match.homeTeam)}近期${homeForm?.trendLabel ?? "暂无样本"}，${displayTeam(match.awayTeam)}近期${awayForm?.trendLabel ?? "暂无样本"}`;

  return {
    prediction: {
      ...match.prediction,
      homeWin: Number(homeWin.toFixed(4)),
      draw: Number(draw.toFixed(4)),
      awayWin: Number(awayWin.toFixed(4)),
      predictedScore: pickScoreForOutcome(match.prediction, outcome),
      label: "动态重预测",
    },
    reason,
  };
}

function ProbabilityBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="probability">
      <div className="probability__label">
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${Math.max(value * 100, 1)}%` }} />
      </div>
    </div>
  );
}

function TeamName({ team }: { team: Team }) {
  return (
    <span className="team-name">
      {displayTeam(team.name)}
      {team.isHost ? <span className="host">东道主</span> : null}
    </span>
  );
}

function PredictionCard({
  title,
  prediction,
  accent = false,
}: {
  title: string;
  prediction: MatchPrediction;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "prediction-card prediction-card--accent" : "prediction-card"}>
      <span>{title}</span>
      <strong>{prediction.predictedScore}</strong>
      <small>
        主 {percent(prediction.homeWin)} · 平 {percent(prediction.draw)} · 客 {percent(prediction.awayWin)}
      </small>
    </div>
  );
}

function MatchCard({ match, compact = false }: { match: Match | KnockoutMatch; compact?: boolean }) {
  return (
    <article className={compact ? "match-card match-card--compact" : "match-card"}>
      <div className="match-head">
        <span>
          {"group" in match ? `Group ${match.group} · 北京时间 ${fmtDateTime(parseStaticDate(match))}` : `${match.status} · ${match.seed}`}
        </span>
        <strong>{"city" in match ? `${match.city} · 当地 ${match.time} ${match.timezone}` : "淘汰赛窗口"}</strong>
      </div>
      <div className="teams-line">
        <b>{displayTeam(match.homeTeam)}</b>
        <span>vs</span>
        <b>{displayTeam(match.awayTeam)}</b>
      </div>
      <div className="prediction-compare">
        <PredictionCard title="程序预测" prediction={match.prediction} />
        <PredictionCard title="GPT5.5预测" prediction={match.gpt55Prediction} accent />
      </div>
      {!compact ? (
        <div className="prob-grid">
          <ProbabilityBar label="程序主胜" value={match.prediction.homeWin} />
          <ProbabilityBar label="程序平局" value={match.prediction.draw} />
          <ProbabilityBar label="程序客胜" value={match.prediction.awayWin} />
        </div>
      ) : null}
    </article>
  );
}

function RecentMatchCard({ match }: { match: TimelineMatch }) {
  const live = match.liveMatch!;
  return (
    <article className="recent-card">
      <div className="match-head">
        <span>Group {match.group} · {fmtDateTime(match.dateTime)}</span>
        <strong>已完赛</strong>
      </div>
      <div className="live-score">
        <b>{displayTeam(live.homeTeam)}</b>
        <span>{live.homeScore} - {live.awayScore}</span>
        <b>{displayTeam(live.awayTeam)}</b>
      </div>
      <small>{[...live.homeScorers, ...live.awayScorers].slice(0, 4).join(" · ") || LIVE_SOURCE_LABEL}</small>
    </article>
  );
}

function TimelineCard({ match, isNear }: { match: TimelineMatch; isNear: boolean }) {
  const live = match.liveMatch;
  const status = live?.finished ? "已完赛" : live?.status === "live" ? "进行中" : "未开赛";
  return (
    <article className={isNear ? "timeline-card timeline-card--near" : "timeline-card"}>
      <div className="timeline-time">
        <strong>{fmtDateTime(match.dateTime)}</strong>
        <span className={`status-pill status-pill--${live?.status ?? "upcoming"}`}>{status}</span>
      </div>
      <div className="timeline-body">
        <div className="teams-line">
          <b>{displayTeam(match.homeTeam)}</b>
          <span>{live?.finished ? `${live.homeScore}-${live.awayScore}` : "vs"}</span>
          <b>{displayTeam(match.awayTeam)}</b>
        </div>
        <small>Group {match.group} · {match.city}</small>
        {live?.finished ? (
          <div className="prediction-compare">
            <PredictionCard title="原程序预测" prediction={match.prediction} />
            <PredictionCard title="GPT5.5预测" prediction={match.gpt55Prediction} accent />
          </div>
        ) : (
          <>
            <div className="prediction-compare">
              <PredictionCard title="动态重预测" prediction={match.livePrediction ?? match.prediction} accent />
              <PredictionCard title="原程序预测" prediction={match.prediction} />
            </div>
            <small className="live-reason">{match.liveAdjustmentReason ?? "暂无已完赛样本，沿用静态预测。"}</small>
          </>
        )}
      </div>
    </article>
  );
}

const tabs: Array<{ key: Tab; icon: LucideIcon; label: string }> = [
  { key: "overview", icon: Trophy, label: "总览" },
  { key: "groups", icon: Shield, label: "小组" },
  { key: "matches", icon: CalendarDays, label: "赛程" },
  { key: "timeline", icon: Clock3, label: "时间轴" },
  { key: "knockout", icon: Network, label: "淘汰赛" },
  { key: "teams", icon: Goal, label: "球队" },
];

function App() {
  const [data, setData] = useState<PredictionPayload | null>(null);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("A");
  const [selectedRound, setSelectedRound] = useState("round32");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}predictions.json`)
      .then((response) => {
        if (!response.ok) throw new Error("预测数据不存在，请先运行 npm run refresh");
        return response.json();
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    fetch(LIVE_SCORE_URL)
      .then((response) => {
        if (!response.ok) throw new Error("实时比分源暂时不可用");
        return response.json();
      })
      .then((payload: { games?: LiveApiGame[] }) => {
        const parsed = (payload.games ?? []).map(toLiveMatch).filter((match): match is LiveMatch => Boolean(match));
        setLiveMatches(parsed);
        setLiveUpdatedAt(new Date().toISOString());
        setLiveError("");
      })
      .catch((err: Error) => {
        setLiveError(err.message);
        setLiveMatches([]);
      });
  }, []);

  const teamMap = useMemo(() => new Map(data?.teams.map((team) => [team.name, team]) ?? []), [data]);
  const predictionMap = useMemo(() => new Map(data?.tournament.map((team) => [team.team, team]) ?? []), [data]);

  const liveByKey = useMemo(() => {
    const map = new Map<string, LiveMatch>();
    liveMatches.forEach((match) => {
      map.set(matchKey(match.dateKey, match.homeTeam, match.awayTeam), match);
    });
    return map;
  }, [liveMatches]);

  const timelineSeed = useMemo<TimelineMatch[]>(() => {
    if (!data) return [];
    return data.matches
      .map((match) => {
        const dateTime = parseStaticDate(match);
        const liveMatch = liveByKey.get(matchKey(match.date, match.homeTeam, match.awayTeam));
        return { ...match, dateTime, liveMatch };
      })
      .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
  }, [data, liveByKey]);

  const teamForms = useMemo(() => computeTeamForms(timelineSeed), [timelineSeed]);

  const timelineMatches = useMemo<TimelineMatch[]>(
    () =>
      timelineSeed.map((match) => {
        if (match.liveMatch?.finished) return match;
        const live = livePredict(match, teamForms);
        return {
          ...match,
          livePrediction: live.prediction,
          liveAdjustmentReason: live.reason,
        };
      }),
    [teamForms, timelineSeed],
  );

  const finishedMatches = useMemo(
    () =>
      timelineMatches
        .filter((match) => match.liveMatch?.finished)
        .sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime()),
    [timelineMatches],
  );

  const recentMatches = useMemo(
    () => finishedMatches.slice(0, 5),
    [finishedMatches],
  );
  const nextUpcomingIndex = useMemo(() => timelineMatches.findIndex((match) => !match.liveMatch?.finished), [timelineMatches]);

  const filteredMatches = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    return data.matches.filter((match) => {
      const text = `${match.homeTeam} ${match.awayTeam} ${displayTeam(match.homeTeam)} ${displayTeam(match.awayTeam)} ${match.city} ${match.group}`.toLowerCase();
      return !key || text.includes(key);
    });
  }, [data, query]);

  if (error) {
    return (
      <main className="empty">
        <Shield size={42} />
        <h1>缺少预测数据</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="empty">
        <RefreshCw className="spin" size={42} />
        <h1>正在加载预测数据</h1>
      </main>
    );
  }

  const championTop = data.tournament.slice(0, 6);
  const strongest = data.teams.slice(0, 8);
  const group = data.groups.find((item) => item.group === selectedGroup) ?? data.groups[0];
  const selectedKnockoutRound =
    data.knockoutWindows.rounds.find((round) => round.key === selectedRound) ?? data.knockoutWindows.rounds[0];
  const favorite = championTop[0];
  const favoriteTeam = favorite ? teamMap.get(favorite.team) : undefined;

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">2026 FIFA World Cup</p>
          <h1>AI 胜率与比分预测</h1>
        </div>
        <div className="meta">
          <span>程序模型：Elo + 近况 + Poisson</span>
          <span>对照：GPT5.5预测</span>
          <span>球员源：Transfermarkt</span>
          <span>实时比分：{liveError ? "回退静态" : liveUpdatedAt ? "已接入" : "连接中"}</span>
          <span>模拟：{data.model.iterations.toLocaleString("zh-CN")} 次</span>
        </div>
      </section>

      <section className="stat-strip">
        <article>
          <span>头号热门</span>
          <strong>{favoriteTeam ? <TeamName team={favoriteTeam} /> : displayTeam(favorite?.team ?? "")}</strong>
          <small>夺冠 {favorite ? percent(favorite.champion) : "0%"}</small>
        </article>
        <article>
          <span>已完赛</span>
          <strong>{finishedMatches.length}</strong>
          <small>{liveUpdatedAt ? `比分更新 ${new Date(liveUpdatedAt).toLocaleTimeString("zh-CN")}` : LIVE_SOURCE_LABEL}</small>
        </article>
        <article>
          <span>赛程样本</span>
          <strong>{data.matches.length}</strong>
          <small>小组赛按时间轴排序</small>
        </article>
        <article>
          <span>淘汰赛窗口</span>
          <strong>{data.knockoutWindows.rounds.reduce((sum, round) => sum + round.slots, 0)}</strong>
          <small>32 强到决赛预留</small>
        </article>
        <article>
          <span>球员数据</span>
          <strong>{data.playerData.missingTeams.length ? `${data.playerData.missingTeams.length}缺` : "完整"}</strong>
          <small>{data.playerData.generatedAt ? new Date(data.playerData.generatedAt).toLocaleDateString("zh-CN") : "未生成"}</small>
        </article>
      </section>

      <nav className="tabs" aria-label="视图切换">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <section className="layout layout--overview">
          <div className="panel">
            <div className="panel-title">
              <Trophy size={20} />
              <h2>夺冠概率前六</h2>
            </div>
            <div className="champion-list">
              {championTop.map((item, index) => {
                const team = teamMap.get(item.team);
                return (
                  <article className="rank-row" key={item.team}>
                    <span className="rank">{index + 1}</span>
                    <div>
                      <strong>{team ? <TeamName team={team} /> : displayTeam(item.team)}</strong>
                      <small>决赛 {percent(item.final)} · 四强 {percent(item.semi)}</small>
                    </div>
                    <b>{percent(item.champion)}</b>
                  </article>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title">
              <Activity size={20} />
              <h2>近期比赛</h2>
            </div>
            <div className="recent-grid">
              {recentMatches.length ? recentMatches.map((match) => <RecentMatchCard match={match} key={match.id} />) : (
                <div className="empty-round">
                  <p>{liveError ? `实时比分暂不可用：${liveError}` : "暂无已完赛比赛，页面会在比分源返回结果后自动显示。"}</p>
                </div>
              )}
            </div>
          </div>
          <div className="panel panel--wide">
            <div className="panel-title">
              <Sparkles size={20} />
              <h2>动态重预测样本</h2>
            </div>
            <div className="comparison-list">
              {timelineMatches.filter((match) => !match.liveMatch?.finished).slice(0, 4).map((match) => (
                <TimelineCard match={match} isNear={false} key={match.id} />
              ))}
            </div>
          </div>
          <div className="panel panel--wide">
            <div className="panel-title">
              <Shield size={20} />
              <h2>综合强度</h2>
            </div>
            <div className="strength-grid">
              {strongest.map((team) => (
                <article className="team-card" key={team.name}>
                  <strong><TeamName team={team} /></strong>
                  <span>{team.strength.toFixed(1)}</span>
                  <small>Elo {team.elo} · 近况 {team.recentScore} · 历史 {team.historyScore}</small>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "groups" ? (
        <section className="layout">
          <div className="group-switch">
            {data.groups.map((item) => (
              <button key={item.group} className={selectedGroup === item.group ? "active" : ""} onClick={() => setSelectedGroup(item.group)}>
                {item.group}
              </button>
            ))}
          </div>
          <div className="panel table-panel">
            <div className="panel-title">
              <Shield size={20} />
              <h2>Group {group.group}</h2>
            </div>
            <table>
              <thead>
                <tr>
                  <th>球队</th>
                  <th>预计积分</th>
                  <th>小组第一</th>
                  <th>32 强</th>
                  <th>夺冠</th>
                  <th>实时状态</th>
                </tr>
              </thead>
              <tbody>
                {group.teams.map((name) => {
                  const team = teamMap.get(name);
                  const forecast = predictionMap.get(name);
                  const form = teamForms.get(name);
                  return (
                    <tr key={name}>
                      <td>{team ? <TeamName team={team} /> : displayTeam(name)}</td>
                      <td>{forecast?.averageGroupPoints.toFixed(2)}</td>
                      <td>{percent(forecast?.groupFirst ?? 0)}</td>
                      <td>{percent(forecast?.round32 ?? 0)}</td>
                      <td>{percent(forecast?.champion ?? 0)}</td>
                      <td>{form ? `${form.trendLabel} ${form.formScore}` : "暂无样本"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "matches" ? (
        <section className="layout">
          <div className="toolbar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索球队、城市或小组" />
          </div>
          <div className="match-list">
            {filteredMatches.map((match) => (
              <MatchCard match={match} key={match.id} />
            ))}
          </div>
        </section>
      ) : null}

      {tab === "timeline" ? (
        <section className="layout">
          <div className="live-source">
            <strong>{LIVE_SOURCE_LABEL}</strong>
            <span>{liveError ? `实时拉取失败，当前使用静态预测：${liveError}` : `已完赛 ${finishedMatches.length} 场，未来比赛已按近期状态动态修正。`}</span>
          </div>
          <div className="recent-grid">
            {recentMatches.map((match) => <RecentMatchCard match={match} key={match.id} />)}
          </div>
          <div className="timeline-list">
            {timelineMatches.map((match, index) => (
              <TimelineCard match={match} isNear={index === nextUpcomingIndex || index === nextUpcomingIndex - 1} key={match.id} />
            ))}
          </div>
        </section>
      ) : null}

      {tab === "knockout" ? (
        <section className="layout">
          <div className="round-switch">
            {data.knockoutWindows.rounds.map((round) => (
              <button
                key={round.key}
                className={selectedRound === round.key ? "active" : ""}
                onClick={() => setSelectedRound(round.key)}
              >
                {round.name}
              </button>
            ))}
          </div>
          <div className="knockout-note">{data.knockoutWindows.note}</div>
          {selectedKnockoutRound.matches.length ? (
            <div className="match-list">
              {selectedKnockoutRound.matches.map((match) => (
                <MatchCard match={match} compact key={match.id} />
              ))}
            </div>
          ) : (
            <div className="empty-round">
              <Network size={38} />
              <h2>{selectedKnockoutRound.name}窗口已预留</h2>
              <p>这里保留 {selectedKnockoutRound.slots} 场位置，等官方对阵或小组赛结果产生后直接填充。</p>
            </div>
          )}
        </section>
      ) : null}

      {tab === "teams" ? (
        <section className="team-table">
          {data.teams.map((team) => {
            const forecast = predictionMap.get(team.name);
            const form = teamForms.get(team.name);
            return (
              <article className="team-detail" key={team.name}>
                <div>
                  <strong><TeamName team={team} /></strong>
                  <small>Group {team.group} · FIFA {team.fifaRank ?? "估算"} · Elo {team.elo}</small>
                </div>
                <div className="metric"><span>强度</span><b>{team.strength.toFixed(1)}</b></div>
                <div className="metric"><span>状态</span><b>{form ? form.trendLabel : "暂无"}</b></div>
                <div className="metric"><span>32 强</span><b>{percent(forecast?.round32 ?? 0)}</b></div>
                <div className="metric"><span>夺冠</span><b>{percent(forecast?.champion ?? 0)}</b></div>
                <div className="metric"><span>球员</span><b>{team.playerScore?.toFixed(1) ?? "暂无"}</b></div>
                <div className="metric"><span>身价</span><b>{money(team.playerMarketValue)}</b></div>
                <div className="player-list">
                  {team.topPlayers.slice(0, 5).map((player) => (
                    <span key={player.id}>
                      {player.name} · {player.subPosition || player.position} · {money(player.marketValue)}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
