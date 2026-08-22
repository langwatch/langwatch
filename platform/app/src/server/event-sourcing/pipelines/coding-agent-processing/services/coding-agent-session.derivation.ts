import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import {
  CODING_AGENT_REGISTRY,
  EVENTS_FOLD_TOOL_RUNS_AGENT_IDS,
  LOGS_ONLY_AGENT_IDS,
  WRAPPER_TOOL_NAMES_BY_AGENT_ID,
} from "../agents";
import {
  detectCodingAgent,
  normalizeEventName,
  normalizeMetricName,
  parseMcpToolName,
  SESSION_NAME_FACT_KEY,
  SESSION_TITLE_FACT_KEY,
  SESSION_TITLE_FALLBACK_FACT_KEY,
} from "./coding-agent-normalization";
import type {
  CodingAgentSessionData,
  MetricSeriesFact,
  SessionStep,
  SessionTitleSource,
} from "./coding-agent-session.types";

/**
 * Derive a coding-agent SESSION from its contributions (ADR-056,
 * specs/coding-agent/session-aggregate.feature).
 *
 * The signals split the story:
 *
 *   spans   — the structure, the timings, the tokens, the finish reason
 *   logs    — the cost, the denials, the errors, the compactions, the hooks
 *   metrics — what actually came OUT of it: lines changed, commits, PRs, and
 *             the time a human spent
 *
 * Read only the spans and you cannot see a tool the user DENIED (it never ran,
 * so it has no span). Read only the logs and you cannot see how long anything
 * took. Read neither and you cannot see that the session produced two commits.
 *
 * Unlike PR #5708's trace-keyed fold, this derivation never sees a raw span
 * or a raw log record: the source pipelines' dispatchers gate, normalize and
 * lift, and what arrives here is a contribution's scalar facts. The gates
 * therefore live with the dispatchers; everything here is application.
 *
 * AGENT-GENERIC in shape; span coverage is per adapter. Every coding agent
 * has a finish reason, tools, sub-agents, an approval mode, retries,
 * compaction: the columns are generic, and what differs is only WHERE each
 * fact is read from, which lives in the {@link CLAUDE} and {@link CODEX}
 * adapters below. Telemetry from the other agents the vocabulary layer
 * recognises flows through the gates but produces no span-fed session facts
 * until its adapter is written — do not point product claims at them.
 *
 * PURE, LIGHT and BOUNDED — see `coding-agent-session.types.ts`.
 */

/** Ordered steps we keep. Enough for the shape of any session to survive. */
const MAX_STEPS = 100;
/** Distinct values kept in any bounded set (files, tools, skills, servers). */
export const MAX_SET = 50;

/**
 * The OTLP numeric status enum's ERROR value. NOT the string "error": PR
 * #5708 shipped that comparison and it could never be true, so every failed
 * tool folded as successful — silently, because a comparison that cannot
 * match throws nothing. The contribution schema already refuses strings.
 */
const SPAN_STATUS_ERROR = 2;

/**
 * The Claude Code adapter: the ONLY agent-specific part of this file. Span
 * names, event names, and the keys each fact rides on.
 */
const CLAUDE = {
  SPAN: {
    LLM_REQUEST: "claude_code.llm_request",
    TOOL: "claude_code.tool",
    TOOL_EXECUTION: "claude_code.tool.execution",
    BLOCKED_ON_USER: "claude_code.tool.blocked_on_user",
    SUBAGENT_SPAWN: "claude_code.subagent.spawn",
  },
  // Post-normalization CANONICAL event names (see coding-agent-normalization).
  // These are what the switch matches, NOT the raw wire strings — the raw
  // spellings differ per agent and are mapped before they reach here.
  EVENT: {
    USER_PROMPT: "user_prompt",
    ASSISTANT_RESPONSE: "assistant_response",
    API_REQUEST: "api_request",
    API_RESPONSE: "api_response",
    TOOL_RESULT: "tool_result",
    TOOL_DECISION: "tool_decision",
    API_ERROR: "api_error",
    RETRIES_EXHAUSTED: "retries_exhausted",
    RATE_LIMIT: "rate_limit",
    REFUSAL: "api_refusal",
    COMPACTION: "compaction",
    PERMISSION_MODE: "permission_mode_changed",
    SKILL_ACTIVATED: "skill_activated",
    MCP_CONNECTION: "mcp_server_connection",
    HOOK_COMPLETE: "hook_execution_complete",
    AT_MENTION: "at_mention",
    INTERNAL_ERROR: "internal_error",
  },
} as const;

/**
 * The Codex adapter, the second span-bearing agent. Everything here comes
 * from codex-rs 0.147 and live capture:
 *
 *   - `session_task.turn` is the one span worth folding: the turn's token
 *     totals (`gen_ai.usage.*`), the model, and the session key
 *     (`gen_ai.conversation.id`). One fold per turn — a turn that looped
 *     several API calls still counts once, which undercounts `modelCalls`
 *     against Claude's per-call grain but never double-counts tokens.
 *   - `handle_responses` repeats the same token counts and stamps a tokio
 *     `thread.id` that the session-key resolution would read as the session
 *     (`'10'`, shared by every span on that worker thread) — never fold it.
 *   - The turn span's wall time INCLUDES tool execution, so it does not feed
 *     `modelCallMs` (zero reads as "not measured"); TTFT arrives on the
 *     `codex.turn_ttft` EVENT instead, and tool runs on `tool_result` events
 *     (`foldsToolRunsFromEvents` on the definition — codex has no tool span).
 *   - `gen_ai.usage.input_tokens` INCLUDES the cache buckets, unlike the
 *     disjoint claude spellings — {@link codexTurnTokenFacts} re-derives the
 *     disjoint input before the shared fold runs.
 */
const CODEX = {
  SPAN: {
    TURN: "session_task.turn",
  },
  EVENT: {
    TURN_TTFT: "turn_ttft",
  },
  ATTR: {
    INPUT_TOKENS: "gen_ai.usage.input_tokens",
    OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
    CACHE_READ_TOKENS: "gen_ai.usage.cache_read.input_tokens",
    CACHE_CREATION_TOKENS: "gen_ai.usage.cache_creation.input_tokens",
    NON_CACHED_INPUT_TOKENS: "codex.turn.token_usage.non_cached_input_tokens",
    RESPONSE_MODEL: "gen_ai.response.model",
  },
} as const;

/**
 * The LangWatch vocabulary, the sibling of the {@link CLAUDE} adapter for the
 * facts no vendor emits: the companion event carrying the session's git
 * identity, and the keys it and the derived title ride on. Agent-generic by
 * construction: every agent that installs the hook sends these exact
 * spellings, so this is one table rather than one per agent.
 */
const LANGWATCH = {
  EVENT: {
    SESSION_CONTEXT: "session_context",
  },
  ATTR: {
    REPOSITORY_HOST: "vcs.repository.host",
    REPOSITORY_OWNER: "vcs.repository.owner",
    REPOSITORY_NAME: "vcs.repository.name",
    BRANCH: "vcs.ref.head.name",
    WORKTREE: "vcs.worktree.name",
    TITLE: SESSION_TITLE_FACT_KEY,
    TITLE_FALLBACK: SESSION_TITLE_FALLBACK_FACT_KEY,
    NAME: SESSION_NAME_FACT_KEY,
  },
} as const;

/**
 * The title tiers, weakest first. `withTitle` compares against this table so
 * the precedence lives in exactly one place.
 */
const TITLE_RANK: Record<SessionTitleSource, number> = {
  prompt: 1,
  generated: 2,
  name: 3,
};

/**
 * Fold one title candidate onto the session by source rank: the harness's
 * own session name beats the generated conversation title beats the
 * prompt-derived name. Within a rank the newest non-empty value wins IN
 * PLACE — that is what makes a rename land — except the prompt tier, which
 * only ever fills an empty row. Whitespace is no title at any rank: it would
 * outrank real names and render as a blank row.
 *
 * A row from before the source column decodes with a title and no source;
 * it ranks as `generated`, the strongest source that existed then, so a
 * newer generated title still replaces it and a name still wins.
 */
function withTitle({
  state,
  value,
  source,
}: {
  state: CodingAgentSessionData;
  value: string | null;
  source: SessionTitleSource;
}): CodingAgentSessionData {
  const title = value?.trim() || null;
  if (title === null) return state;
  if (source === "prompt" && state.title !== null) return state;
  const current =
    state.titleSource !== null
      ? TITLE_RANK[state.titleSource]
      : state.title !== null
        ? TITLE_RANK.generated
        : 0;
  if (TITLE_RANK[source] < current) return state;
  return { ...state, title, titleSource: source };
}

/**
 * Claude's span names carry their own namespace, so the name alone is the
 * whole gate for them.
 */
const SELF_NAMESPACED_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE.SPAN.LLM_REQUEST,
  CLAUDE.SPAN.TOOL,
  CLAUDE.SPAN.TOOL_EXECUTION,
  CLAUDE.SPAN.BLOCKED_ON_USER,
  CLAUDE.SPAN.SUBAGENT_SPAWN,
]);

/**
 * Span names an agent DECLARES on its registry definition. These are bare
 * (codex's `session_task.turn` carries no vendor namespace), so membership is
 * necessary but not sufficient — see {@link isCodingAgentSessionSpan}.
 */
const DECLARED_SPAN_NAMES: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.flatMap((agent) => agent.sessionSpanNames ?? []),
);

/**
 * Whether one span belongs in the session fold — the DISPATCHER's gate (the
 * subscriber on trace-processing). Every span in the project flows past it,
 * and normalizing one runs the whole canonicalisation registry, so the gate
 * must answer from the raw record alone.
 *
 * Two tiers, because the two kinds of name carry different evidence. A
 * self-namespaced name (`claude_code.tool`) is admitted on the name alone —
 * one set lookup for the whole firehose. A DECLARED name
 * (`session_task.turn`) is bare — any instrumentation could reuse it — so it
 * is admitted only when agent detection can actually name the agent from the
 * record's scope, keeping a foreign span with a colliding name from minting
 * garbage sessions. The detection runs only for names already in the set, so
 * the firehose never pays for it.
 */
export function isCodingAgentSessionSpan({
  name,
  scopeName,
}: {
  name: string;
  scopeName?: string | null;
}): boolean {
  if (SELF_NAMESPACED_SPAN_NAMES.has(name)) return true;
  if (!DECLARED_SPAN_NAMES.has(name)) return false;
  return detectCodingAgent({ recordName: name, scopeName }) !== "unknown";
}

/** HTTP 429 — the one failure worth telling apart from every other failure. */
const RATE_LIMIT_STATUS = "429";

/** A reply that stopped for one of these did NOT finish answering. */
const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "refusal"]);

/**
 * A cache write costs MORE per token than a read, so a call whose
 * `cacheCreationTokens` is close to the size of the context the PREVIOUS call
 * had cached is the session paying twice for the same tokens. Same
 * thresholds `sessionView/tokenTimeline.ts`'s `findCacheRebuilds` uses
 * client-side (kept in sync by hand — one reads a single trace's transcript
 * at render time, this one folds at ingest across a session's traces).
 */
const CACHE_REBUILD_RATIO_THRESHOLD = 0.5;
const CACHE_REBUILD_MIN_TOKENS = 1_000;

/**
 * A rejection the human made deliberately, versus one they made by walking away.
 * Neither is a tool that BROKE — counting them together would report the human's
 * judgement as the agent's failure.
 */
const ABORTED_SOURCES = new Set(["user_abort"]);

export function createInitCodingAgentSession(): CodingAgentSessionData {
  return {
    agent: null,
    sessionId: null,
    agentVersion: null,
    terminalType: null,
    entrypoint: null,
    finalRequestId: null,
    userId: null,
    parentSessionId: null,
    isFork: false,
    repositoryHost: null,
    repositoryOwner: null,
    repositoryName: null,
    gitBranch: null,
    gitBranches: [],
    gitWorktree: null,
    title: null,
    titleSource: null,

    modelCalls: 0,
    toolCalls: 0,
    subAgents: 0,
    subAgentIds: [],
    steps: [],
    prompts: 0,
    promptChars: 0,
    responseChars: 0,

    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    models: [],
    mcpServers: [],
    mcpTools: [],

    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,

    modelCallMs: 0,
    toolMs: 0,
    ttftMsTotal: 0,
    ttftSamples: 0,
    blockedOnUserMs: 0,
    activeTimeUserSec: 0,
    activeTimeCliSec: 0,

    toolResultBytes: 0,
    toolInputBytes: 0,
    compactions: 0,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    compactionTriggers: {},
    peakContextTokens: 0,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    previousCallContextTokens: 0,

    failedTools: 0,
    errorTypes: {},
    apiErrors: 0,
    rateLimited: 0,
    rateLimitEvents: 0,
    retriesExhausted: 0,
    retryMs: 0,
    attempts: 0,
    refusals: 0,
    refusalCategories: [],
    internalErrors: 0,

    toolsDenied: 0,
    toolsAborted: 0,
    permissionMode: null,
    permissionChanges: 0,
    hooksBlocked: 0,
    hooksCancelled: 0,
    hookMs: 0,

    metricSeries: {},
    linesAdded: 0,
    linesRemoved: 0,
    commits: 0,
    pullRequests: 0,
    editsAccepted: 0,
    editsRejected: 0,
    languagesEdited: [],
    atMentions: 0,

    stopReason: null,
    truncated: false,
  };
}

/**
 * The mean time-to-first-token. Kept as a sum + count on the state rather than a
 * running average, because a running average cannot be folded incrementally
 * without drifting.
 */
export function meanTtftMs(state: CodingAgentSessionData): number | null {
  return state.ttftSamples > 0
    ? Math.round(state.ttftMsTotal / state.ttftSamples)
    : null;
}

/**
 * The share of input tokens served from cache. The single most useful number for
 * a coding agent's economics: a low hit rate on a long session means the context
 * prefix keeps changing and every turn is re-paying for it.
 */
export function cacheHitRate(state: CodingAgentSessionData): number | null {
  const total =
    state.cacheReadTokens + state.cacheCreationTokens + state.inputTokens;
  return total > 0 ? state.cacheReadTokens / total : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A scalar rendered as its string form. Contribution facts carry RAW scalars
 * (the lift preserves booleans and numbers), so flag and status comparisons
 * must not go through `str()` — it nulls anything non-string, silently
 * missing `success: false`, a numeric 429, or `server_fallback_hop: true`.
 */
function scalarStr(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Add to a bounded set, in first-seen order. */
export function addToBoundedSet(set: string[], value: string): string[] {
  if (set.includes(value) || set.length >= MAX_SET) return set;
  return [...set, value];
}

/** Increment a bounded, low-cardinality counter map. */
function bump(
  map: Record<string, number>,
  key: string,
  by = 1,
): Record<string, number> {
  if (map[key] === undefined && Object.keys(map).length >= MAX_SET) return map;
  return { ...map, [key]: (map[key] ?? 0) + by };
}

/**
 * Append a step, keeping the list in the order the steps actually HAPPENED, and
 * batching a back-to-back run of the same tool into one.
 *
 * Load-bearing: spans arrive in EXPORT order, not start order — they are batched
 * on the wire, so a slow tool's span can land after a later one's. Appending
 * blindly would produce a plausible-looking but WRONG sequence, which is worse
 * than showing none. Each step therefore carries its start time and is placed by
 * it.
 *
 * Batching only collapses ADJACENT runs. `Read Read Bash Read` stays
 * `Read x2, Bash, Read` — the return to Read after the Bash is a different beat
 * of the story (it checked, ran, checked again), and merging it would erase that.
 */
function appendStep(
  steps: SessionStep[],
  step: { name: string; startedAtMs: number; failed: boolean },
): SessionStep[] {
  let index = steps.length;
  while (index > 0 && (steps[index - 1]?.startedAtMs ?? 0) > step.startedAtMs) {
    index--;
  }

  const previous = steps[index - 1];
  if (previous && previous.name === step.name) {
    const merged: SessionStep = {
      ...previous,
      count: previous.count + 1,
      // A run of five tests where the third broke is not a clean run.
      failed: previous.failed || step.failed,
    };
    return [...steps.slice(0, index - 1), merged, ...steps.slice(index)];
  }

  // A late arrival can also land just BEFORE an existing same-name step —
  // merging only backward would leave two adjacent same-name runs unmerged.
  const next = steps[index];
  if (next && next.name === step.name) {
    const merged: SessionStep = {
      ...next,
      startedAtMs: step.startedAtMs,
      count: next.count + 1,
      failed: next.failed || step.failed,
    };
    return [...steps.slice(0, index), merged, ...steps.slice(index + 1)];
  }

  if (steps.length >= MAX_STEPS) return steps;
  return [
    ...steps.slice(0, index),
    {
      name: step.name,
      count: 1,
      failed: step.failed,
      startedAtMs: step.startedAtMs,
    },
    ...steps.slice(index),
  ];
}

/**
 * Record a sub-agent by its id.
 *
 * `claude_code.subagent.spawn` turns out not to be emitted in practice, so the
 * only reliable evidence a sub-agent ran is the `agent_id` stamped on its own
 * spans. Counting distinct ids is therefore the count.
 */
function seenSubAgent(
  state: CodingAgentSessionData,
  agentId: string,
): Partial<CodingAgentSessionData> {
  if (state.subAgentIds.includes(agentId)) return {};
  if (state.subAgentIds.length >= MAX_SET) return {};
  const subAgentIds = [...state.subAgentIds, agentId];
  return { subAgentIds, subAgents: subAgentIds.length };
}

/**
 * Identity that rides on every signal, so any of them can establish it. The
 * dispatchers flatten the resource attributes they lift (`service.version`)
 * into the same facts map, so one map is enough here.
 */
function withIdentity(
  state: CodingAgentSessionData,
  attrs: Record<string, unknown>,
): CodingAgentSessionData {
  return {
    ...state,
    agentVersion:
      state.agentVersion ??
      str(attrs["app.version"]) ??
      str(attrs["service.version"]),
    terminalType: state.terminalType ?? str(attrs["terminal.type"]),
    entrypoint: state.entrypoint ?? str(attrs["app.entrypoint"]),
    // Claude stamps user identity on log events, not spans; other agents send
    // none at all, so a session they produce honestly keeps null here.
    // Opaque provider ids only — Claude Code's `user.id` hash, or Cowork's
    // account UUID / tagged account id. `user.email` also rides those events
    // but is raw human identity, and this value lands verbatim in a durable
    // row, so it is deliberately never read.
    userId:
      state.userId ??
      str(attrs["user.id"]) ??
      str(attrs["user.account_uuid"]) ??
      str(attrs["user.account_id"]),
    // Spawn lineage, for agents that stamp it. Once-set like the rest of the
    // identity: a session has ONE parent, and a fork stays a fork.
    //
    // Nothing observed so far stamps it. A session that spawned a sub-agent
    // with every enhanced-telemetry knob on carried neither key, while that
    // sub-agent's own `agent_id` does arrive and is counted by `seenSubAgent`.
    // So empty reads as "no lineage was reported", never as "this is a root
    // session": the two are indistinguishable from here.
    parentSessionId: state.parentSessionId ?? str(attrs.parent_session_id),
    isFork: state.isFork || scalarStr(attrs.is_fork) === "true",
  };
}

/**
 * Fold one model call into the session, from whichever signal carries it.
 *
 * Claude Code reports the call on the `claude_code.llm_request` SPAN; a
 * logs-only agent (Cowork) reports the same facts — model, tokens, cache
 * buckets, attempt, duration — on its `api_request` EVENT. One fold, two
 * carriers, so the vocabularies cannot drift. The caller gates which carrier
 * counts for its agent (span-bearing agents fold spans, logs-only agents
 * fold events) — folding both would double every call.
 */
function foldModelCall(
  next: CodingAgentSessionData,
  attrs: Record<string, unknown>,
  fallbackDurationMs: number,
): CodingAgentSessionData {
  const agentId = str(attrs.agent_id);
  if (agentId !== null) Object.assign(next, seenSubAgent(next, agentId));
  const stopReason = str(attrs.stop_reason);
  const ttft = num(attrs.ttft_ms);
  const model = str(attrs.model) ?? str(attrs["gen_ai.request.model"]);
  const requestId = str(attrs.request_id);

  const cacheReadTokens = num(attrs.cache_read_tokens);
  const cacheCreationTokens = num(attrs.cache_creation_tokens);
  const contextTokens = cacheReadTokens + cacheCreationTokens;
  // The first call is never a "rebuild" — there is nothing to reuse yet,
  // so a cold cache isn't the session's fault. `previousCallContextTokens`
  // starts at 0, which doubles as that gate.
  const isRebuild =
    next.previousCallContextTokens > 0 &&
    cacheCreationTokens >= CACHE_REBUILD_MIN_TOKENS &&
    cacheCreationTokens / next.previousCallContextTokens >=
      CACHE_REBUILD_RATIO_THRESHOLD;

  return {
    ...next,
    modelCalls: next.modelCalls + 1,
    modelCallMs:
      next.modelCallMs + (num(attrs.duration_ms) || fallbackDurationMs),
    ttftMsTotal: next.ttftMsTotal + ttft,
    ttftSamples: next.ttftSamples + (ttft > 0 ? 1 : 0),
    // Attempts includes the first try, so attempts > modelCalls means the
    // session paid for retries somewhere.
    attempts: next.attempts + Math.max(1, num(attrs.attempt)),
    inputTokens: next.inputTokens + num(attrs.input_tokens),
    outputTokens: next.outputTokens + num(attrs.output_tokens),
    cacheReadTokens: next.cacheReadTokens + cacheReadTokens,
    cacheCreationTokens: next.cacheCreationTokens + cacheCreationTokens,
    peakContextTokens: Math.max(next.peakContextTokens, contextTokens),
    cacheRebuildCount: next.cacheRebuildCount + (isRebuild ? 1 : 0),
    largestCacheRebuildTokens: isRebuild
      ? Math.max(next.largestCacheRebuildTokens, cacheCreationTokens)
      : next.largestCacheRebuildTokens,
    previousCallContextTokens: contextTokens,
    models: model !== null ? addToBoundedSet(next.models, model) : next.models,
    // The pointer back to the body that ended the session. Last call wins.
    finalRequestId: requestId ?? next.finalRequestId,
    // Only the LAST call's stop reason is the session's: the earlier ones all
    // stop on `tool_use` by definition, since that is what drove the loop on.
    ...(stopReason !== null
      ? {
          stopReason,
          truncated: TRUNCATING_STOP_REASONS.has(stopReason),
        }
      : {}),
  };
}

/**
 * What one turn cost, for an agent whose telemetry states no price of its own.
 *
 * Claude reports what it was billed on its API_REQUEST event, and that number
 * is the session's cost. Codex reports a model and token counts and nothing
 * else, so its sessions read as free while the SAME turn's trace states a
 * figure — the trace pipeline prices the identical span against the model
 * registry. This is that same call, so the two agree.
 *
 * The facts are the respelled ones, whose `input_tokens` is the disjoint
 * non-cached bucket, and whose cache buckets keep codex's own spellings —
 * which are the gen_ai keys {@link computeSpanCost} reads. An unpriced model
 * comes back zero rather than an invented rate.
 */
function pricedFromTokens(facts: Record<string, unknown>): number {
  return computeSpanCost({
    attrs: facts,
    model: str(facts.model) ?? undefined,
    promptTokens: num(facts.input_tokens),
    completionTokens: num(facts.output_tokens),
  });
}

/**
 * Codex's turn tokens, respelled into the disjoint claude vocabulary
 * {@link foldModelCall} reads — one fold, one convention.
 *
 * The re-derivation is the point: codex's `gen_ai.usage.input_tokens` is the
 * WHOLE input, cache included (13944 = 11008 cache-read + 2936 non-cached on
 * a live turn), while the shared fold's `input_tokens` is the disjoint
 * non-cached bucket. Codex's own non-cached count is preferred; when a build
 * omits it, the subtraction recovers it from the gen_ai buckets.
 */
function codexTurnTokenFacts(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const cacheRead = num(attrs[CODEX.ATTR.CACHE_READ_TOKENS]);
  const cacheCreation = num(attrs[CODEX.ATTR.CACHE_CREATION_TOKENS]);
  const wholeInput = num(attrs[CODEX.ATTR.INPUT_TOKENS]);
  const nonCachedInput =
    attrs[CODEX.ATTR.NON_CACHED_INPUT_TOKENS] !== undefined
      ? num(attrs[CODEX.ATTR.NON_CACHED_INPUT_TOKENS])
      : Math.max(0, wholeInput - cacheRead - cacheCreation);

  return {
    ...attrs,
    input_tokens: nonCachedInput,
    output_tokens: num(attrs[CODEX.ATTR.OUTPUT_TOKENS]),
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    model:
      str(attrs["gen_ai.request.model"]) ??
      str(attrs[CODEX.ATTR.RESPONSE_MODEL]),
  };
}

/** The compact span view a span-facts contribution carries. */
export interface SpanFactsView {
  name: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  /** OTLP numeric status enum (0 unset / 1 ok / 2 error). */
  statusCode: number;
  /** Lifted scalar span attributes, raw wire keys. */
  attrs: Record<string, unknown>;
}

/** Fold one SPAN's facts into the session. */
export function applySpanToCodingAgentSession({
  state,
  span,
  agent,
}: {
  state: CodingAgentSessionData;
  span: SpanFactsView;
  /**
   * The CONTRIBUTION's detected agent — the same gate
   * `applyLogToCodingAgentSession` applies, mirrored onto the span side.
   *
   * A logs-only agent folds its model calls and tool runs from its LOG events,
   * so folding the equivalent span too counts one turn twice. `logsOnly` says
   * the agent's telemetry is events-only, but nothing stops it also exporting
   * spans — Cowork does exactly that behind its beta trace-export flag — so the
   * gate has to be enforced on both sides, not just declared.
   */
  agent?: string;
}): CodingAgentSessionData {
  const attrs = span.attrs;
  const durationMs = Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs);
  const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);

  if (span.name === CLAUDE.SPAN.LLM_REQUEST) {
    // Identity still rides the span; only the counted facts are the log's.
    return isLogsOnly
      ? withIdentity(state, attrs)
      : foldModelCall(withIdentity(state, attrs), attrs, durationMs);
  }

  if (span.name === CODEX.SPAN.TURN) {
    // The contribution's own label gates the fold: the dispatcher already
    // declined foreign spans reusing this bare name, and one that still
    // arrives labeled as another agent contributes identity only.
    if (agent !== "codex" || isLogsOnly) return withIdentity(state, attrs);
    const facts = codexTurnTokenFacts(attrs);
    // Fallback duration 0, not the span's: the turn's wall time includes the
    // tools that ran inside it, and zero reads honestly as "not measured".
    const folded = foldModelCall(withIdentity(state, attrs), facts, 0);
    return { ...folded, costUsd: folded.costUsd + pricedFromTokens(facts) };
  }

  if (span.name === CLAUDE.SPAN.SUBAGENT_SPAWN) {
    const next = withIdentity(state, attrs);
    const agentType = str(attrs.agent_type) ?? str(attrs.subagent_type);
    const agentId = str(attrs.agent_id);
    return {
      ...next,
      ...(agentId !== null ? seenSubAgent(next, agentId) : {}),
      subAgentTypes:
        agentType !== null
          ? addToBoundedSet(next.subAgentTypes, agentType)
          : next.subAgentTypes,
    };
  }

  // The time a HUMAN sat waiting to approve a tool. Pure friction: the agent was
  // idle and so was the person. Nothing else in the telemetry surfaces it.
  if (span.name === CLAUDE.SPAN.BLOCKED_ON_USER) {
    return {
      ...state,
      blockedOnUserMs:
        state.blockedOnUserMs + (num(attrs.duration_ms) || durationMs),
    };
  }

  if (span.name !== CLAUDE.SPAN.TOOL) return state;

  // Same gate as the model call above, widened to every agent whose tool
  // runs fold from `tool_result` events — for them the tool span would be
  // the second count, whether their telemetry is events-only or not.
  const foldsToolRunsFromEvents =
    agent !== undefined && EVENTS_FOLD_TOOL_RUNS_AGENT_IDS.has(agent);
  if (foldsToolRunsFromEvents) return withIdentity(state, attrs);

  return foldToolInvocation(withIdentity(state, attrs), {
    attrs,
    failed: span.statusCode === SPAN_STATUS_ERROR,
    toolMs: num(attrs.duration_ms) || durationMs,
    startedAtMs: span.startTimeUnixMs,
  });
}

/**
 * Fold one tool invocation into the session, from whichever signal carries
 * it. Span-bearing agents report it on the `claude_code.tool` SPAN; a
 * logs-only agent (Cowork) reports the same facts — tool name, success,
 * duration, sizes — on its `tool_result` EVENT. The caller gates which
 * carrier counts for its agent, so an agent with both never double-counts.
 */
function foldToolInvocation(
  next: CodingAgentSessionData,
  {
    attrs,
    failed,
    toolMs,
    startedAtMs,
  }: {
    attrs: Record<string, unknown>;
    failed: boolean;
    toolMs: number;
    startedAtMs: number;
  },
): CodingAgentSessionData {
  const toolName = str(attrs.tool_name);

  const withTool: CodingAgentSessionData = {
    ...next,
    toolCalls: next.toolCalls + 1,
    failedTools: next.failedTools + (failed ? 1 : 0),
    toolMs: next.toolMs + toolMs,
  };

  if (toolName === null) return withTool;

  withTool.toolCounts = bump(next.toolCounts, toolName);
  if (toolMs > 0) {
    withTool.toolDurationMs = bump(next.toolDurationMs, toolName, toolMs);
  }

  // A sub-agent runs its OWN conversation and can do twenty reads of its own.
  // Splicing those into the session's steps would read as though the main thread
  // did them, flattening away the hierarchy. The sub-agent is already
  // represented by the step that SPAWNED it. `agent_id` is absent on the main
  // thread and present on every sub-agent span, so it is exactly the
  // discriminator. The work still counts toward the totals — it happened.
  const toolAgentId = str(attrs.agent_id);
  if (toolAgentId !== null) {
    Object.assign(withTool, seenSubAgent(withTool, toolAgentId));
  }
  if (toolAgentId === null) {
    withTool.steps = appendStep(next.steps, {
      name: toolName,
      startedAtMs,
      failed,
    });
  }

  const filePath = str(attrs.file_path);
  if (filePath !== null) {
    withTool.filesTouched = addToBoundedSet(next.filesTouched, filePath);
  }

  // A skill reaches the session two ways: the `skill_activated` event and the
  // Skill TOOL span. A skill the agent invoked proactively arrives on one path,
  // a `/slash` skill on the other — reading only one loses half of them.
  const skillName = str(attrs.skill_name);
  if (skillName !== null) {
    withTool.skills = addToBoundedSet(next.skills, skillName);
  }

  // An MCP call announces itself in its NAME — `mcp__<server>__<tool>` — and that
  // is the signal that actually arrives. Reading only the `mcp_server.name` /
  // `mcp_tool.name` attributes found nothing on real sessions: a session that had
  // plainly called an MCP server reported using none, because the agent doesn't
  // emit those attributes on the tool span. So parse the name first and treat the
  // attributes as a bonus for agents that DO send them.
  const fromName = parseMcpToolName(toolName);
  // Codex spells the server as a bare `mcp_server` on its tool_result events
  // (empty string for a builtin tool, which str() already reads as absent).
  const mcpServer =
    str(attrs["mcp_server.name"]) ??
    str(attrs.mcp_server) ??
    fromName?.server ??
    null;
  if (mcpServer !== null) {
    withTool.mcpServers = addToBoundedSet(next.mcpServers, mcpServer);
  }
  const mcpTool = str(attrs["mcp_tool.name"]) ?? fromName?.tool ?? null;
  if (mcpTool !== null) {
    withTool.mcpTools = addToBoundedSet(next.mcpTools, mcpTool);
  }

  return withTool;
}

/**
 * Fold one LOG record's facts into the session.
 *
 * These are the facts with NO span: the tool the user denied (it never ran), the
 * model call that failed and was retried (a failed call has no successful span),
 * the authoritative cost, the compaction, the hook that blocked an action.
 * For a logs-only agent (`LOGS_ONLY_AGENTS`) the log is ALSO the carrier of
 * everything spans normally carry, so its `api_request` folds the model call
 * and its `tool_result` folds the tool invocation.
 */
export function applyLogToCodingAgentSession({
  state,
  attributes,
  agent,
  occurredAtMs,
}: {
  state: CodingAgentSessionData;
  /** The contribution's lifted scalar facts — raw wire keys. */
  attributes: Record<string, unknown>;
  /**
   * The CONTRIBUTION's detected agent — deliberately not the folded state's,
   * which is first-writer-wins and could have been established by a
   * differently-labeled signal. Gates the logs-only folding below.
   */
  agent?: string;
  /** The record's own time, for step placement on logs-only folds. */
  occurredAtMs?: number;
}): CodingAgentSessionData {
  const attrs = attributes;
  // Membership rides the registry (`logsOnly` on the definition), so adding
  // an events-only agent touches agents/ only. String-typed at this seam
  // because the contribution schema is a wire string, not the union.
  const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);
  // Normalize the agent's spelling into one vocabulary before matching. Claude
  // Code and Codex namespace their event names (`claude_code.tool_result`,
  // `codex.tool_result`); opencode sends a bare `tool_result` and dots its
  // session events (`session.created`). Matching the raw string would have meant
  // three switch statements that drift apart.
  const event = normalizeEventName(str(attrs["event.name"]));
  if (event === null) return state;

  const base = withIdentity(state, attrs);

  switch (event) {
    case CLAUDE.EVENT.USER_PROMPT: {
      const command = str(attrs.command_name);
      return {
        // The first prompt names an unnamed session; the generated title
        // (API_RESPONSE below) and the session's own name replace it.
        ...withTitle({
          state: base,
          value: str(attrs[LANGWATCH.ATTR.TITLE_FALLBACK]),
          source: "prompt",
        }),
        prompts: base.prompts + 1,
        // The length, never the text.
        promptChars: base.promptChars + num(attrs.prompt_length),
        slashCommands:
          command !== null
            ? addToBoundedSet(base.slashCommands, command)
            : base.slashCommands,
      };
    }

    case CLAUDE.EVENT.ASSISTANT_RESPONSE:
      return {
        ...base,
        responseChars: base.responseChars + num(attrs.response_length),
      };

    case CLAUDE.EVENT.API_REQUEST: {
      // The authoritative cost: the agent reports what it was actually billed,
      // which no span carries.
      const withCost = { ...base, costUsd: base.costUsd + num(attrs.cost_usd) };
      // For a logs-only agent this event IS the model call — the same facts
      // the llm_request span carries for Claude Code fold from here instead.
      return isLogsOnly ? foldModelCall(withCost, attrs, 0) : withCost;
    }

    case CLAUDE.EVENT.API_RESPONSE:
      // The generated conversation title, already parsed out of the response
      // body by the dispatcher. Last non-empty wins within its rank: the
      // agent regenerates the title as the conversation turns, and the
      // newest one describes it — but it never replaces the session's own
      // name.
      return withTitle({
        state: base,
        value: str(attrs[LANGWATCH.ATTR.TITLE]),
        source: "generated",
      });

    case LANGWATCH.EVENT.SESSION_CONTEXT: {
      // Repository identity and worktree are once-set: a session is one
      // checkout, so the first answer stands. The branch is the exception:
      // it moves during a session, and the branch a session ENDS on is the
      // one its pull request comes from. Every branch it passed through joins
      // the set as well, because a session that moves on has still driven the
      // branch it left, and the pull request it opened there.
      const branch = str(attrs[LANGWATCH.ATTR.BRANCH]);
      // Two titles can ride the record. The context title is the codex
      // harvest's prompt-derived name (codex withholds prompt text from its
      // own events), so it fills an empty row only. The session NAME is the
      // one the harness itself holds — claude's --name and /rename, codex's
      // thread name — mirrored by the capture seams: the newest name
      // replaces the title in place and neither derived tier may clobber it.
      const named = withTitle({
        state: withTitle({
          state: base,
          value: str(attrs[LANGWATCH.ATTR.TITLE]),
          source: "prompt",
        }),
        value: str(attrs[LANGWATCH.ATTR.NAME]),
        source: "name",
      });
      return {
        ...named,
        repositoryHost:
          base.repositoryHost ?? str(attrs[LANGWATCH.ATTR.REPOSITORY_HOST]),
        repositoryOwner:
          base.repositoryOwner ?? str(attrs[LANGWATCH.ATTR.REPOSITORY_OWNER]),
        repositoryName:
          base.repositoryName ?? str(attrs[LANGWATCH.ATTR.REPOSITORY_NAME]),
        gitWorktree: base.gitWorktree ?? str(attrs[LANGWATCH.ATTR.WORKTREE]),
        gitBranch: branch ?? base.gitBranch,
        gitBranches:
          branch !== null
            ? addToBoundedSet(base.gitBranches, branch)
            : base.gitBranches,
      };
    }

    case CLAUDE.EVENT.TOOL_RESULT: {
      const errorType = str(attrs.error_type);
      const withBytes = {
        ...base,
        // Bytes of tool OUTPUT fed back into the context — the usual cause of a
        // session bloating its way into a compaction.
        toolResultBytes:
          base.toolResultBytes + num(attrs.tool_result_size_bytes),
        toolInputBytes: base.toolInputBytes + num(attrs.tool_input_size_bytes),
        errorTypes:
          errorType !== null && scalarStr(attrs.success) === "false"
            ? bump(base.errorTypes, errorType)
            : base.errorTypes,
      };
      // A wrapper tool (codex's code-mode `exec`) carries OTHER dispatches:
      // each tool the script inside it invokes re-enters the agent's
      // registry and reports its own result event, so counting the wrapper
      // too would count every carried command twice. Its bytes still fold —
      // it is the run that is declined, not the record.
      const wrapperNames =
        agent !== undefined
          ? WRAPPER_TOOL_NAMES_BY_AGENT_ID.get(agent)
          : undefined;
      const wrapped = wrapperNames?.has(str(attrs.tool_name) ?? "") === true;
      // For an agent whose tool runs live on events — every logs-only agent,
      // and codex, which has no tool span — this event IS the tool run:
      // name, duration, outcome, which span-bearing agents fold from the
      // tool span instead.
      return !wrapped &&
        agent !== undefined &&
        EVENTS_FOLD_TOOL_RUNS_AGENT_IDS.has(agent)
        ? foldToolInvocation(withBytes, {
            attrs,
            failed: scalarStr(attrs.success) === "false",
            toolMs: num(attrs.duration_ms),
            startedAtMs: occurredAtMs ?? 0,
          })
        : withBytes;
    }

    case CLAUDE.EVENT.TOOL_DECISION: {
      // Claude spells a refusal `reject`; codex spells it `denied` (and
      // `denied_with_network_policy_deny`). Codex also puts the walk-away on
      // the DECISION itself — `abort`, or `timed_out` for a prompt left to
      // expire — where claude reports it as `reject` + `source: user_abort`.
      const decision = str(attrs.decision) ?? "";
      const rejected = decision === "reject" || decision.startsWith("denied");
      const walkedAway =
        decision === "abort" ||
        decision === "timed_out" ||
        ABORTED_SOURCES.has(str(attrs.source) ?? "");
      if (!rejected && !walkedAway) return base;
      // An ABORT (the human walked away from the prompt) is a different act from
      // a refusal, and NEITHER is a tool that broke. Counting them as failures
      // would report the human's judgement as the agent's fault.
      return walkedAway
        ? { ...base, toolsAborted: base.toolsAborted + 1 }
        : { ...base, toolsDenied: base.toolsDenied + 1 };
    }

    case CLAUDE.EVENT.API_ERROR:
      return {
        ...base,
        apiErrors: base.apiErrors + 1,
        rateLimited:
          base.rateLimited +
          (scalarStr(attrs.status_code) === RATE_LIMIT_STATUS ? 1 : 0),
      };

    case CLAUDE.EVENT.RETRIES_EXHAUSTED:
      return {
        ...base,
        retriesExhausted: base.retriesExhausted + 1,
        // Wall-clock burned on attempts that produced nothing.
        retryMs: base.retryMs + num(attrs.total_retry_duration_ms),
      };

    case CLAUDE.EVENT.RATE_LIMIT:
      // The agent SAYING it was throttled, kept apart from `rateLimited`
      // (inferred from 429 api_errors): this event also fires on warnings and
      // status updates, so the two counters answer different questions.
      return { ...base, rateLimitEvents: base.rateLimitEvents + 1 };

    case CLAUDE.EVENT.REFUSAL: {
      // A server-side fallback hop already retried on another model, so the user
      // never saw that refusal. Counting it would overstate how often the agent
      // actually refused the human.
      if (scalarStr(attrs.server_fallback_hop) === "true") return base;
      const category = str(attrs.category);
      return {
        ...base,
        refusals: base.refusals + 1,
        refusalCategories:
          category !== null
            ? addToBoundedSet(base.refusalCategories, category)
            : base.refusalCategories,
      };
    }

    case CLAUDE.EVENT.COMPACTION:
      return {
        ...base,
        compactions: base.compactions + 1,
        compactionTokensBefore:
          base.compactionTokensBefore + num(attrs.pre_tokens),
        compactionTokensAfter:
          base.compactionTokensAfter + num(attrs.post_tokens),
        // A manual /compact and an auto-compaction tell different stories
        // about the session; "unknown" is the honest bucket for telemetry
        // that predates the trigger attribute.
        compactionTriggers: bump(
          base.compactionTriggers,
          str(attrs.trigger) ?? "unknown",
        ),
      };

    case CLAUDE.EVENT.PERMISSION_MODE: {
      const mode = str(attrs.to_mode);
      return {
        ...base,
        permissionMode: mode ?? base.permissionMode,
        // Every widening of what the agent is allowed to do is worth auditing.
        permissionChanges: base.permissionChanges + 1,
      };
    }

    case CLAUDE.EVENT.SKILL_ACTIVATED: {
      const skill = str(attrs["skill.name"]);
      return skill !== null
        ? { ...base, skills: addToBoundedSet(base.skills, skill) }
        : base;
    }

    case CLAUDE.EVENT.MCP_CONNECTION: {
      const server = str(attrs.server_name) ?? str(attrs["plugin.name"]);
      return server !== null
        ? { ...base, mcpServers: addToBoundedSet(base.mcpServers, server) }
        : base;
    }

    case CLAUDE.EVENT.HOOK_COMPLETE:
      // The safeguards that actually FIRED: a hook that returned a blocking
      // decision stopped the agent doing something.
      return {
        ...base,
        hooksBlocked: base.hooksBlocked + num(attrs.num_blocking),
        hooksCancelled: base.hooksCancelled + num(attrs.num_cancelled),
        hookMs: base.hookMs + num(attrs.total_duration_ms),
      };

    case CLAUDE.EVENT.AT_MENTION:
      return { ...base, atMentions: base.atMentions + 1 };

    case CODEX.EVENT.TURN_TTFT: {
      // Codex reports TTFT as its own event; claude carries it on the
      // llm_request span. Both land in the same sum + count, and a zero is
      // "not measured", never a sample.
      const ttftMs = num(attrs.duration_ms);
      return ttftMs > 0
        ? {
            ...base,
            ttftMsTotal: base.ttftMsTotal + ttftMs,
            ttftSamples: base.ttftSamples + 1,
          }
        : base;
    }

    case CLAUDE.EVENT.INTERNAL_ERROR:
      return { ...base, internalErrors: base.internalErrors + 1 };

    default:
      return base;
  }
}

/**
 * Converged metric UNITS kept per session — not series, and the difference is
 * load-bearing.
 *
 * A cumulative point converges per series; a delta point is keyed by
 * `point.pointId` (summing exactly once requires remembering each point), so
 * one unit is one POINT. A session exporting deltas on an interval therefore
 * reaches this bound on ordinary traffic, and past it the metric-fed fields
 * (lines of code, commits, PRs, edit decisions, active time) freeze silently —
 * sums already folded stay correct, they just stop moving.
 *
 * The bound has to exist (the unit map is persisted on the row). Fixing the
 * freeze means changing what a unit IS — a per-series running total, point ids
 * kept only long enough to dedup — which changes fold output and needs its own
 * version bump. Raising the number only moves the cliff.
 */
const MAX_METRIC_SERIES = 200;

/** The compact view a metric-facts contribution carries. */
export interface MetricFactsView {
  /** The converged unit's id — a series for cumulative, a point for delta. */
  seriesId: string;
  metricName: string;
  attributes: Record<string, unknown>;
  /** The unit's converged value. Replaces; never increments. */
  value: number;
}

/** A converged value may legitimately be zero — do not clamp like num(). */
function total(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Fold one METRIC contribution into the session.
 *
 * The metrics are the only signal that says what the session PRODUCED — lines
 * changed, commits, pull requests — and the only one that measures the human's
 * own time. A summary built from spans and logs alone can tell you the agent
 * ran 192 tools and can't tell you whether anything came of it.
 *
 * REPLACE, NEVER INCREMENT (ADR-056 §5): the contribution's value is a
 * converged total for its unit, so the unit's entry is overwritten and the
 * metric-fed fields are recomputed from all units. A re-observed cumulative
 * counter therefore updates the session instead of double-counting it, and a
 * replay converges to the same numbers.
 *
 * Token and cost metrics deliberately do NOT overlay here: the session's
 * tokens and cost come from its spans and logs, and adding the metric copy
 * would double them. Their converged series still land in
 * `session_metric_series` for the metric-only-session read.
 */
export function applyMetricToCodingAgentSession({
  state,
  metric,
}: {
  state: CodingAgentSessionData;
  metric: MetricFactsView;
}): CodingAgentSessionData {
  const base = withIdentity(state, metric.attributes);
  if (normalizeMetricName(metric.metricName) === null) return base;

  const isNewUnit = state.metricSeries[metric.seriesId] === undefined;
  if (
    isNewUnit &&
    Object.keys(state.metricSeries).length >= MAX_METRIC_SERIES
  ) {
    return base;
  }

  const attrs = metric.attributes;
  const fact: MetricSeriesFact = {
    metricName: metric.metricName,
    type: str(attrs.type),
    decision: str(attrs.decision),
    language: str(attrs.language),
    value: total(metric.value),
  };

  return recomputeMetricOverlay({
    ...base,
    metricSeries: { ...base.metricSeries, [metric.seriesId]: fact },
  });
}

/**
 * The metric-fed fields, recomputed whole from the converged units. These
 * fields are EXCLUSIVELY metric-fed (no span or log path writes them), so a
 * full overwrite cannot clobber another signal's work.
 */
function recomputeMetricOverlay(
  state: CodingAgentSessionData,
): CodingAgentSessionData {
  let linesAdded = 0;
  let linesRemoved = 0;
  let commits = 0;
  let pullRequests = 0;
  let editsAccepted = 0;
  let editsRejected = 0;
  let activeTimeUserSec = 0;
  let activeTimeCliSec = 0;
  let languagesEdited: string[] = [];

  for (const fact of Object.values(state.metricSeries)) {
    switch (normalizeMetricName(fact.metricName)) {
      case "lines_of_code":
        if (fact.type === "added") linesAdded += fact.value;
        if (fact.type === "removed") linesRemoved += fact.value;
        break;
      case "commit":
        commits += fact.value;
        break;
      case "pull_request":
        pullRequests += fact.value;
        break;
      case "edit_decision":
        if (fact.decision === "accept") editsAccepted += fact.value;
        else editsRejected += fact.value;
        if (fact.language !== null && fact.language !== "unknown") {
          languagesEdited = addToBoundedSet(languagesEdited, fact.language);
        }
        break;
      case "active_time":
        if (fact.type === "user") activeTimeUserSec += fact.value;
        if (fact.type === "cli") activeTimeCliSec += fact.value;
        break;
      default:
        break;
    }
  }

  return {
    ...state,
    linesAdded,
    linesRemoved,
    commits: Math.round(commits),
    pullRequests: Math.round(pullRequests),
    editsAccepted: Math.round(editsAccepted),
    editsRejected: Math.round(editsRejected),
    activeTimeUserSec,
    activeTimeCliSec,
    languagesEdited,
  };
}

export type { CodingAgentSessionData, SessionStep };
