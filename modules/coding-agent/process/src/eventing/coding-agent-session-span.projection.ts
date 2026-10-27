import {
  EVENTS_FOLD_TOOL_RUNS_AGENT_IDS,
  genAiOperationRoleOf,
  type GenAiOperationRole,
  LOGS_ONLY_AGENT_IDS,
  SESSION_TITLE_FALLBACK_FACT_KEY,
  type SessionWorkingContext,
} from "@langwatch/coding-agent-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import {
  genAiModelCallFacts,
  modelCallCostInput,
} from "../rules/coding-agent-model-call-facts.rules.ts";
import type { CodingAgentCostEstimator } from "../services/model-catalog-cost-estimator.service.ts";
import {
  type CodingAgentSessionStateProjection,
  type CodingAgentSessionData,
} from "./coding-agent-session-state.projection.ts";

const SPAN_STATUS_ERROR = 2;
const CLAUDE = {
  SPAN: {
    LLM_REQUEST: "claude_code.llm_request",
    TOOL: "claude_code.tool",
    TOOL_EXECUTION: "claude_code.tool.execution",
    BLOCKED_ON_USER: "claude_code.tool.blocked_on_user",
    SUBAGENT_SPAWN: "claude_code.subagent.spawn",
  },
} as const;
const CODEX = {
  // `HELPER_REQUEST` is a codex helper thread's request span: its one fact is the auxiliary mark.
  SPAN: { TURN: "session_task.turn", HELPER_REQUEST: "turn/start" },
} as const;
/** The GenAI semconv key a declared tool run names its tool by. */
const GEN_AI_TOOL_NAME = "gen_ai.tool.name";
/**
 * The spans whose tokens the fold counts as a model call, across every span-bearing agent. The
 * contribute service stamps exactly these with the session's declared working context, so the fold
 * can charge their tokens to it; every other span charges nothing anywhere and rides unstamped.
 */
const MODEL_CALL_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE.SPAN.LLM_REQUEST,
  CODEX.SPAN.TURN,
]);

/** Whether the fold counts this span as a model call: a listed name, or a declared GenAI chat. */
export function isFoldedModelCall({ name, agent }: { name: string; agent: string }): boolean {
  return MODEL_CALL_SPAN_NAMES.has(name) || genAiOperationRoleOf({ agent, name }) === "modelCall";
}

interface SpanFactsView {
  name: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  statusCode: number;
  attrs: Record<string, unknown>;
}

interface CodingAgentSessionSpanProjectionInput {
  state: CodingAgentSessionData;
  span: SpanFactsView;
  agent?: string;
  /**
   * The working context the contribution was stamped with, or null when it carries none. Only a
   * model call reads it: its tokens and cost are charged to that context, which is how a span-only
   * agent's session says what it spent where.
   */
  context?: SessionWorkingContext | null;
}

/** Deterministically projects one admitted span contribution into session state. */
export class CodingAgentSessionSpanProjection {
  private constructor(
    private readonly stateProjection: CodingAgentSessionStateProjection,
    private readonly traceCanonicalisation: Pick<TraceApi, "classifyClaudeCall">,
    private readonly modelProviders: CodingAgentCostEstimator,
  ) {}

  static create(deps: {
    stateProjection: CodingAgentSessionStateProjection;
    traceCanonicalisation: Pick<TraceApi, "classifyClaudeCall">;
    modelProviders: CodingAgentCostEstimator;
  }): CodingAgentSessionSpanProjection {
    return new CodingAgentSessionSpanProjection(
      deps.stateProjection,
      deps.traceCanonicalisation,
      deps.modelProviders,
    );
  }

  private applySubagentSpawn(
    state: CodingAgentSessionData,
    attrs: SpanFactsView["attrs"],
  ): CodingAgentSessionData {
    const next = this.stateProjection.withIdentity(state, attrs);
    const agentType =
      this.stateProjection.coerceString(attrs.agent_type) ??
      this.stateProjection.coerceString(attrs.subagent_type);
    const agentId = this.stateProjection.coerceString(attrs.agent_id);
    return {
      ...next,
      ...(agentId !== null ? this.stateProjection.recordSubAgent(next, agentId) : {}),
      subAgentTypes:
        agentType !== null
          ? this.stateProjection.addToBoundedSet(next.subAgentTypes, agentType)
          : next.subAgentTypes,
    };
  }

  applySpanToCodingAgentSession({
    state,
    span,
    agent,
    context = null,
  }: CodingAgentSessionSpanProjectionInput): CodingAgentSessionData {
    const attrs = span.attrs;
    const durationMs = Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs);
    const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);

    const role =
      agent !== undefined ? genAiOperationRoleOf({ agent, name: span.name }) : "undeclared";
    if (role !== "undeclared") {
      return this.applyGenAiOperation({ state, span, role, durationMs, context });
    }

    if (span.name === CLAUDE.SPAN.LLM_REQUEST) {
      return this.applyClaudeLlmRequest({ state, attrs, durationMs, isLogsOnly, context });
    }

    if (span.name === CODEX.SPAN.TURN) {
      return this.applyCodexTurn({ state, attrs, agent, isLogsOnly, context });
    }

    if (span.name === CODEX.SPAN.HELPER_REQUEST) {
      return this.stateProjection.withIdentity(state, attrs);
    }

    if (span.name === CLAUDE.SPAN.SUBAGENT_SPAWN) return this.applySubagentSpawn(state, attrs);

    // The time a HUMAN sat waiting to approve a tool. Pure friction: the agent was
    // idle and so was the person. Nothing else in the telemetry surfaces it.
    if (span.name === CLAUDE.SPAN.BLOCKED_ON_USER) {
      return {
        ...state,
        blockedOnUserMs:
          state.blockedOnUserMs + (this.stateProjection.number(attrs.duration_ms) || durationMs),
      };
    }

    if (span.name !== CLAUDE.SPAN.TOOL) return state;

    // Same gate as the model call above, widened to every agent whose tool
    // runs fold from `tool_result` events — for them the tool span would be
    // the second count, whether their telemetry is events-only or not.
    const foldsToolRunsFromEvents =
      agent !== undefined && EVENTS_FOLD_TOOL_RUNS_AGENT_IDS.has(agent);
    if (foldsToolRunsFromEvents) return this.stateProjection.withIdentity(state, attrs);

    return this.stateProjection.foldToolInvocation(
      this.stateProjection.withIdentity(state, attrs),
      {
        attrs,
        failed: span.statusCode === SPAN_STATUS_ERROR,
        toolMs: this.stateProjection.number(attrs.duration_ms) || durationMs,
        startedAtMs: span.startTimeUnixMs,
      },
    );
  }

  private applyClaudeLlmRequest({
    state,
    attrs,
    durationMs,
    isLogsOnly,
    context,
  }: {
    state: CodingAgentSessionData;
    attrs: Record<string, unknown>;
    durationMs: number;
    isLogsOnly: boolean;
    context: NonNullable<CodingAgentSessionSpanProjectionInput["context"]> | null;
  }): CodingAgentSessionData {
    // Identity still rides the span; only the counted facts are the log's.
    if (isLogsOnly) return this.stateProjection.withIdentity(state, attrs);
    const before = this.stateProjection.withIdentity(state, attrs);
    const folded = this.stateProjection.foldModelCall({
      state: before,
      attrs,
      fallbackDurationMs: durationMs,
    });
    // Priced from the span's tokens with the same formula and the same
    // cache-write lifetime the trace pipeline applies to the identical span,
    // so the session and its traces state one figure. The cost the agent
    // reports about itself lands on agentReportedCostUsd instead.
    return this.chargePricedCall({
      before,
      folded,
      facts: this.claudeCallTokenFacts(attrs, this.traceCanonicalisation),
      context,
    });
  }

  /** One model call charged to its context at the cost computed from its tokens. */
  private chargePricedCall({
    before,
    folded,
    facts,
    context,
  }: {
    before: CodingAgentSessionData;
    folded: CodingAgentSessionData;
    facts: Record<string, unknown>;
    context: NonNullable<CodingAgentSessionSpanProjectionInput["context"]> | null;
  }): CodingAgentSessionData {
    return this.stateProjection.chargeContextUsage({
      before,
      after: {
        ...folded,
        costUsd: folded.costUsd + this.modelProviders.estimateCost(modelCallCostInput(facts)),
      },
      context,
    });
  }

  private applyCodexTurn({
    state,
    attrs,
    agent,
    isLogsOnly,
    context,
  }: {
    state: CodingAgentSessionData;
    attrs: Record<string, unknown>;
    agent: CodingAgentSessionSpanProjectionInput["agent"];
    isLogsOnly: boolean;
    context: NonNullable<CodingAgentSessionSpanProjectionInput["context"]> | null;
  }): CodingAgentSessionData {
    // The contribution's own label gates the fold: the dispatcher already
    // declined foreign spans reusing this bare name, and one that still
    // arrives labeled as another agent contributes identity only.
    if (agent !== "codex" || isLogsOnly) return this.stateProjection.withIdentity(state, attrs);
    const facts = genAiModelCallFacts(attrs);
    // Fallback duration 0, not the span's: the turn's wall time includes the
    // tools that ran inside it, and zero reads honestly as "not measured".
    const before = this.stateProjection.withIdentity(state, attrs);
    const folded = this.stateProjection.foldModelCall({
      state: before,
      attrs: facts,
      fallbackDurationMs: 0,
    });
    return this.chargePricedCall({ before, folded, facts, context });
  }

  /**
   * One span of an agent that declares its GenAI operations: the root gives identity and start
   * only, since its usage is the rollup of its model calls; each call and tool run counts once.
   */
  private applyGenAiOperation({
    state,
    span,
    role,
    durationMs,
    context,
  }: {
    state: CodingAgentSessionData;
    span: SpanFactsView;
    role: GenAiOperationRole;
    durationMs: number;
    context: NonNullable<CodingAgentSessionSpanProjectionInput["context"]> | null;
  }): CodingAgentSessionData {
    const before = this.stateProjection.withIdentity(state, span.attrs);
    if (role === "session") {
      // The root's prompt names an unnamed session, as a Claude Code prompt event does.
      return this.stateProjection.withTitle({
        state: before,
        value: this.stateProjection.coerceString(span.attrs[SESSION_TITLE_FALLBACK_FACT_KEY]),
        source: "prompt",
      });
    }

    if (role === "toolRun") {
      return this.stateProjection.foldToolInvocation(before, {
        attrs: { ...span.attrs, tool_name: span.attrs[GEN_AI_TOOL_NAME] },
        failed: span.statusCode === SPAN_STATUS_ERROR,
        toolMs: durationMs,
        startedAtMs: span.startTimeUnixMs,
      });
    }

    const facts = genAiModelCallFacts(span.attrs);
    // A chat span wraps one request and no tools, so its wall time is the call's latency. Its AI
    // units and per-model figures land on the per-call fact table, never on the session row.
    const folded = this.stateProjection.foldModelCall({
      state: before,
      attrs: facts,
      fallbackDurationMs: durationMs,
    });
    return this.chargePricedCall({ before, folded, facts, context });
  }

  private claudeCallTokenFacts(
    attrs: Record<string, unknown>,
    traceCanonicalisation: Pick<TraceApi, "classifyClaudeCall">,
  ): Record<string, unknown> {
    const cacheWriteTokens = this.stateProjection.number(attrs.cache_creation_tokens);
    const writesLongLived =
      cacheWriteTokens > 0 &&
      traceCanonicalisation.classifyClaudeCall({
        llmRequestContext: this.stateProjection.coerceString(attrs["llm_request.context"]),
        querySource: this.stateProjection.coerceString(attrs.query_source),
      }).cacheWritesLongLived;
    return {
      ...attrs,
      "gen_ai.usage.cache_read.input_tokens": this.stateProjection.number(attrs.cache_read_tokens),
      "gen_ai.usage.cache_creation.input_tokens": cacheWriteTokens,
      ...(writesLongLived
        ? { "gen_ai.usage.cache_creation_1h.input_tokens": cacheWriteTokens }
        : {}),
    };
  }
}
