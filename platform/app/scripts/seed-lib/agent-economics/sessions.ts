/**
 * `coding_agent_sessions` and `coding_agent_session_events` rows for the main
 * user and five peer engineers, shaped so the /me econ boards' documented
 * production queries return the prototype's magnitudes.
 *
 * The bulk of sessions are routine; a handful of last-week sessions are planted
 * to satisfy the exact leak-ledger targets (a 667k runaway, 141 calls over
 * 450k across two sessions, 19 cache rebuilds, 21 rate-limit retries).
 */
import { createHash } from "node:crypto";

import { DAY_MS, utcDayStart } from "./dates";
import { Rng } from "./prng";
import type { PrSpec } from "./pull-requests";
import { REPOS } from "./pull-requests";

export interface Engineer {
  userId: string;
  name: string;
  githubLogin: string;
  isMain: boolean;
}

export interface SessionsConfig {
  tenantId: string;
  version: string;
  agentVersion: string;
  todayMs: number;
  historyDays: number;
  engineers: Engineer[];
  /** all PRs, keyed later by author login → branch for linking */
  prs: PrSpec[];
}

/* Loosely typed rows: keys are the exact ClickHouse column names. */
export type SessionRow = Record<string, unknown>;
export type EventRow = Record<string, unknown>;

const MODELS: [string, number][] = [
  ["claude-fable-5-1", 0.5],
  ["claude-sonnet-5", 0.35],
  ["gpt-5-mini", 0.15],
];
const SUBAGENT_TYPES = ["Explore", "Plan", "general-purpose", "claude"] as const;
const SKILLS = ["drive-pr", "browser-qa", "orchestrate"] as const;
const MCP_SERVERS = ["posthog", "grafana", "playwright", "computer-use"] as const;
const TITLE_POOL = [
  "Fix flaky checkout test",
  "Overnight: test-suite triage",
  "Trace the rollup OOM",
  "Refactor the billing retries",
  "Wire the finops usage table",
  "Chase the dashboard widget id bug",
  "Drive PR to green",
  "Browser-QA the scope picker",
  "Backfill team-user mapping",
  "Rebuild the cache-hit gauge",
  "Split integration test lanes",
  "Harden the refund idempotency key",
  "Investigate the 429 storm",
  "Cut SDK cold-start graph",
  "Tag error-path scenarios",
];

/** Per-call round-trip tooling, name → [p50 ms, typical result bytes]. */
const TOOL_SPEED: Record<string, [number, number]> = {
  Read: [200, 40_000],
  Edit: [300, 6_000],
  "Bash(pnpm test)": [41_000, 96_000],
  "Bash(git diff)": [1_500, 34_000],
  Agent: [30_000, 13_000],
  "mcp:posthog query": [4_200, 9_000],
  gh: [1_800, 8_000],
  kanban: [400, 3_000],
  memo: [500, 2_000],
  pnpm: [41_000, 20_000],
};
const TOOL_NAMES = Object.keys(TOOL_SPEED);

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
function traceId(sessionId: string): string {
  return sha256(`trace:${sessionId}`).slice(0, 32);
}

/** Daily p50 context in K tokens: slowly improving discipline, ~205k → ~180k. */
function dayP50K(dayFromStart: number, totalDays: number, rng: Rng): number {
  const drift = Math.max(0, dayFromStart - (totalDays - 30)) * 0.8;
  return rng.jitter(205 - drift, 0.18);
}

/** Cost of one model call from its context band (CALL_COST_BANDS), jittered. */
function callCost(ctxTokens: number, rng: Rng): number {
  const k = ctxTokens / 1000;
  const base = k < 100 ? 0.077 : k < 200 ? 0.13 : k < 400 ? 0.25 : 0.44;
  return rng.jitter(base, 0.25);
}

interface CallTokens {
  ctx: number;
  cacheRead: number;
  cacheCreation: number;
  fresh: number;
  output: number;
}
function splitTokens(ctxTokens: number, rng: Rng): CallTokens {
  const hit = rng.jitter(0.885, 0.03); // 85–92% cache hit
  const cacheRead = Math.round(ctxTokens * Math.min(0.94, hit));
  const cacheCreation = Math.round(ctxTokens * rng.jitter(0.02, 0.3));
  const fresh = Math.max(0, ctxTokens - cacheRead - cacheCreation);
  const output = rng.int(180, 1500);
  return { ctx: ctxTokens, cacheRead, cacheCreation, fresh, output };
}

interface BuiltSession {
  session: SessionRow;
  events: EventRow[];
  startedAtMs: number;
  isMainUser: boolean;
  weekIndexFromToday: number; // 0 = this week
  commitsCap: number;
}

export interface BuildResult {
  sessions: SessionRow[];
  events: EventRow[];
}

export function buildSessions(cfg: SessionsConfig): BuildResult {
  const today = utcDayStart(cfg.todayMs);
  const built: BuiltSession[] = [];

  for (const eng of cfg.engineers) {
    const engPrs = cfg.prs.filter((p) => p.authorLogin === eng.githubLogin);
    const days = cfg.historyDays;
    for (let d = 0; d < days; d++) {
      const dayStart = today - (days - 1 - d) * DAY_MS;
      const dow = new Date(dayStart).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const dayRng = new Rng(`sess:${eng.userId}:${d}`);
      let n: number;
      if (eng.isMain) n = weekend ? dayRng.int(0, 2) : dayRng.int(3, 8);
      else n = weekend ? dayRng.int(0, 1) : dayRng.int(0, 2);
      for (let i = 0; i < n; i++) {
        const overnight = eng.isMain && dayRng.chance(0.06);
        built.push(
          buildOneSession({ cfg, eng, engPrs, dayStart, index: i, overnight, dayFromStart: d, totalDays: days, today }),
        );
      }
    }
  }

  // Post-process the MAIN user's recent windows to hit the exact leak targets.
  const mainSessions = built.filter((b) => b.isMainUser).sort((a, b) => a.startedAtMs - b.startedAtMs);
  applyCommitBudget(mainSessions, today);
  plantLastWeekTargets(cfg, mainSessions, today);

  const sessions: SessionRow[] = [];
  const events: EventRow[] = [];
  for (const b of built) {
    sessions.push(b.session);
    for (const e of b.events) events.push(e);
  }
  return { sessions, events };
}

interface OneSessionArgs {
  cfg: SessionsConfig;
  eng: Engineer;
  engPrs: PrSpec[];
  dayStart: number;
  index: number;
  overnight: boolean;
  dayFromStart: number;
  totalDays: number;
  today: number;
}

function buildOneSession(a: OneSessionArgs): BuiltSession {
  const { cfg, eng, engPrs, dayStart, index, overnight } = a;
  const sessionId = `caes-${eng.userId}-${dayStart}-${index}`;
  const rng = new Rng(`session:${sessionId}`);

  // Link to a PR branch when one exists near this day, else exploration.
  const linkedPr = engPrs.find(
    (p) => Math.abs(utcDayStart(p.prCreatedAtMs) - dayStart) <= 3 * DAY_MS && rng.chance(0.7),
  );
  const repo = linkedPr ? linkedPr.repositoryFullName.split("/")[1]! : rng.pick(REPOS);
  const branch = linkedPr ? linkedPr.headBranch : rng.chance(0.4) ? `wip/${sessionId.slice(-6)}` : "";

  const startHour = overnight ? rng.int(0, 4) : rng.int(8, 21);
  const startedAtMs = dayStart + (startHour * 60 + rng.int(0, 59)) * 60_000;

  const model = rng.weighted(MODELS);
  const usesSkill = rng.chance(0.35);
  const skills = usesSkill ? [rng.pick(SKILLS)] : [];
  const isFork = eng.isMain && rng.chance(0.12);
  const subagentTypes: string[] = [];
  const subCount = rng.int(0, isFork ? 3 : 2);
  for (let s = 0; s < subCount; s++) subagentTypes.push(rng.pick(SUBAGENT_TYPES));
  const mcpUsed = rng.chance(0.5) ? [rng.pick(MCP_SERVERS)] : [];

  // Model calls for this session (STEPS p50≈11, long tail).
  const modelCalls = eng.isMain ? Math.max(3, Math.round(rng.burst(11, 0.7, 0.08, 5))) : rng.int(2, 12);
  const p50k = dayP50K(a.dayFromStart, a.totalDays, rng);

  const events: EventRow[] = [];
  let seq = 0;
  const promptId = sha256(`prompt:${sessionId}`).slice(0, 24);
  // user_prompt to open the turn.
  events.push(
    baseEvent(cfg, sessionId, startedAtMs, seq++, "user_prompt", {
      PromptId: promptId,
      QuerySource: "repl_main_thread",
      PromptChars: rng.int(120, 2400),
    }),
  );

  let inTok = 0,
    outTok = 0,
    cacheRead = 0,
    cacheCreation = 0,
    cost = 0,
    modelCallMs = 0,
    ttftTotal = 0,
    peakCtx = 0;
  const toolCounts: Record<string, number> = {};
  const toolDurationMs: Record<string, number> = {};
  let toolResultBytes = 0,
    toolInputBytes = 0,
    toolCalls = 0,
    failedTools = 0;

  for (let c = 0; c < modelCalls; c++) {
    const t = startedAtMs + (c + 1) * rng.int(20_000, 90_000);
    const isSub = subCount > 0 && rng.chance(0.5);
    const agentType = isSub ? rng.pick(subagentTypes) : "";
    const querySource = isSub ? `agent:builtin:${agentType}` : "repl_main_thread";
    // Routine context capped below 450k so leak rules 2 & 6 stay isolated.
    let ctxK = Math.min(440, Math.max(20, rng.jitter(p50k, 0.5)));
    if (rng.chance(0.08)) ctxK = Math.min(445, rng.jitter(p50k * 1.7, 0.2)); // p90-ish tail
    const ctx = Math.round(ctxK * 1000);
    const tk = splitTokens(ctx, rng);
    const dur = rng.int(4_000, 90_000);
    const ttft = rng.int(600, 4_000);
    const cc = callCost(ctx, rng);
    const speed = ctxK > 350 ? "slow" : ctxK > 150 ? "medium" : "fast";
    inTok += tk.fresh;
    outTok += tk.output;
    cacheRead += tk.cacheRead;
    cacheCreation += tk.cacheCreation;
    cost += cc;
    modelCallMs += dur;
    ttftTotal += ttft;
    peakCtx = Math.max(peakCtx, tk.cacheRead + tk.cacheCreation);
    events.push(
      baseEvent(cfg, sessionId, t, seq++, "model_call", {
        RequestId: sha256(`req:${sessionId}:${c}`).slice(0, 24),
        Model: model,
        PromptId: promptId,
        QuerySource: querySource,
        AgentType: agentType,
        InputTokens: tk.fresh,
        OutputTokens: tk.output,
        CacheReadTokens: tk.cacheRead,
        CacheCreationTokens: tk.cacheCreation,
        CostUsd: Number(cc.toFixed(6)),
        DurationMs: dur,
        TtftMs: ttft,
        Attempt: 1,
        Speed: speed,
        StopReason: "end_turn",
      }),
    );
    // A tool round-trip after most calls.
    if (rng.chance(0.7)) {
      const tool = rng.pick(TOOL_NAMES);
      const [p50ms, bytesBase] = TOOL_SPEED[tool]!;
      const durMs = Math.round(rng.jitter(p50ms, 0.5));
      const bytes = Math.round(rng.jitter(bytesBase, 0.6));
      const failed = rng.chance(0.04);
      toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      toolDurationMs[tool] = (toolDurationMs[tool] ?? 0) + durMs;
      toolResultBytes += bytes;
      toolInputBytes += Math.round(bytes * 0.1);
      toolCalls++;
      if (failed) failedTools++;
      events.push(
        baseEvent(cfg, sessionId, t + 1000, seq++, "tool_result", {
          PromptId: promptId,
          QuerySource: querySource,
          AgentType: agentType,
          ToolName: tool,
          Success: failed ? "false" : "true",
          ToolResultBytes: bytes,
          ToolInputBytes: Math.round(bytes * 0.1),
        }),
      );
    }
  }

  // Occasional manual compaction, mid-session, below the optimum range.
  let compactions = 0;
  const compactionTriggers: Record<string, number> = {};
  if (rng.chance(0.22)) {
    const pre = Math.round(rng.jitter(178_000, 0.28));
    events.push(
      baseEvent(cfg, sessionId, startedAtMs + 5 * 60_000, seq++, "compaction", {
        PreTokens: pre,
        PostTokens: Math.round(pre * 0.35),
        CompactionTrigger: "manual",
        PromptId: promptId,
      }),
    );
    compactions++;
    compactionTriggers.manual = 1;
  }

  const commits = rng.chance(0.3) ? rng.int(1, 3) : 0;
  const linesAdded = rng.int(0, 600);
  const linesRemoved = rng.int(0, 400);
  const blockedOnUserMs = rng.int(0, 22) * 60_000;
  const activeCli = rng.int(200, 5_400);

  const lastEventMs = startedAtMs + modelCalls * 60_000;
  const session: SessionRow = {
    TenantId: cfg.tenantId,
    SessionId: sessionId,
    SessionKeySource: "session.id",
    Version: cfg.version,
    StartedAt: new Date(startedAtMs),
    CreatedAt: new Date(startedAtMs),
    UpdatedAt: new Date(cfg.todayMs),
    Agent: "claude_code",
    AgentVersion: cfg.agentVersion,
    TraceIds: [traceId(sessionId)],
    FinalRequestId: sha256(`final:${sessionId}`).slice(0, 24),
    UserId: eng.userId,
    TerminalType: rng.pick(["iterm", "vscode", "tmux", "apple_terminal"]),
    Entrypoint: rng.pick(["cli", "cli", "sdk", "vscode"]),
    ModelCalls: modelCalls,
    ToolCalls: toolCalls,
    SubAgents: subCount,
    Prompts: 1,
    PromptChars: rng.int(200, 3000),
    ResponseChars: rng.int(1000, 40000),
    Steps: buildSteps(toolCounts),
    ToolCounts: toolCounts,
    ToolDurationMs: toolDurationMs,
    FilesTouched: [],
    Skills: skills,
    SubAgentTypes: subagentTypes,
    SlashCommands: skills.length ? [`/${skills[0]}`] : [],
    Models: [model],
    McpServers: mcpUsed,
    McpTools: mcpUsed.map((m) => `mcp__${m}__query`),
    InputTokens: inTok,
    OutputTokens: outTok,
    CacheReadTokens: cacheRead,
    CacheCreationTokens: cacheCreation,
    CostUsd: Number(cost.toFixed(6)),
    ModelCallMs: modelCallMs,
    ToolMs: Object.values(toolDurationMs).reduce((s, v) => s + v, 0),
    TtftMsTotal: ttftTotal,
    TtftSamples: modelCalls,
    BlockedOnUserMs: blockedOnUserMs,
    ActiveTimeUserSec: rng.int(60, 3600),
    ActiveTimeCliSec: activeCli,
    ToolResultBytes: toolResultBytes,
    ToolInputBytes: toolInputBytes,
    Compactions: compactions,
    CompactionTokensBefore: 0,
    CompactionTokensAfter: 0,
    PeakContextTokens: peakCtx,
    CacheRebuildCount: 0,
    LargestCacheRebuildTokens: 0,
    FailedTools: failedTools,
    ErrorTypes: {},
    ApiErrors: 0,
    RateLimited: 0,
    RetriesExhausted: 0,
    RetryMs: 0,
    Attempts: modelCalls,
    Refusals: 0,
    RefusalCategories: [],
    InternalErrors: 0,
    ToolsDenied: rng.chance(0.1) ? rng.int(1, 2) : 0,
    ToolsAborted: 0,
    PermissionMode: rng.pick(["default", "acceptEdits", "plan"]),
    PermissionChanges: rng.chance(0.15) ? 1 : 0,
    HooksBlocked: 0,
    HooksCancelled: 0,
    HookMs: 0,
    LinesAdded: linesAdded,
    LinesRemoved: linesRemoved,
    Commits: commits,
    PullRequests: linkedPr ? 1 : 0,
    EditsAccepted: rng.int(0, 30),
    EditsRejected: rng.int(0, 6),
    LanguagesEdited: ["typescript"],
    AtMentions: 0,
    StopReason: rng.pick(["end_turn", "end_turn", "tool_use", "max_tokens"]),
    Truncated: false,
    SubAgentIds: [],
    PreviousCallContextTokens: 0,
    StepStartedAt: [],
    MetricSeries: [],
    LastEventOccurredAt: new Date(lastEventMs),
    AppliedEventIds: [],
    RateLimitEvents: 0,
    CompactionTriggers: compactionTriggers,
    ParentSessionId: "",
    IsFork: isFork,
    RepositoryHost: "github.com",
    RepositoryOwner: "acme",
    RepositoryName: repo,
    GitBranch: branch,
    GitWorktree: branch ? `${repo}-${branch.split("/").pop()}` : "",
    Title: rng.pick(overnight ? ["Overnight: test-suite triage", "Overnight: dependency bump", "Overnight: flaky-test hunt"] : TITLE_POOL),
    GitBranches: branch ? [branch] : [],
    TitleSource: "generated",
    AgentReportedCostUsd: Number(cost.toFixed(6)),
    _retention_days: 308,
  };

  const weekIndexFromToday = Math.floor((a.today - utcDayStart(startedAtMs)) / (7 * DAY_MS));
  return { session, events, startedAtMs, isMainUser: eng.isMain, weekIndexFromToday, commitsCap: commits };
}

function baseEvent(
  cfg: SessionsConfig,
  sessionId: string,
  timeMs: number,
  seq: number,
  kind: string,
  extra: Record<string, unknown>,
): EventRow {
  return {
    TenantId: cfg.tenantId,
    SessionId: sessionId,
    TimeUnixMs: new Date(timeMs),
    RecordId: sha256(`${sessionId}:${kind}:${seq}:${timeMs}`), // 64 hex chars
    EventKind: kind,
    Agent: "claude_code",
    SessionKeySource: "session.id",
    TraceId: traceId(sessionId),
    SpanId: sha256(`span:${sessionId}:${seq}`).slice(0, 16),
    PromptId: "",
    QuerySource: "repl_main_thread",
    AgentType: "",
    EventSequence: seq,
    RequestId: "",
    Model: "",
    InputTokens: 0,
    OutputTokens: 0,
    CacheReadTokens: 0,
    CacheCreationTokens: 0,
    CostUsd: 0,
    DurationMs: 0,
    TtftMs: 0,
    Attempt: 0,
    Speed: "",
    StopReason: "",
    PreTokens: 0,
    PostTokens: 0,
    CompactionTrigger: "",
    PrecomputeReuse: "",
    StatusCode: "",
    ErrorType: "",
    RateLimitCarrier: "",
    RetryDurationMs: 0,
    ToolName: "",
    Success: "",
    Decision: "",
    DecisionSource: "",
    ToolInputBytes: 0,
    ToolResultBytes: 0,
    PromptChars: 0,
    TotalTokens: 0,
    UpdatedAt: new Date(cfg.todayMs),
    _retention_days: 308,
    ...extra,
  };
}

function buildSteps(toolCounts: Record<string, number>): [string, number, boolean][] {
  return Object.entries(toolCounts)
    .slice(0, 100)
    .map(([name, count]) => [name, count, false] as [string, number, boolean]);
}

/** Distribute the six most recent weeks' commit totals (COMMITS_BY_WEEK). */
function applyCommitBudget(mainSessions: BuiltSession[], today: number): void {
  const COMMITS_BY_WEEK = [11, 9, 6, 4, 8, 9]; // index 0 = oldest of the six, 5 = this week
  for (let w = 0; w < 6; w++) {
    const weekIdxFromToday = 5 - w; // this-week = 0
    const inWeek = mainSessions.filter((s) => s.weekIndexFromToday === weekIdxFromToday);
    let budget = COMMITS_BY_WEEK[w]!;
    // zero everyone in the week first, then hand out the budget one at a time
    for (const s of inWeek) s.session.Commits = 0;
    let idx = 0;
    while (budget > 0 && inWeek.length > 0) {
      const s = inWeek[idx % inWeek.length]!;
      s.session.Commits = (s.session.Commits as number) + 1;
      budget--;
      idx++;
    }
  }
}

/**
 * Plant the exact last-week leak-ledger targets on the main user's sessions:
 *   · one 667k runaway with an auto compaction (leak rule 2)
 *   · 141 model calls over 450k across exactly two sessions (leak rule 6)
 *   · 19 cache rebuilds, largest 362k (leak rule 4)
 *   · 21 rate-limit retries, ~6 min lost (leak rule 5)
 *   · nine tool results over 200KB, seven of them whole-file Reads (leak rule 3)
 */
function plantLastWeekTargets(cfg: SessionsConfig, mainSessions: BuiltSession[], today: number): void {
  const lastWeek = mainSessions.filter((s) => s.startedAtMs >= today - 7 * DAY_MS);
  if (lastWeek.length < 4) return;
  const pick = (i: number) => lastWeek[i % lastWeek.length]!;

  // R1: 667k runaway — 90 model calls over 450k, one auto compaction at 667k.
  const r1 = pick(0);
  addOversizedCalls(cfg, r1, 90, 667_000);
  r1.session.PeakContextTokens = 667_000;
  r1.session.Compactions = (r1.session.Compactions as number) + 1;
  r1.session.CompactionTriggers = { ...(r1.session.CompactionTriggers as Record<string, number>), auto: 1 };
  r1.events.push(
    baseEvent(cfg, r1.session.SessionId as string, r1.startedAtMs + 30 * 60_000, 9000, "compaction", {
      PreTokens: 667_000,
      PostTokens: 240_000,
      CompactionTrigger: "auto",
    }),
  );

  // R2: the second runaway — the remaining 51 calls over 450k.
  const r2 = pick(1);
  addOversizedCalls(cfg, r2, 51, 470_000);
  r2.session.PeakContextTokens = Math.max(r2.session.PeakContextTokens as number, 520_000);

  // 19 cache rebuilds, largest 362k, spread over a few last-week sessions.
  const rebuildTargets = [pick(0), pick(1), pick(2), pick(3)];
  const rebuildCounts = [8, 5, 4, 2];
  rebuildTargets.forEach((s, i) => {
    s.session.CacheRebuildCount = rebuildCounts[i]!;
    s.session.LargestCacheRebuildTokens = i === 0 ? 362_000 : 120_000 + i * 30_000;
  });

  // 21 rate-limit retries with ~6 min (360s) of lost time, across sessions.
  let retriesLeft = 21;
  let retryMsLeft = 360_000;
  let ri = 0;
  while (retriesLeft > 0) {
    const s = pick(ri);
    const thisRetryMs = retriesLeft === 1 ? retryMsLeft : Math.round(retryMsLeft / retriesLeft) + new Rng(`retry:${s.session.SessionId}:${ri}`).int(-2000, 2000);
    const ms = Math.max(1000, thisRetryMs);
    s.events.push(
      baseEvent(cfg, s.session.SessionId as string, s.startedAtMs + (ri + 1) * 15_000, 9100 + ri, "api_error", {
        StatusCode: "429",
        ErrorType: "rate_limit_error",
        RateLimitCarrier: "event",
        RetryDurationMs: ms,
      }),
    );
    s.session.ApiErrors = (s.session.ApiErrors as number) + 1;
    s.session.RateLimited = (s.session.RateLimited as number) + 1;
    s.session.RateLimitEvents = (s.session.RateLimitEvents as number) + 1;
    s.session.RetryMs = (s.session.RetryMs as number) + ms;
    retriesLeft--;
    retryMsLeft -= ms;
    ri++;
  }

  // Nine tool results over 200KB, seven of them whole-file Reads (rule 3).
  const bigResults: [string, number][] = [
    ["Read", 639_000],
    ["Read", 420_000],
    ["Read", 310_000],
    ["Read", 280_000],
    ["Read", 250_000],
    ["Read", 230_000],
    ["Read", 210_000],
    ["Bash(pnpm test)", 260_000],
    ["Agent", 240_000],
  ];
  bigResults.forEach(([tool, bytes], i) => {
    const s = pick(i);
    s.events.push(
      baseEvent(cfg, s.session.SessionId as string, s.startedAtMs + (i + 1) * 20_000, 9200 + i, "tool_result", {
        ToolName: tool,
        Success: "true",
        ToolResultBytes: bytes,
        ToolInputBytes: Math.round(bytes * 0.02),
      }),
    );
    s.session.ToolResultBytes = (s.session.ToolResultBytes as number) + bytes;
    const tc = s.session.ToolCounts as Record<string, number>;
    tc[tool] = (tc[tool] ?? 0) + 1;
  });
}

/** Append `count` model_call events with context above 450k to a session. */
function addOversizedCalls(cfg: SessionsConfig, b: BuiltSession, count: number, peakCtx: number): void {
  const sessionId = b.session.SessionId as string;
  const rng = new Rng(`oversized:${sessionId}`);
  let inTok = b.session.InputTokens as number;
  let cacheRead = b.session.CacheReadTokens as number;
  let cacheCreation = b.session.CacheCreationTokens as number;
  let outTok = b.session.OutputTokens as number;
  let cost = b.session.CostUsd as number;
  const model = (b.session.Models as string[])[0] ?? "claude-fable-5-1";
  for (let c = 0; c < count; c++) {
    // context between 450k and peakCtx
    const ctx = c === 0 ? peakCtx : 451_000 + rng.int(0, Math.max(1, peakCtx - 451_000));
    const hit = rng.jitter(0.9, 0.02);
    const cr = Math.round(ctx * hit);
    const ccre = Math.round(ctx * 0.02);
    const fresh = Math.max(0, ctx - cr - ccre);
    const output = rng.int(300, 1800);
    const cc = 0.44 * rng.jitter(1, 0.2);
    inTok += fresh;
    cacheRead += cr;
    cacheCreation += ccre;
    outTok += output;
    cost += cc;
    b.events.push(
      baseEvent(cfg, sessionId, b.startedAtMs + (c + 1) * 40_000, 9300 + c, "model_call", {
        RequestId: sha256(`over:${sessionId}:${c}`).slice(0, 24),
        Model: model,
        PromptId: sha256(`prompt:${sessionId}`).slice(0, 24),
        QuerySource: "repl_main_thread",
        InputTokens: fresh,
        OutputTokens: output,
        CacheReadTokens: cr,
        CacheCreationTokens: ccre,
        CostUsd: Number(cc.toFixed(6)),
        DurationMs: rng.int(30_000, 120_000),
        TtftMs: rng.int(1_000, 6_000),
        Attempt: 1,
        Speed: "slow",
        StopReason: "end_turn",
      }),
    );
  }
  b.session.InputTokens = inTok;
  b.session.CacheReadTokens = cacheRead;
  b.session.CacheCreationTokens = cacheCreation;
  b.session.OutputTokens = outTok;
  b.session.CostUsd = Number(cost.toFixed(6));
  b.session.ModelCalls = (b.session.ModelCalls as number) + count;
}
