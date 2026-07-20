import type { LogRecordReceivedEventData } from "../../schemas/events";
import { type NormalizedSpan, NormalizedStatusCode } from "../../schemas/spans";
import {
  detectCodingAgent,
  isCodingAgentMetricName,
  normalizeEventName,
  parseMcpToolName,
} from "./coding-agent-normalization";
import type {
  CodingAgentSessionData,
  SessionStep,
} from "./coding-agent-session.types";

/**
 * Derive a coding-agent SESSION from its spans, its logs AND its metrics
 * (ADR-041, specs/trace-processing/coding-agent-session.feature).
 *
 * All three signals are needed, because the agent splits the story across them:
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
 * AGENT-GENERIC in shape, CLAUDE CODE ONLY in coverage today. Every coding
 * agent has a finish reason, tools, sub-agents, an approval mode, retries,
 * compaction: the columns are generic, and what differs is only WHERE each
 * fact is read from, which lives in the {@link CLAUDE} adapter below. But that
 * is the only adapter that exists: {@link CODING_AGENT_SPAN_NAMES} matches
 * claude_code.* span names, the metric application switches on Claude's metric
 * names, and the log fold assumes Claude identity. Telemetry from the other
 * agents the vocabulary layer recognises (Codex, opencode, Gemini CLI,
 * Copilot) flows through the gates but produces NO session row until its
 * adapter is written, so do not point product claims at them. The UI's
 * no-summary state says this in customer words.
 *
 * PURE, LIGHT and BOUNDED — see `coding-agent-session.types.ts`.
 */

/** Ordered steps we keep. Enough for the shape of any session to survive. */
const MAX_STEPS = 100;
/** Distinct values kept in any bounded set (files, tools, skills, servers). */
const MAX_SET = 50;

/**
 * The Claude Code adapter: the ONLY agent-specific part of this file. Span
 * names, event names, metric names, and the keys each fact rides on.
 */
const CLAUDE = {
  NAME: "claude_code",
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
  METRIC: {
    LINES_OF_CODE: "claude_code.lines_of_code.count",
    COMMIT: "claude_code.commit.count",
    PULL_REQUEST: "claude_code.pull_request.count",
    EDIT_DECISION: "claude_code.code_edit_tool.decision",
    ACTIVE_TIME: "claude_code.active_time.total",
  },
} as const;

/**
 * The span names this derivation reads. Exported so the fold can decide whether
 * a span is worth DECODING at all.
 *
 * This matters more than it looks: every trace in the project flows through this
 * fold, and normalizing a span runs the whole canonicalisation registry. Without
 * a check on the RAW name, an ordinary chat trace would pay that cost on every
 * span just to discover, at the end, that it is not a coding agent. The gate
 * turns that into one set lookup.
 */
export const CODING_AGENT_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE.SPAN.LLM_REQUEST,
  CLAUDE.SPAN.TOOL,
  CLAUDE.SPAN.TOOL_EXECUTION,
  CLAUDE.SPAN.BLOCKED_ON_USER,
  CLAUDE.SPAN.SUBAGENT_SPAWN,
]);

/**
 * The instrumentation scopes a coding agent's log events arrive under.
 *
 * A scope check ALONE is not enough, and cannot be: Codex names its scope after
 * whatever `service_name` the user configured, so there is no stable string to
 * match. Hence {@link isCodingAgentLogRecord} — scope first (cheap, and it covers
 * the two agents that do have a stable one), then the event name.
 */
export const CODING_AGENT_LOG_SCOPES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
  "com.opencode",
]);

/**
 * Is this log record worth decoding?
 *
 * Every log in the project flows through this fold, so the gate has to be cheap
 * AND it has to not exclude an agent by accident — which the scope-only version
 * did: opencode's records were dropped wholesale, and Codex's always would be.
 */
export function isCodingAgentLogRecord({
  scopeName,
  eventName,
}: {
  scopeName?: string | null;
  eventName?: string | null;
}): boolean {
  if (scopeName && CODING_AGENT_LOG_SCOPES.has(scopeName)) return true;
  // A namespaced event name (`codex.tool_result`) identifies its agent on its
  // own — which is the only thing Codex gives us to go on.
  return (
    detectCodingAgent({ scopeName, recordName: eventName }) !== "unknown" &&
    normalizeEventName(eventName) !== null
  );
}

/**
 * Metric names a coding agent emits.
 *
 * Delegates to the shared vocabulary. It used to be
 * `startsWith("claude_code.")`, which would have dropped every opencode, Codex
 * and Gemini metric at the gate — after all the trouble of normalizing them.
 */
export function isCodingAgentMetric(metricName: string): boolean {
  return isCodingAgentMetricName(metricName);
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

/** True when this trace is a coding-agent session at all. */
export function isCodingAgentSession(state: CodingAgentSessionData): boolean {
  return state.modelCalls > 0 || state.toolCalls > 0;
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

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Add to a bounded set, in first-seen order. */
function addTo(set: string[], value: string): string[] {
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

/** Identity that rides on every signal, so any of them can establish it. */
function withIdentity(
  state: CodingAgentSessionData,
  attrs: Record<string, unknown>,
  resourceAttrs: Record<string, unknown> = {},
): CodingAgentSessionData {
  return {
    ...state,
    agent: state.agent ?? CLAUDE.NAME,
    sessionId: state.sessionId ?? str(attrs["session.id"]),
    agentVersion:
      state.agentVersion ??
      str(attrs["app.version"]) ??
      str(resourceAttrs["service.version"]),
    terminalType: state.terminalType ?? str(attrs["terminal.type"]),
    entrypoint: state.entrypoint ?? str(attrs["app.entrypoint"]),
    // Claude stamps user identity on log events, not spans; other agents send
    // none at all, so a session they produce honestly keeps null here.
    userId: state.userId ?? str(attrs["user.id"]) ?? str(attrs["user.email"]),
  };
}

/** Fold one SPAN into the session. */
export function applySpanToCodingAgentSession({
  state,
  span,
}: {
  state: CodingAgentSessionData;
  span: NormalizedSpan;
}): CodingAgentSessionData {
  const attrs = span.spanAttributes;
  const durationMs = Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs);

  if (span.name === CLAUDE.SPAN.LLM_REQUEST) {
    const next = withIdentity(state, attrs);
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
      modelCallMs: next.modelCallMs + (num(attrs.duration_ms) || durationMs),
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
      models: model !== null ? addTo(next.models, model) : next.models,
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

  if (span.name === CLAUDE.SPAN.SUBAGENT_SPAWN) {
    const next = withIdentity(state, attrs);
    const agentType = str(attrs.agent_type) ?? str(attrs.subagent_type);
    const agentId = str(attrs.agent_id);
    return {
      ...next,
      ...(agentId !== null ? seenSubAgent(next, agentId) : {}),
      subAgentTypes:
        agentType !== null
          ? addTo(next.subAgentTypes, agentType)
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

  const next = withIdentity(state, attrs);
  const toolName = str(attrs.tool_name);
  // NOT `=== "error"`. `statusCode` is the OTLP numeric enum, so comparing it to
  // a string is always false — which is exactly what it did: every tool folded as
  // successful, `failedTools` stayed 0 on sessions that plainly had failures, and
  // every step in the sequence was marked `failed: false`. Silent, because a
  // comparison that can never be true throws nothing.
  const failed = span.statusCode === NormalizedStatusCode.ERROR;
  const toolMs = num(attrs.duration_ms) || durationMs;

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
      startedAtMs: span.startTimeUnixMs,
      failed,
    });
  }

  const filePath = str(attrs.file_path);
  if (filePath !== null) {
    withTool.filesTouched = addTo(next.filesTouched, filePath);
  }

  // A skill reaches the session two ways: the `skill_activated` event and the
  // Skill TOOL span. A skill the agent invoked proactively arrives on one path,
  // a `/slash` skill on the other — reading only one loses half of them.
  const skillName = str(attrs.skill_name);
  if (skillName !== null) withTool.skills = addTo(next.skills, skillName);

  // An MCP call announces itself in its NAME — `mcp__<server>__<tool>` — and that
  // is the signal that actually arrives. Reading only the `mcp_server.name` /
  // `mcp_tool.name` attributes found nothing on real sessions: a session that had
  // plainly called an MCP server reported using none, because the agent doesn't
  // emit those attributes on the tool span. So parse the name first and treat the
  // attributes as a bonus for agents that DO send them.
  const fromName = parseMcpToolName(toolName);
  const mcpServer = str(attrs["mcp_server.name"]) ?? fromName?.server ?? null;
  if (mcpServer !== null) {
    withTool.mcpServers = addTo(next.mcpServers, mcpServer);
  }
  const mcpTool = str(attrs["mcp_tool.name"]) ?? fromName?.tool ?? null;
  if (mcpTool !== null) withTool.mcpTools = addTo(next.mcpTools, mcpTool);

  return withTool;
}

/**
 * Fold one LOG RECORD into the session.
 *
 * These are the facts with NO span: the tool the user denied (it never ran), the
 * model call that failed and was retried (a failed call has no successful span),
 * the authoritative cost, the compaction, the hook that blocked an action.
 */
export function applyLogToCodingAgentSession({
  state,
  data,
}: {
  state: CodingAgentSessionData;
  data: LogRecordReceivedEventData;
}): CodingAgentSessionData {
  const attrs = data.attributes;
  // Normalize the agent's spelling into one vocabulary before matching. Claude
  // Code and Codex namespace their event names (`claude_code.tool_result`,
  // `codex.tool_result`); opencode sends a bare `tool_result` and dots its
  // session events (`session.created`). Matching the raw string would have meant
  // three switch statements that drift apart.
  const event = normalizeEventName(str(attrs["event.name"]));
  if (event === null) return state;

  const base = withIdentity(state, attrs, data.resourceAttributes ?? {});

  switch (event) {
    case CLAUDE.EVENT.USER_PROMPT: {
      const command = str(attrs.command_name);
      return {
        ...base,
        prompts: base.prompts + 1,
        // The length, never the text.
        promptChars: base.promptChars + num(attrs.prompt_length),
        slashCommands:
          command !== null
            ? addTo(base.slashCommands, command)
            : base.slashCommands,
      };
    }

    case CLAUDE.EVENT.ASSISTANT_RESPONSE:
      return {
        ...base,
        responseChars: base.responseChars + num(attrs.response_length),
      };

    case CLAUDE.EVENT.API_REQUEST:
      // The authoritative cost: the agent reports what it was actually billed,
      // which no span carries.
      return { ...base, costUsd: base.costUsd + num(attrs.cost_usd) };

    case CLAUDE.EVENT.TOOL_RESULT: {
      const errorType = str(attrs.error_type);
      return {
        ...base,
        // Bytes of tool OUTPUT fed back into the context — the usual cause of a
        // session bloating its way into a compaction.
        toolResultBytes:
          base.toolResultBytes + num(attrs.tool_result_size_bytes),
        toolInputBytes: base.toolInputBytes + num(attrs.tool_input_size_bytes),
        errorTypes:
          errorType !== null && str(attrs.success) === "false"
            ? bump(base.errorTypes, errorType)
            : base.errorTypes,
      };
    }

    case CLAUDE.EVENT.TOOL_DECISION: {
      if (str(attrs.decision) !== "reject") return base;
      const source = str(attrs.source) ?? "";
      // An ABORT (the human walked away from the prompt) is a different act from
      // a refusal, and NEITHER is a tool that broke. Counting them as failures
      // would report the human's judgement as the agent's fault.
      return ABORTED_SOURCES.has(source)
        ? { ...base, toolsAborted: base.toolsAborted + 1 }
        : { ...base, toolsDenied: base.toolsDenied + 1 };
    }

    case CLAUDE.EVENT.API_ERROR:
      return {
        ...base,
        apiErrors: base.apiErrors + 1,
        rateLimited:
          base.rateLimited +
          (str(attrs.status_code) === RATE_LIMIT_STATUS ? 1 : 0),
      };

    case CLAUDE.EVENT.RETRIES_EXHAUSTED:
      return {
        ...base,
        retriesExhausted: base.retriesExhausted + 1,
        // Wall-clock burned on attempts that produced nothing.
        retryMs: base.retryMs + num(attrs.total_retry_duration_ms),
      };

    case CLAUDE.EVENT.REFUSAL: {
      // A server-side fallback hop already retried on another model, so the user
      // never saw that refusal. Counting it would overstate how often the agent
      // actually refused the human.
      if (str(attrs.server_fallback_hop) === "true") return base;
      const category = str(attrs.category);
      return {
        ...base,
        refusals: base.refusals + 1,
        refusalCategories:
          category !== null
            ? addTo(base.refusalCategories, category)
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
        ? { ...base, skills: addTo(base.skills, skill) }
        : base;
    }

    case CLAUDE.EVENT.MCP_CONNECTION: {
      const server = str(attrs.server_name) ?? str(attrs["plugin.name"]);
      return server !== null
        ? { ...base, mcpServers: addTo(base.mcpServers, server) }
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

    case CLAUDE.EVENT.INTERNAL_ERROR:
      return { ...base, internalErrors: base.internalErrors + 1 };

    default:
      return base;
  }
}

/**
 * Fold one METRIC into the session.
 *
 * The metrics are the only signal that says what the session PRODUCED — lines
 * changed, commits, pull requests — and the only one that measures the human's
 * own time. A summary built from spans and logs alone can tell you the agent ran
 * 192 tools and can't tell you whether anything came of it.
 */
/**
 * Structural on purpose: the legacy metric event this used to consume is gone
 * (metrics live in their own canonical pipeline now), and the caller is the
 * READ-side session join, which shapes canonical datapoint rows into this.
 */
export interface CodingAgentMetricRecord {
  metricName: string;
  value: number;
  attributes: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}

export function applyMetricToCodingAgentSession({
  state,
  data,
}: {
  state: CodingAgentSessionData;
  data: CodingAgentMetricRecord;
}): CodingAgentSessionData {
  const attrs = data.attributes;
  const value = num(data.value);
  const base = withIdentity(state, attrs, data.resourceAttributes ?? {});

  switch (data.metricName) {
    case CLAUDE.METRIC.LINES_OF_CODE: {
      const type = str(attrs.type);
      if (type === "added")
        return { ...base, linesAdded: base.linesAdded + value };
      if (type === "removed") {
        return { ...base, linesRemoved: base.linesRemoved + value };
      }
      return base;
    }

    case CLAUDE.METRIC.COMMIT:
      return { ...base, commits: base.commits + value };

    case CLAUDE.METRIC.PULL_REQUEST:
      return { ...base, pullRequests: base.pullRequests + value };

    case CLAUDE.METRIC.EDIT_DECISION: {
      const accepted = str(attrs.decision) === "accept";
      const language = str(attrs.language);
      return {
        ...base,
        editsAccepted: base.editsAccepted + (accepted ? value : 0),
        editsRejected: base.editsRejected + (accepted ? 0 : value),
        languagesEdited:
          language !== null && language !== "unknown"
            ? addTo(base.languagesEdited, language)
            : base.languagesEdited,
      };
    }

    case CLAUDE.METRIC.ACTIVE_TIME: {
      const type = str(attrs.type);
      if (type === "user") {
        return { ...base, activeTimeUserSec: base.activeTimeUserSec + value };
      }
      if (type === "cli") {
        return { ...base, activeTimeCliSec: base.activeTimeCliSec + value };
      }
      return base;
    }

    default:
      return base;
  }
}

export type { CodingAgentSessionData, SessionStep };
