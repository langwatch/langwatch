import { LOGS_ONLY_AGENT_IDS } from "./agents";
import { normalizeEventName, normalizeMetricName, parseMcpToolName } from "./coding-agent-normalization";
import type { CodingAgentSessionState } from "./schema";

/**
 * Derive a coding-agent SESSION from its contributions.
 *
 * The signals split the story: spans carry structure/timings/tokens/finish
 * reason, logs carry cost/denials/errors/compactions/hooks, metrics carry
 * what actually came OUT of it (lines changed, commits, PRs, human time).
 *
 * This derivation never sees a raw span or log record — the source
 * pipelines' bridges gate, normalize and lift, and what arrives here is a
 * contribution's scalar facts.
 *
 * AGENT-GENERIC in shape, CLAUDE CODE ONLY in span coverage today — the
 * columns are generic, only WHERE each fact is read from is agent-specific
 * (the {@link CLAUDE} adapter below).
 */

const MAX_STEPS = 100;
const MAX_SET = 50;

/** OTLP numeric status enum's ERROR value — never the string "error" (PR #5708). */
const SPAN_STATUS_ERROR = 2;

const CLAUDE = {
  SPAN: {
    LLM_REQUEST: "claude_code.llm_request",
    TOOL: "claude_code.tool",
    TOOL_EXECUTION: "claude_code.tool.execution",
    BLOCKED_ON_USER: "claude_code.tool.blocked_on_user",
    SUBAGENT_SPAWN: "claude_code.subagent.spawn",
  },
  EVENT: {
    USER_PROMPT: "user_prompt",
    ASSISTANT_RESPONSE: "assistant_response",
    API_REQUEST: "api_request",
    TOOL_RESULT: "tool_result",
    TOOL_DECISION: "tool_decision",
    API_ERROR: "api_error",
    RETRIES_EXHAUSTED: "retries_exhausted",
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

/** The span names this derivation reads — the dispatcher's enqueue-time gate. */
export const CODING_AGENT_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE.SPAN.LLM_REQUEST,
  CLAUDE.SPAN.TOOL,
  CLAUDE.SPAN.TOOL_EXECUTION,
  CLAUDE.SPAN.BLOCKED_ON_USER,
  CLAUDE.SPAN.SUBAGENT_SPAWN,
]);

const RATE_LIMIT_STATUS = "429";
const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "refusal"]);
const CACHE_REBUILD_RATIO_THRESHOLD = 0.5;
const CACHE_REBUILD_MIN_TOKENS = 1_000;
const ABORTED_SOURCES = new Set(["user_abort"]);

/** The whole session state, data plus the identity/bookkeeping fields the fold owns. */
export function initCodingAgentSessionState(): CodingAgentSessionState {
  return {
    agent: null,
    sessionId: null,
    agentVersion: null,
    terminalType: null,
    entrypoint: null,
    finalRequestId: null,
    userId: null,
    sessionKeySource: "",
    traceIds: [],

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
    peakContextTokens: 0,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    previousCallContextTokens: 0,

    failedTools: 0,
    errorTypes: {},
    apiErrors: 0,
    rateLimited: 0,
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

    startedAtMs: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Contribution facts carry raw scalars, so flag/status comparisons must not go through `str()`. */
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

function bump(map: Record<string, number>, key: string, by = 1): Record<string, number> {
  if (map[key] === undefined && Object.keys(map).length >= MAX_SET) return map;
  return { ...map, [key]: (map[key] ?? 0) + by };
}

/**
 * Append a step, keeping the list in the order the steps actually HAPPENED
 * (spans arrive in export order, not start order) and batching a back-to-back
 * run of the same tool into one. Batching only collapses ADJACENT runs.
 */
function appendStep(
  steps: CodingAgentSessionState["steps"],
  step: { name: string; startedAtMs: number; failed: boolean },
): CodingAgentSessionState["steps"] {
  let index = steps.length;
  while (index > 0 && (steps[index - 1]?.startedAtMs ?? 0) > step.startedAtMs) {
    index--;
  }

  const previous = steps[index - 1];
  if (previous && previous.name === step.name) {
    const merged = { ...previous, count: previous.count + 1, failed: previous.failed || step.failed };
    return [...steps.slice(0, index - 1), merged, ...steps.slice(index)];
  }

  const next = steps[index];
  if (next && next.name === step.name) {
    const merged = { ...next, startedAtMs: step.startedAtMs, count: next.count + 1, failed: next.failed || step.failed };
    return [...steps.slice(0, index), merged, ...steps.slice(index + 1)];
  }

  if (steps.length >= MAX_STEPS) return steps;
  return [
    ...steps.slice(0, index),
    { name: step.name, count: 1, failed: step.failed, startedAtMs: step.startedAtMs },
    ...steps.slice(index),
  ];
}

/** Record a sub-agent by its id — the only reliable evidence one ran (spawn events are not emitted in practice). */
function seenSubAgent(
  state: CodingAgentSessionState,
  agentId: string,
): Partial<CodingAgentSessionState> {
  if (state.subAgentIds.includes(agentId)) return {};
  if (state.subAgentIds.length >= MAX_SET) return {};
  const subAgentIds = [...state.subAgentIds, agentId];
  return { subAgentIds, subAgents: subAgentIds.length };
}

/** Identity that rides on every signal, so any of them can establish it. */
function withIdentity(
  state: CodingAgentSessionState,
  attrs: Record<string, unknown>,
): CodingAgentSessionState {
  return {
    ...state,
    agentVersion: state.agentVersion ?? str(attrs["app.version"]) ?? str(attrs["service.version"]),
    terminalType: state.terminalType ?? str(attrs["terminal.type"]),
    entrypoint: state.entrypoint ?? str(attrs["app.entrypoint"]),
    userId:
      state.userId ??
      str(attrs["user.id"]) ??
      str(attrs["user.account_uuid"]) ??
      str(attrs["user.account_id"]),
  };
}

/**
 * Fold one model call into the session, from whichever signal carries it —
 * a `claude_code.llm_request` span, or a logs-only agent's `api_request`
 * event. The caller gates which carrier counts for its agent.
 */
function foldModelCall(
  next: CodingAgentSessionState,
  attrs: Record<string, unknown>,
  fallbackDurationMs: number,
): CodingAgentSessionState {
  const agentId = str(attrs.agent_id);
  if (agentId !== null) Object.assign(next, seenSubAgent(next, agentId));
  const stopReason = str(attrs.stop_reason);
  const ttft = num(attrs.ttft_ms);
  const model = str(attrs.model) ?? str(attrs["gen_ai.request.model"]);
  const requestId = str(attrs.request_id);

  const cacheReadTokens = num(attrs.cache_read_tokens);
  const cacheCreationTokens = num(attrs.cache_creation_tokens);
  const contextTokens = cacheReadTokens + cacheCreationTokens;
  const isRebuild =
    next.previousCallContextTokens > 0 &&
    cacheCreationTokens >= CACHE_REBUILD_MIN_TOKENS &&
    cacheCreationTokens / next.previousCallContextTokens >= CACHE_REBUILD_RATIO_THRESHOLD;

  return {
    ...next,
    modelCalls: next.modelCalls + 1,
    modelCallMs: next.modelCallMs + (num(attrs.duration_ms) || fallbackDurationMs),
    ttftMsTotal: next.ttftMsTotal + ttft,
    ttftSamples: next.ttftSamples + (ttft > 0 ? 1 : 0),
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
    finalRequestId: requestId ?? next.finalRequestId,
    ...(stopReason !== null
      ? { stopReason, truncated: TRUNCATING_STOP_REASONS.has(stopReason) }
      : {}),
  };
}

/** The compact span view a span-facts contribution carries. */
export interface SpanFactsView {
  name: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  /** OTLP numeric status enum (0 unset / 1 ok / 2 error). */
  statusCode: number;
  facts: Record<string, unknown>;
}

/** Fold one SPAN's facts into the session. */
export function applySpanToCodingAgentSession({
  state,
  span,
  agent,
}: {
  state: CodingAgentSessionState;
  span: SpanFactsView;
  /** The contribution's own detected agent — a logs-only agent (Cowork) can still export spans, so the gate is enforced here too, not just declared. */
  agent?: string;
}): CodingAgentSessionState {
  const attrs = span.facts;
  const durationMs = Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs);
  const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);

  if (span.name === CLAUDE.SPAN.LLM_REQUEST) {
    return isLogsOnly ? withIdentity(state, attrs) : foldModelCall(withIdentity(state, attrs), attrs, durationMs);
  }

  if (span.name === CLAUDE.SPAN.SUBAGENT_SPAWN) {
    const next = withIdentity(state, attrs);
    const agentType = str(attrs.agent_type) ?? str(attrs.subagent_type);
    const agentId = str(attrs.agent_id);
    return {
      ...next,
      ...(agentId !== null ? seenSubAgent(next, agentId) : {}),
      subAgentTypes: agentType !== null ? addToBoundedSet(next.subAgentTypes, agentType) : next.subAgentTypes,
    };
  }

  if (span.name === CLAUDE.SPAN.BLOCKED_ON_USER) {
    return { ...state, blockedOnUserMs: state.blockedOnUserMs + (num(attrs.duration_ms) || durationMs) };
  }

  if (span.name !== CLAUDE.SPAN.TOOL) return state;
  if (isLogsOnly) return withIdentity(state, attrs);

  return foldToolInvocation(withIdentity(state, attrs), {
    attrs,
    failed: span.statusCode === SPAN_STATUS_ERROR,
    toolMs: num(attrs.duration_ms) || durationMs,
    startedAtMs: span.startTimeUnixMs,
  });
}

/**
 * Fold one tool invocation, from a span (`claude_code.tool`) or a logs-only
 * agent's `tool_result` event. The caller gates which carrier counts.
 */
function foldToolInvocation(
  next: CodingAgentSessionState,
  { attrs, failed, toolMs, startedAtMs }: { attrs: Record<string, unknown>; failed: boolean; toolMs: number; startedAtMs: number },
): CodingAgentSessionState {
  const toolName = str(attrs.tool_name);

  const withTool: CodingAgentSessionState = {
    ...next,
    toolCalls: next.toolCalls + 1,
    failedTools: next.failedTools + (failed ? 1 : 0),
    toolMs: next.toolMs + toolMs,
  };

  if (toolName === null) return withTool;

  withTool.toolCounts = bump(next.toolCounts, toolName);
  if (toolMs > 0) withTool.toolDurationMs = bump(next.toolDurationMs, toolName, toolMs);

  // A sub-agent runs its own conversation; its work still counts toward the
  // totals, but its steps do not splice into the main thread's sequence.
  const toolAgentId = str(attrs.agent_id);
  if (toolAgentId !== null) Object.assign(withTool, seenSubAgent(withTool, toolAgentId));
  if (toolAgentId === null) {
    withTool.steps = appendStep(next.steps, { name: toolName, startedAtMs, failed });
  }

  const filePath = str(attrs.file_path);
  if (filePath !== null) withTool.filesTouched = addToBoundedSet(next.filesTouched, filePath);

  const skillName = str(attrs.skill_name);
  if (skillName !== null) withTool.skills = addToBoundedSet(next.skills, skillName);

  // An MCP call announces itself in its NAME (`mcp__<server>__<tool>`), the
  // signal that actually arrives; the attributes are a bonus when present.
  const fromName = parseMcpToolName(toolName);
  const mcpServer = str(attrs["mcp_server.name"]) ?? fromName?.server ?? null;
  if (mcpServer !== null) withTool.mcpServers = addToBoundedSet(next.mcpServers, mcpServer);
  const mcpTool = str(attrs["mcp_tool.name"]) ?? fromName?.tool ?? null;
  if (mcpTool !== null) withTool.mcpTools = addToBoundedSet(next.mcpTools, mcpTool);

  return withTool;
}

/**
 * Fold one LOG record's facts into the session — the facts with NO span: a
 * denied tool, a failed-and-retried call, the authoritative cost, a
 * compaction, a hook. For a logs-only agent the log is ALSO the carrier of
 * what spans normally carry.
 */
export function applyLogToCodingAgentSession({
  state,
  attributes,
  agent,
  occurredAtMs,
}: {
  state: CodingAgentSessionState;
  attributes: Record<string, unknown>;
  /** The contribution's own detected agent — deliberately not the folded state's (first-writer-wins). */
  agent?: string;
  occurredAtMs?: number;
}): CodingAgentSessionState {
  const attrs = attributes;
  const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);
  const event = normalizeEventName(str(attrs["event.name"]));
  if (event === null) return state;

  const base = withIdentity(state, attrs);

  switch (event) {
    case CLAUDE.EVENT.USER_PROMPT: {
      const command = str(attrs.command_name);
      return {
        ...base,
        prompts: base.prompts + 1,
        promptChars: base.promptChars + num(attrs.prompt_length),
        slashCommands: command !== null ? addToBoundedSet(base.slashCommands, command) : base.slashCommands,
      };
    }

    case CLAUDE.EVENT.ASSISTANT_RESPONSE:
      return { ...base, responseChars: base.responseChars + num(attrs.response_length) };

    case CLAUDE.EVENT.API_REQUEST: {
      const withCost = { ...base, costUsd: base.costUsd + num(attrs.cost_usd) };
      return isLogsOnly ? foldModelCall(withCost, attrs, 0) : withCost;
    }

    case CLAUDE.EVENT.TOOL_RESULT: {
      const errorType = str(attrs.error_type);
      const withBytes = {
        ...base,
        toolResultBytes: base.toolResultBytes + num(attrs.tool_result_size_bytes),
        toolInputBytes: base.toolInputBytes + num(attrs.tool_input_size_bytes),
        errorTypes:
          errorType !== null && scalarStr(attrs.success) === "false" ? bump(base.errorTypes, errorType) : base.errorTypes,
      };
      return isLogsOnly
        ? foldToolInvocation(withBytes, {
            attrs,
            failed: scalarStr(attrs.success) === "false",
            toolMs: num(attrs.duration_ms),
            startedAtMs: occurredAtMs ?? 0,
          })
        : withBytes;
    }

    case CLAUDE.EVENT.TOOL_DECISION: {
      if (str(attrs.decision) !== "reject") return base;
      const source = str(attrs.source) ?? "";
      return ABORTED_SOURCES.has(source)
        ? { ...base, toolsAborted: base.toolsAborted + 1 }
        : { ...base, toolsDenied: base.toolsDenied + 1 };
    }

    case CLAUDE.EVENT.API_ERROR:
      return {
        ...base,
        apiErrors: base.apiErrors + 1,
        rateLimited: base.rateLimited + (scalarStr(attrs.status_code) === RATE_LIMIT_STATUS ? 1 : 0),
      };

    case CLAUDE.EVENT.RETRIES_EXHAUSTED:
      return {
        ...base,
        retriesExhausted: base.retriesExhausted + 1,
        retryMs: base.retryMs + num(attrs.total_retry_duration_ms),
      };

    case CLAUDE.EVENT.REFUSAL: {
      if (scalarStr(attrs.server_fallback_hop) === "true") return base;
      const category = str(attrs.category);
      return {
        ...base,
        refusals: base.refusals + 1,
        refusalCategories: category !== null ? addToBoundedSet(base.refusalCategories, category) : base.refusalCategories,
      };
    }

    case CLAUDE.EVENT.COMPACTION:
      return {
        ...base,
        compactions: base.compactions + 1,
        compactionTokensBefore: base.compactionTokensBefore + num(attrs.pre_tokens),
        compactionTokensAfter: base.compactionTokensAfter + num(attrs.post_tokens),
      };

    case CLAUDE.EVENT.PERMISSION_MODE: {
      const mode = str(attrs.to_mode);
      return { ...base, permissionMode: mode ?? base.permissionMode, permissionChanges: base.permissionChanges + 1 };
    }

    case CLAUDE.EVENT.SKILL_ACTIVATED: {
      const skill = str(attrs["skill.name"]);
      return skill !== null ? { ...base, skills: addToBoundedSet(base.skills, skill) } : base;
    }

    case CLAUDE.EVENT.MCP_CONNECTION: {
      const server = str(attrs.server_name) ?? str(attrs["plugin.name"]);
      return server !== null ? { ...base, mcpServers: addToBoundedSet(base.mcpServers, server) } : base;
    }

    case CLAUDE.EVENT.HOOK_COMPLETE:
      return {
        ...base,
        hooksBlocked: base.hooksBlocked + num(attrs.num_blocking),
        hooksCancelled: base.hooksCancelled + num(attrs.num_cancelled),
        hookMs: base.hookMs + num(attrs.total_duration_ms),
      };

    case CLAUDE.EVENT.AT_MENTION:
      return { ...base, atMentions: base.atMentions + 1 };

    case CLAUDE.EVENT.INTERNAL_ERROR:
      return { ...base, internalErrors: base.internalErrors + 1 };

    default:
      return base;
  }
}

/**
 * Converged metric UNITS kept per session — a cumulative point converges per
 * series, a delta point is keyed by its own point id (so one unit is one
 * point). Bounded; past the bound the metric-fed fields freeze rather than
 * grow unboundedly.
 */
const MAX_METRIC_SERIES = 200;

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
 * Fold one METRIC contribution — the only signal that says what the session
 * PRODUCED. REPLACE, NEVER INCREMENT: the contribution's value is a converged
 * total for its unit, so the unit's entry is overwritten and the metric-fed
 * fields are recomputed from all units. Token/cost metrics deliberately do
 * NOT overlay here — those come from spans and logs; their converged series
 * still land in `session_metric_series`.
 */
export function applyMetricToCodingAgentSession({
  state,
  metric,
}: {
  state: CodingAgentSessionState;
  metric: MetricFactsView;
}): CodingAgentSessionState {
  const base = withIdentity(state, metric.attributes);
  if (normalizeMetricName(metric.metricName) === null) return base;

  const isNewUnit = state.metricSeries[metric.seriesId] === undefined;
  if (isNewUnit && Object.keys(state.metricSeries).length >= MAX_METRIC_SERIES) return base;

  const attrs = metric.attributes;
  const fact = {
    metricName: metric.metricName,
    type: str(attrs.type),
    decision: str(attrs.decision),
    language: str(attrs.language),
    value: total(metric.value),
  };

  return recomputeMetricOverlay({ ...base, metricSeries: { ...base.metricSeries, [metric.seriesId]: fact } });
}

/** The metric-fed fields, recomputed whole from the converged units — exclusively metric-fed, so a full overwrite cannot clobber another signal's work. */
function recomputeMetricOverlay(state: CodingAgentSessionState): CodingAgentSessionState {
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
