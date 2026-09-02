import {
  CODING_AGENT_REGISTRY,
  EVENTS_FOLD_TOOL_RUNS_AGENT_IDS,
  LOGS_ONLY_AGENT_IDS,
  detectCodingAgent,
} from "@langwatch/coding-agent-contract";
import type { CodingAgentCostEstimatorPort } from "../ports/coding-agent-cost-estimator.port";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  type CodingAgentSessionData,
  CodingAgentSessionStateProjection,
} from "./coding-agent-session-state.projection";

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
  SPAN: { TURN: "session_task.turn" },
  ATTR: {
    INPUT_TOKENS: "gen_ai.usage.input_tokens",
    OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
    CACHE_READ_TOKENS: "gen_ai.usage.cache_read.input_tokens",
    CACHE_CREATION_TOKENS: "gen_ai.usage.cache_creation.input_tokens",
    RESPONSE_MODEL: "gen_ai.response.model",
  },
} as const;
const SELF_NAMESPACED_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE.SPAN.LLM_REQUEST,
  CLAUDE.SPAN.TOOL,
  CLAUDE.SPAN.TOOL_EXECUTION,
  CLAUDE.SPAN.BLOCKED_ON_USER,
  CLAUDE.SPAN.SUBAGENT_SPAWN,
]);
const DECLARED_SPAN_NAMES: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.flatMap((agent) => agent.sessionSpanNames ?? []),
);

export interface CodingAgentSessionSpanCandidate {
  name: string;
  scopeName?: string | null;
}

export interface SpanFactsView {
  name: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  statusCode: number;
  attrs: Record<string, unknown>;
}

export interface CodingAgentSessionSpanProjectionInput {
  state: CodingAgentSessionData;
  span: SpanFactsView;
  agent?: string;
}

/** Deterministically projects one admitted span contribution into session state. */
export class CodingAgentSessionSpanProjection {
  private constructor(
    private readonly stateProjection: CodingAgentSessionStateProjection,
    private readonly traceCanonicalisation: TraceCanonicalisationService,
    private readonly modelProviders: CodingAgentCostEstimatorPort,
  ) {}

  static create(deps: {
    stateProjection: CodingAgentSessionStateProjection;
    traceCanonicalisation: TraceCanonicalisationService;
    modelProviders: CodingAgentCostEstimatorPort;
  }): CodingAgentSessionSpanProjection {
    return new CodingAgentSessionSpanProjection(
      deps.stateProjection,
      deps.traceCanonicalisation,
      deps.modelProviders,
    );
  }

  static admits({ name, scopeName }: CodingAgentSessionSpanCandidate): boolean {
    if (SELF_NAMESPACED_SPAN_NAMES.has(name)) return true;
    if (!DECLARED_SPAN_NAMES.has(name)) return false;
    return detectCodingAgent({ recordName: name, scopeName }) !== "unknown";
  }

  applySpanToCodingAgentSession({
    state,
    span,
    agent,
  }: CodingAgentSessionSpanProjectionInput): CodingAgentSessionData {
    const attrs = span.attrs;
    const durationMs = Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs);
    const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);

    if (span.name === CLAUDE.SPAN.LLM_REQUEST) {
      // Identity still rides the span; only the counted facts are the log's.
      if (isLogsOnly) return this.stateProjection.withIdentity(state, attrs);
      const folded = this.stateProjection.foldModelCall(
        this.stateProjection.withIdentity(state, attrs),
        attrs,
        durationMs,
      );
      // Priced from the span's tokens with the same formula and the same
      // cache-write lifetime the trace pipeline applies to the identical span,
      // so the session and its traces state one figure. The cost the agent
      // reports about itself lands on agentReportedCostUsd instead.
      return {
        ...folded,
        costUsd:
          folded.costUsd +
          this.pricedFromTokens(
            this.claudeCallTokenFacts(attrs, this.traceCanonicalisation),
            this.modelProviders,
          ),
      };
    }

    if (span.name === CODEX.SPAN.TURN) {
      // The contribution's own label gates the fold: the dispatcher already
      // declined foreign spans reusing this bare name, and one that still
      // arrives labeled as another agent contributes identity only.
      if (agent !== "codex" || isLogsOnly) return this.stateProjection.withIdentity(state, attrs);
      const facts = this.codexTurnTokenFacts(attrs);
      // Fallback duration 0, not the span's: the turn's wall time includes the
      // tools that ran inside it, and zero reads honestly as "not measured".
      const folded = this.stateProjection.foldModelCall(
        this.stateProjection.withIdentity(state, attrs),
        facts,
        0,
      );
      return {
        ...folded,
        costUsd: folded.costUsd + this.pricedFromTokens(facts, this.modelProviders),
      };
    }

    if (span.name === CLAUDE.SPAN.SUBAGENT_SPAWN) {
      const next = this.stateProjection.withIdentity(state, attrs);
      const agentType =
        this.stateProjection.string(attrs.agent_type) ??
        this.stateProjection.string(attrs.subagent_type);
      const agentId = this.stateProjection.string(attrs.agent_id);
      return {
        ...next,
        ...(agentId !== null ? this.stateProjection.recordSubAgent(next, agentId) : {}),
        subAgentTypes:
          agentType !== null
            ? this.stateProjection.addToBoundedSet(next.subAgentTypes, agentType)
            : next.subAgentTypes,
      };
    }

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

  private pricedFromTokens(
    facts: Record<string, unknown>,
    modelProviders: CodingAgentCostEstimatorPort,
  ): number {
    return modelProviders.estimateCost({
      attrs: facts,
      model: this.stateProjection.string(facts.model) ?? undefined,
      promptTokens: this.stateProjection.number(facts.input_tokens),
      completionTokens: this.stateProjection.number(facts.output_tokens),
    });
  }

  private claudeCallTokenFacts(
    attrs: Record<string, unknown>,
    traceCanonicalisation: TraceCanonicalisationService,
  ): Record<string, unknown> {
    const cacheWriteTokens = this.stateProjection.number(attrs.cache_creation_tokens);
    return {
      ...attrs,
      "gen_ai.usage.cache_read.input_tokens": this.stateProjection.number(attrs.cache_read_tokens),
      "gen_ai.usage.cache_creation.input_tokens": cacheWriteTokens,
      ...(cacheWriteTokens > 0 &&
      traceCanonicalisation.classifyClaudeCall({
        llmRequestContext: this.stateProjection.string(attrs["llm_request.context"]),
        querySource: this.stateProjection.string(attrs.query_source),
      }).cacheWritesLongLived
        ? { "gen_ai.usage.cache_creation_1h.input_tokens": cacheWriteTokens }
        : {}),
    };
  }

  private codexTurnTokenFacts(attrs: Record<string, unknown>): Record<string, unknown> {
    return {
      ...attrs,
      input_tokens: this.stateProjection.number(attrs[CODEX.ATTR.INPUT_TOKENS]),
      output_tokens: this.stateProjection.number(attrs[CODEX.ATTR.OUTPUT_TOKENS]),
      cache_read_tokens: this.stateProjection.number(attrs[CODEX.ATTR.CACHE_READ_TOKENS]),
      cache_creation_tokens: this.stateProjection.number(attrs[CODEX.ATTR.CACHE_CREATION_TOKENS]),
      model:
        this.stateProjection.string(attrs["gen_ai.request.model"]) ??
        this.stateProjection.string(attrs[CODEX.ATTR.RESPONSE_MODEL]),
    };
  }
}
