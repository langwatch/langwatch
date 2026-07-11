import type { LogRecordReceivedEventData } from "../../schemas/events";
import type { NormalizedSpan } from "../../schemas/spans";

/**
 * A coding-agent SESSION, derived from the spans and the logs as they arrive.
 *
 * See ADR-040. Three facts drive the whole design:
 *
 * 1. **A trace IS the session.** Claude Code's native tracer groups a whole
 *    session under one traceId — one real session measured 796 spans, 34 model
 *    calls, 192 tool runs — and the per-prompt `interaction` span it might have
 *    been split on is emitted so rarely (3 times across every trace in 30 days)
 *    that it is not a seam we can rely on.
 *
 * 2. **The facts are split across signals.** Structure is in the spans; content
 *    and half the story are in the logs. A tool the user DENIED produces no span
 *    at all — read only the spans and the agent merely appears to change its
 *    mind.
 *
 * 3. **The facts are not agent-specific.** Every coding agent has a finish
 *    reason, tools, sub-agents, an approval mode, retries, context compaction.
 *    Only WHERE we read them from differs — so that lives in the {@link CLAUDE}
 *    adapter below, and everything else is agent-generic. A Codex adapter plugs
 *    in beside it and every consumer reads the same fields.
 *
 * Derived once, at write time, so the app, the CLI and the MCP server all serve
 * the same numbers instead of each re-joining 60 KB payloads per request.
 *
 * PURE. No IO. The fold owns the state; this only folds one event into it.
 *
 * BOUNDED: nothing here may grow with the length of the session. The step list
 * and the file list are capped; everything else is a counter or a small set.
 * That invariant is what makes it safe to summarise an unbounded session at all
 * (it is the same one that let us delete MAX_PROCESSED_SPANS).
 */

/** Ordered steps we keep. Enough for the shape of any session to survive. */
const MAX_STEPS = 100;
/** Distinct files we keep. A big refactor touches hundreds. */
const MAX_FILES = 50;
/** Distinct values kept in any of the small sets (tools, skills, MCP servers). */
const MAX_SET = 50;

/**
 * The Claude Code adapter: the ONLY agent-specific part. Span names, event
 * names, and the attribute keys each fact rides on.
 */
const CLAUDE = {
  SPAN: {
    LLM_REQUEST: "claude_code.llm_request",
    TOOL: "claude_code.tool",
    TOOL_EXECUTION: "claude_code.tool.execution",
    SUBAGENT_SPAWN: "claude_code.subagent.spawn",
    INTERACTION: "claude_code.interaction",
  },
  EVENT: {
    USER_PROMPT: "user_prompt",
    TOOL_DECISION: "tool_decision",
    API_ERROR: "api_error",
    RETRIES_EXHAUSTED: "api_retries_exhausted",
    REFUSAL: "api_refusal",
    COMPACTION: "compaction",
    PERMISSION_MODE: "permission_mode_changed",
    SKILL_ACTIVATED: "skill_activated",
    MCP_CONNECTION: "mcp_server_connection",
  },
} as const;

/** HTTP 429. The one error worth telling apart from every other error. */
const RATE_LIMIT_STATUS = "429";

/** A decision that means the human stopped the agent, not that the tool broke. */
const DENIED_SOURCES = new Set(["user_reject", "user_permanent"]);
const ABORTED_SOURCES = new Set(["user_abort"]);

/** One thing the agent did, in the order it did it. */
export interface SessionStep {
  /** The tool's name. */
  name: string;
  /** How many times it ran back-to-back — a run of eight reads is one step. */
  count: number;
  /** True when any run in the batch failed. */
  failed: boolean;
  /** When the first run of the batch started; used to keep the order true. */
  startedAtMs: number;
}

export interface CodingAgentSessionData {
  /** Which agent produced this. Generic; the adapter sets it. */
  agent: string | null;

  // ── Shape ────────────────────────────────────────────────────────────
  modelCalls: number;
  toolCalls: number;
  subAgents: number;
  /** In the order they happened, batched, failures marked in place. */
  steps: SessionStep[];

  // ── Work ─────────────────────────────────────────────────────────────
  /** Tool name → how many times it ran. */
  toolCounts: Record<string, number>;
  /** Tool name → total milliseconds spent in it. */
  toolDurationMs: Record<string, number>;
  filesTouched: string[];
  skills: string[];
  subAgentTypes: string[];
  slashCommands: string[];
  mcpServers: string[];

  // ── What went wrong ──────────────────────────────────────────────────
  failedTools: number;
  apiErrors: number;
  /** Rate limits (429) — worth telling apart from every other failure. */
  rateLimited: number;
  retriesExhausted: number;
  refusals: number;

  // ── What the human did ───────────────────────────────────────────────
  /** Tools the user DENIED. They never ran, so they have no span. */
  toolsDenied: number;
  /** Tools the user aborted mid-run. Not the same as a tool that broke. */
  toolsAborted: number;
  /** The approval mode the session ended in (plan, bypassPermissions, …). */
  permissionMode: string | null;

  // ── What the agent did to itself ─────────────────────────────────────
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;

  // ── How it ended ─────────────────────────────────────────────────────
  /** The FINAL model call's stop reason — the earlier ones all say tool_use. */
  stopReason: string | null;
  /** The reply was CUT OFF rather than finished. Not an answer. */
  truncated: boolean;
}

/** A reply that stopped for one of these did NOT finish answering. */
const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "refusal"]);

export function createInitCodingAgentSession(): CodingAgentSessionData {
  return {
    agent: null,
    modelCalls: 0,
    toolCalls: 0,
    subAgents: 0,
    steps: [],
    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    mcpServers: [],
    failedTools: 0,
    apiErrors: 0,
    rateLimited: 0,
    retriesExhausted: 0,
    refusals: 0,
    toolsDenied: 0,
    toolsAborted: 0,
    permissionMode: null,
    compactions: 0,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    stopReason: null,
    truncated: false,
  };
}

/** True when this trace is a coding-agent session at all. */
export function isCodingAgentSession(state: CodingAgentSessionData): boolean {
  return state.modelCalls > 0 || state.toolCalls > 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function int(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Add to a bounded set, in first-seen order. */
function addTo(set: string[], value: string): string[] {
  if (set.includes(value) || set.length >= MAX_SET) return set;
  return [...set, value];
}

/**
 * Append a step, keeping the list in the order the steps actually HAPPENED, and
 * batching a back-to-back run of the same tool into one step.
 *
 * Load-bearing: spans arrive in EXPORT order, not start order — they are batched
 * on the wire, so a slow tool's span can land after a later one's. Appending
 * blindly would produce a plausible-looking but WRONG sequence, which is worse
 * than showing none. So each step carries its start time and is placed by it.
 *
 * Batching only ever collapses ADJACENT runs. `Read Read Bash Read` stays
 * `Read x2, Bash, Read` — the return to Read after the Bash is a different beat
 * of the story (it checked, ran, checked again) and merging it would erase that.
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
    { name: step.name, count: 1, failed: step.failed, startedAtMs: step.startedAtMs },
    ...steps.slice(index),
  ];
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

  if (span.name === CLAUDE.SPAN.LLM_REQUEST) {
    const stopReason = str(attrs.stop_reason);
    return {
      ...state,
      agent: state.agent ?? "claude_code",
      modelCalls: state.modelCalls + 1,
      // Only the LAST call's stop reason is the session's: the earlier ones all
      // stop on `tool_use` by definition, since that is what drove the loop on.
      // Last-write-wins across the fold gives us the final call's.
      ...(stopReason !== null
        ? {
            stopReason,
            truncated: TRUNCATING_STOP_REASONS.has(stopReason),
          }
        : {}),
    };
  }

  if (span.name === CLAUDE.SPAN.SUBAGENT_SPAWN) {
    const agentType = str(attrs.agent_type) ?? str(attrs.subagent_type);
    return {
      ...state,
      agent: state.agent ?? "claude_code",
      subAgents: state.subAgents + 1,
      subAgentTypes:
        agentType !== null
          ? addTo(state.subAgentTypes, agentType)
          : state.subAgentTypes,
    };
  }

  if (span.name !== CLAUDE.SPAN.TOOL) return state;

  const toolName = str(attrs.tool_name);
  const failed = span.statusCode === "error";
  const next: CodingAgentSessionData = {
    ...state,
    agent: state.agent ?? "claude_code",
    toolCalls: state.toolCalls + 1,
    failedTools: state.failedTools + (failed ? 1 : 0),
  };

  if (toolName === null) return next;

  next.toolCounts = {
    ...state.toolCounts,
    [toolName]: (state.toolCounts[toolName] ?? 0) + 1,
  };

  const durationMs = span.endTimeUnixMs - span.startTimeUnixMs;
  if (durationMs > 0) {
    next.toolDurationMs = {
      ...state.toolDurationMs,
      [toolName]: (state.toolDurationMs[toolName] ?? 0) + durationMs,
    };
  }

  // A sub-agent runs its OWN conversation and can do twenty reads of its own.
  // Splicing those into the session's steps would read as though the main thread
  // did them, flattening away the hierarchy. The sub-agent is already
  // represented by the step that SPAWNED it. `agent_id` is absent on the main
  // thread and present on every sub-agent span, so it is exactly the
  // discriminator. Its tool still counts toward the totals — the work happened.
  const isSubAgentStep = str(attrs.agent_id) !== null;
  if (!isSubAgentStep) {
    next.steps = appendStep(state.steps, {
      name: toolName,
      startedAtMs: span.startTimeUnixMs,
      failed,
    });
  }

  const filePath = str(attrs.file_path);
  if (filePath !== null && !state.filesTouched.includes(filePath)) {
    next.filesTouched =
      state.filesTouched.length < MAX_FILES
        ? [...state.filesTouched, filePath]
        : state.filesTouched;
  }

  // A skill reaches the session two ways: the `skill_activated` event, and the
  // Skill TOOL span. A skill the agent invoked proactively arrives on one path,
  // a `/slash` skill on the other — reading only one loses half of them.
  const skillName = str(attrs.skill_name);
  if (skillName !== null) next.skills = addTo(state.skills, skillName);

  const mcpServer = str(attrs["mcp_server.name"]);
  if (mcpServer !== null) next.mcpServers = addTo(state.mcpServers, mcpServer);

  return next;
}

/**
 * Fold one LOG RECORD into the session.
 *
 * These are the facts with NO span: the tool the user denied (it never ran), the
 * model call that failed and was retried (a failed call has no successful span),
 * the mid-session compaction, the slash command that opened it.
 */
export function applyLogToCodingAgentSession({
  state,
  data,
}: {
  state: CodingAgentSessionData;
  data: LogRecordReceivedEventData;
}): CodingAgentSessionData {
  const attrs = data.attributes;
  const event = str(attrs["event.name"]);
  if (event === null) return state;

  switch (event) {
    case CLAUDE.EVENT.USER_PROMPT: {
      const command = str(attrs.command_name);
      return command !== null
        ? { ...state, slashCommands: addTo(state.slashCommands, command) }
        : state;
    }

    case CLAUDE.EVENT.TOOL_DECISION: {
      if (str(attrs.decision) !== "reject") return state;
      const source = str(attrs.source) ?? "";
      // A tool the user ABORTED mid-run is a different act from one they refused
      // outright, and neither is a tool that BROKE — counting them together
      // would report the human's judgement as the agent's failure.
      if (ABORTED_SOURCES.has(source)) {
        return { ...state, toolsAborted: state.toolsAborted + 1 };
      }
      if (DENIED_SOURCES.has(source) || source === "") {
        return { ...state, toolsDenied: state.toolsDenied + 1 };
      }
      return state;
    }

    case CLAUDE.EVENT.API_ERROR: {
      const isRateLimit = str(attrs.status_code) === RATE_LIMIT_STATUS;
      return {
        ...state,
        apiErrors: state.apiErrors + 1,
        rateLimited: state.rateLimited + (isRateLimit ? 1 : 0),
      };
    }

    case CLAUDE.EVENT.RETRIES_EXHAUSTED:
      return { ...state, retriesExhausted: state.retriesExhausted + 1 };

    case CLAUDE.EVENT.REFUSAL:
      return { ...state, refusals: state.refusals + 1 };

    case CLAUDE.EVENT.COMPACTION:
      return {
        ...state,
        compactions: state.compactions + 1,
        compactionTokensBefore:
          state.compactionTokensBefore + int(attrs.pre_tokens),
        compactionTokensAfter:
          state.compactionTokensAfter + int(attrs.post_tokens),
      };

    case CLAUDE.EVENT.PERMISSION_MODE: {
      const mode = str(attrs.to_mode);
      return mode !== null ? { ...state, permissionMode: mode } : state;
    }

    case CLAUDE.EVENT.SKILL_ACTIVATED: {
      const skill = str(attrs["skill.name"]);
      return skill !== null
        ? { ...state, skills: addTo(state.skills, skill) }
        : state;
    }

    case CLAUDE.EVENT.MCP_CONNECTION: {
      const server = str(attrs.server_name) ?? str(attrs["plugin.name"]);
      return server !== null
        ? { ...state, mcpServers: addTo(state.mcpServers, server) }
        : state;
    }

    default:
      return state;
  }
}
