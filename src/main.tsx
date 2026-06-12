import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, Goal, Network, RefreshCw, Shield, Sparkles, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./styles.css";

type Group = {
  group: string;
  teams: string[];
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
  groups: Group[];
  teams: Team[];
  matches: Match[];
  tournament: TeamPrediction[];
  knockoutWindows: {
    note: string;
    rounds: KnockoutRound[];
  };
};

type Tab = "overview" | "groups" | "matches" | "knockout" | "teams";

const percent = (value: number) => `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(`${value}T12:00:00Z`));

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
      {team.name}
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
          {"group" in match ? `Group ${match.group} · ${fmtDate(match.date)} ${match.time} ${match.timezone}` : `${match.status} · ${match.seed}`}
        </span>
        <strong>{"city" in match ? match.city : "淘汰赛窗口"}</strong>
      </div>
      <div className="teams-line">
        <b>{match.homeTeam}</b>
        <span>vs</span>
        <b>{match.awayTeam}</b>
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

const tabs: Array<{ key: Tab; icon: LucideIcon; label: string }> = [
  { key: "overview", icon: Trophy, label: "总览" },
  { key: "groups", icon: Shield, label: "小组" },
  { key: "matches", icon: CalendarDays, label: "赛程" },
  { key: "knockout", icon: Network, label: "淘汰赛" },
  { key: "teams", icon: Goal, label: "球队" },
];

function App() {
  const [data, setData] = useState<PredictionPayload | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("A");
  const [selectedRound, setSelectedRound] = useState("round32");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/predictions.json")
      .then((response) => {
        if (!response.ok) throw new Error("预测数据不存在，请先运行 npm run refresh");
        return response.json();
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  const teamMap = useMemo(() => new Map(data?.teams.map((team) => [team.name, team]) ?? []), [data]);
  const predictionMap = useMemo(() => new Map(data?.tournament.map((team) => [team.team, team]) ?? []), [data]);

  const filteredMatches = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    return data.matches.filter((match) => {
      const text = `${match.homeTeam} ${match.awayTeam} ${match.city} ${match.group}`.toLowerCase();
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
          <span>模拟：{data.model.iterations.toLocaleString("zh-CN")} 次</span>
          <span>更新：{new Date(data.generatedAt).toLocaleString("zh-CN")}</span>
        </div>
      </section>

      <section className="stat-strip">
        <article>
          <span>头号热门</span>
          <strong>{favoriteTeam ? <TeamName team={favoriteTeam} /> : favorite?.team}</strong>
          <small>夺冠 {favorite ? percent(favorite.champion) : "0%"}</small>
        </article>
        <article>
          <span>赛程样本</span>
          <strong>{data.matches.length}</strong>
          <small>小组赛预测已生成</small>
        </article>
        <article>
          <span>淘汰赛窗口</span>
          <strong>{data.knockoutWindows.rounds.reduce((sum, round) => sum + round.slots, 0)}</strong>
          <small>32 强到决赛预留</small>
        </article>
        <article>
          <span>球队池</span>
          <strong>{data.teams.length}</strong>
          <small>含东道主修正</small>
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
                      <strong>{team ? <TeamName team={team} /> : item.team}</strong>
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
              <Sparkles size={20} />
              <h2>程序 vs GPT5.5</h2>
            </div>
            <div className="comparison-list">
              {data.matches.slice(0, 4).map((match) => (
                <MatchCard match={match} compact key={match.id} />
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
                </tr>
              </thead>
              <tbody>
                {group.teams.map((name) => {
                  const team = teamMap.get(name);
                  const forecast = predictionMap.get(name);
                  return (
                    <tr key={name}>
                      <td>{team ? <TeamName team={team} /> : name}</td>
                      <td>{forecast?.averageGroupPoints.toFixed(2)}</td>
                      <td>{percent(forecast?.groupFirst ?? 0)}</td>
                      <td>{percent(forecast?.round32 ?? 0)}</td>
                      <td>{percent(forecast?.champion ?? 0)}</td>
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
            return (
              <article className="team-detail" key={team.name}>
                <div>
                  <strong><TeamName team={team} /></strong>
                  <small>Group {team.group} · FIFA {team.fifaRank ?? "估算"} · Elo {team.elo}</small>
                </div>
                <div className="metric"><span>强度</span><b>{team.strength.toFixed(1)}</b></div>
                <div className="metric"><span>32 强</span><b>{percent(forecast?.round32 ?? 0)}</b></div>
                <div className="metric"><span>夺冠</span><b>{percent(forecast?.champion ?? 0)}</b></div>
                <div className="metric"><span>球员</span><b>{team.playerScore ?? "未填"}</b></div>
              </article>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
