/**
 * The coding-agent session fold, driven with the contribution events the
 * pipeline actually delivers (ADR-105).
 *
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing.old";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "../../schemas/constants";
import type {
  LogFactsContributedEvent,
  MetricFactsContributedEvent,
  SpanFactsContributedEvent,
} from "../../schemas/events";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
  codingAgentSessionStateFromRow,
  projectCodingAgentSessionToRow,
} from "../codingAgentSession.foldProjection";

const SESSION_ID = "8f2c9a1e-4711-4e0f-9d2e-session";
const TRACE_A = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const TRACE_B = "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d7";

function makeProjection() {
  return new CodingAgentSessionFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

/**
 * `initState` is protected. Reaching it needs a cast, but the cast has to name
 * the REAL state type — an earlier `() => never` here collapsed every downstream
 * assertion to `never` and hid its own type errors.
 */
function initStateOf(
  projection: CodingAgentSessionFoldProjection,
): CodingAgentSessionState {
  return (
    projection as unknown as { initState: () => CodingAgentSessionState }
  ).initState();
}

function spanFactsEvent({
  name,
  spanId,
  traceId = TRACE_A,
  facts = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
  agent = "claude_code",
}: {
  name: string;
  spanId: string;
  traceId?: string;
  facts?: Record<string, string | number | boolean>;
  startMs?: number;
  endMs?: number;
  statusCode?: number;
  agent?: string;
}): SpanFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent,
      occurredAt: startMs,
      traceId,
      spanId,
      name,
      startTimeUnixMs: startMs,
      endTimeUnixMs: endMs,
      statusCode,
      facts,
      scopeName: "com.anthropic.claude_code.tracing",
    },
  } as unknown as SpanFactsContributedEvent;
}

function logFactsEvent({
  facts,
  traceId = null,
  timeMs = 1_500,
  agent = "claude_code",
}: {
  facts: Record<string, string | number | boolean>;
  traceId?: string | null;
  timeMs?: number;
  agent?: string;
}): LogFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent,
      occurredAt: timeMs,
      recordId: `rec-${timeMs}`,
      traceId,
      spanId: null,
      timeUnixMs: timeMs,
      severityNumber: 9,
      providerKind: "claude_code",
      scopeName: "com.anthropic.claude_code.events",
      facts,
    },
  } as unknown as LogFactsContributedEvent;
}

function metricFactsEvent({
  seriesId,
  metricName,
  attributes = {},
  value,
  asOfMs = 1_500,
}: {
  seriesId: string;
  metricName: string;
  attributes?: Record<string, string | number | boolean>;
  value: number;
  asOfMs?: number;
}): MetricFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: asOfMs,
      seriesId,
      metricName,
      unit: null,
      attributes,
      value,
      dataPointCount: 1,
      asOfUnixMs: asOfMs,
    },
  } as unknown as MetricFactsContributedEvent;
}

describe("CodingAgentSessionFoldProjection", () => {
  describe("when a model-call span contributes", () => {
    /** @scenario a session assembles from spans, logs and metrics */
    it("folds tokens, stop reason and the trace id into the session", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          facts: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 900,
            stop_reason: "end_turn",
            request_id: "req_1",
          },
        }),
        initStateOf(projection),
      );

      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.cacheReadTokens).toBe(900);
      expect(state.stopReason).toBe("end_turn");
      expect(state.finalRequestId).toBe("req_1");
      expect(state.traceIds).toEqual([TRACE_A]);
      expect(state.sessionId).toBe(SESSION_ID);
      expect(state.agent).toBe("claude_code");
    });
  });

  describe("when a tool span FAILED", () => {
    // The contribution carries the OTLP numeric enum (ERROR = 2); PR #5708's
    // string comparison could never be true and every failure folded as a
    // success. The schema now forbids the string shape; the fold must still
    // read the number correctly.
    it("counts the failure and marks the step where it happened", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-err",
          facts: { tool_name: "Bash" },
          statusCode: 2,
        }),
        initStateOf(projection),
      );

      expect(state.failedTools).toBe(1);
      expect(state.steps[0]!.failed).toBe(true);
    });

    it("leaves a successful tool alone", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-ok",
          facts: { tool_name: "Read" },
          statusCode: 1,
        }),
        initStateOf(projection),
      );

      expect(state.failedTools).toBe(0);
      expect(state.steps[0]!.failed).toBe(false);
    });
  });

  describe("when a sub-agent's trace contributes to the same session", () => {
    /** @scenario a sub-agent run stays inside its parent session */
    it("collects both traces on one session without double-counting", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-1",
          traceId: TRACE_A,
          facts: { tool_name: "Bash" },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-2",
          traceId: TRACE_B,
          facts: { tool_name: "Read", agent_id: "sub-1" },
        }),
        state,
      );

      expect(state.traceIds).toEqual([TRACE_A, TRACE_B]);
      expect(state.toolCalls).toBe(2);
      expect(state.subAgents).toBe(1);
      // The sub-agent's own reads stay out of the main step sequence.
      expect(state.steps.map((s) => s.name)).toEqual(["Bash"]);
    });
  });

  describe("when the human denies a tool", () => {
    /** @scenario a denied tool is part of the session story */
    it("records the denial from the log facts, span or no span", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.tool_decision",
            decision: "reject",
            source: "user_permanent",
          },
        }),
        initStateOf(projection),
      );

      expect(state.toolsDenied).toBe(1);
      // No correlation on the record — the session still counted it.
      expect(state.traceIds).toEqual([]);
    });
  });

  describe("when the authoritative cost arrives on a log", () => {
    it("sums it into the session", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_request", cost_usd: 0.25 },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_request", cost_usd: 0.5 },
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.costUsd).toBe(0.75);
    });
  });

  describe("when a session sends only metrics", () => {
    /** @scenario a session that sent only metrics still appears */
    it("materializes the session from metric contributions alone", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-lines-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added", "user.id": "user-1" },
          value: 120,
        }),
        state,
      );
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-commits",
          metricName: "claude_code.commit.count",
          value: 2,
        }),
        state,
      );

      expect(state.sessionId).toBe(SESSION_ID);
      expect(state.agent).toBe("claude_code");
      expect(state.userId).toBe("user-1");
      expect(state.linesAdded).toBe(120);
      expect(state.commits).toBe(2);
      expect(state.modelCalls).toBe(0);
      expect(state.traceIds).toEqual([]);
    });
  });

  describe("when a cumulative series is observed again", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("replaces the series' converged value instead of adding it", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-lines-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value: 120,
        }),
        state,
      );
      // The counter converged to a bigger total — same series, newer value.
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-lines-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value: 150,
          asOfMs: 2_500,
        }),
        state,
      );

      expect(state.linesAdded).toBe(150);
    });

    it("sums distinct delta units exactly once each", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      for (const [unit, value] of [
        ["point-1", 10],
        ["point-2", 5],
      ] as const) {
        state = projection.handleCodingAgentSessionMetricFactsContributed(
          metricFactsEvent({
            seriesId: unit,
            metricName: "claude_code.lines_of_code.count",
            attributes: { type: "removed" },
            value,
          }),
          state,
        );
      }

      expect(state.linesRemoved).toBe(15);
    });
  });

  describe("when the human accepts and rejects edits", () => {
    it("splits the decisions and tracks the languages", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-accept-ts",
          metricName: "claude_code.code_edit_tool.decision",
          attributes: { decision: "accept", language: "typescript" },
          value: 4,
        }),
        state,
      );
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-reject-ts",
          metricName: "claude_code.code_edit_tool.decision",
          attributes: { decision: "reject", language: "typescript" },
          value: 1,
        }),
        state,
      );

      expect(state.editsAccepted).toBe(4);
      expect(state.editsRejected).toBe(1);
      expect(state.languagesEdited).toEqual(["typescript"]);
    });
  });

  describe("when token metrics arrive for a session that also sent spans", () => {
    it("does not overlay them — the spans already carry the tokens", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          facts: { input_tokens: 100 },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-tokens",
          metricName: "claude_code.token.usage",
          attributes: { type: "input" },
          value: 100,
        }),
        state,
      );

      expect(state.inputTokens).toBe(100);
    });
  });

  describe("when the fold state is projected to its row", () => {
    it("keys the row by the aggregate's session id, traces as an array", () => {
      const projection = makeProjection();
      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          facts: { input_tokens: 10 },
        }),
        initStateOf(projection),
      );

      const row = projectCodingAgentSessionToRow({
        state,
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });

      expect(row.sessionId).toBe(SESSION_ID);
      expect(row.sessionKeySource).toBe("provider");
      expect(row.traceIds).toEqual([TRACE_A]);
      expect(row.inputTokens).toBe(10);
    });
  });
});

describe("read-back losslessness (ADR-099)", () => {
  describe("when a folded session is projected to a row and rebuilt", () => {
    /**
     * The outage fix depends on this exactly: store.get() reads working state
     * back by decoding the row, instead of replaying event_log. If any field the
     * fold needs fails to round-trip, a cache miss would silently fold onto
     * partial state — so this asserts the WHOLE state survives, and calls out the
     * previously-lossy bookkeeping fields by name.
     */
    it("recovers the identical working state, including the bookkeeping the old row dropped", () => {
      const projection = makeProjection();
      let state = projection.init();

      // A model call: tokens, a sub-agent id (the dedup set), the previous-call
      // context that drives cache-rebuild detection, the final request id.
      state = projection.apply(
        state,
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          startMs: 1_000,
          endMs: 2_000,
          facts: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 800,
            cache_creation_tokens: 200,
            agent_id: "sub-agent-1",
            request_id: "req_final",
            stop_reason: "end_turn",
          },
        }),
      );
      // A tool span: a step that carries its own start time (the parallel array
      // the 3-tuple row column used to drop).
      state = projection.apply(
        state,
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-1",
          startMs: 3_000,
          endMs: 3_500,
          facts: { tool_name: "Read", file_path: "/a.ts" },
        }),
      );
      // A metric contribution: a converged unit in metricSeries + a metric-fed
      // field recomputed from it.
      state = projection.apply(
        state,
        metricFactsEvent({
          seriesId: "loc-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value: 42,
        }),
      );

      // The fields the pre-ADR-099 row could not represent are actually populated.
      expect(state.subAgentIds).toEqual(["sub-agent-1"]);
      expect(state.previousCallContextTokens).toBe(1_000);
      expect(state.steps[0]?.startedAtMs).toBe(3_000);
      expect(Object.keys(state.metricSeries)).toContain("loc-added");
      expect(state.linesAdded).toBe(42);

      const row = projectCodingAgentSessionToRow({
        state,
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });

      const decoded = codingAgentSessionStateFromRow(row);

      expect(decoded).toEqual(state);
    });
  });

  /**
   * The round-trip above proves the bookkeeping survives the row. These prove
   * why that matters: each one folds a further contribution onto the recovered
   * state, and contrasts it with the same contribution folded onto a state
   * whose bookkeeping did NOT survive — which is exactly the shape a row
   * written before these columns existed decodes to, and exactly why the store
   * refuses such a row instead of reading it back.
   */
  describe("when a further contribution folds onto the recovered state", () => {
    /** Round-trips a state through the row the fold would have committed. */
    function recover(state: CodingAgentSessionState): CodingAgentSessionState {
      return codingAgentSessionStateFromRow(
        projectCodingAgentSessionToRow({
          state,
          tenantId: "tenant-1",
          sessionId: SESSION_ID,
          version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
        }),
      );
    }

    /** @scenario recovered state preserves the fold's internal bookkeeping */
    it("recognises a sub-agent it has already seen and still reads the prior call's context", () => {
      const projection = makeProjection();
      const modelCall = (facts: Record<string, string | number>) =>
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm",
          facts,
        });

      let state = projection.apply(
        projection.init(),
        modelCall({ agent_id: "sub-a", cache_read_tokens: 400 }),
      );
      state = projection.apply(
        state,
        modelCall({
          agent_id: "sub-b",
          cache_read_tokens: 800,
          cache_creation_tokens: 200,
        }),
      );
      expect(state.subAgents).toBe(2);

      // A third call from a sub-agent already counted, whose cache creation
      // dwarfs the previous call's context — a rebuild, but only if the fold
      // still knows what that context was.
      const third = modelCall({
        agent_id: "sub-a",
        cache_creation_tokens: 5_000,
      });

      const next = projection.apply(recover(state), third);

      expect(next.subAgents).toBe(2);
      expect(next.cacheRebuildCount).toBe(1);

      // The same contribution onto a state that lost the dedup set and the
      // prior context: the sub-agent count collapses to the one id it can see,
      // and the rebuild reads as the session's first call.
      const withoutBookkeeping = projection.apply(
        { ...recover(state), subAgentIds: [], previousCallContextTokens: 0 },
        third,
      );

      expect(withoutBookkeeping.subAgents).toBe(1);
      expect(withoutBookkeeping.cacheRebuildCount).toBe(0);
    });

    /** @scenario a total recomputed from its recorded parts is not collapsed by the next part */
    it("adds the new series to the ones already recorded instead of recomputing from it alone", () => {
      const projection = makeProjection();
      const linesAdded = (seriesId: string, value: number) =>
        metricFactsEvent({
          seriesId,
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value,
        });

      let state = projection.apply(projection.init(), linesAdded("loc-1", 40));
      state = projection.apply(state, linesAdded("loc-2", 2));
      expect(state.linesAdded).toBe(42);

      const next = projection.apply(recover(state), linesAdded("loc-3", 5));

      expect(next.linesAdded).toBe(47);

      // The total is recomputed WHOLE from the recorded series, so a state that
      // lost them recomputes from the newest one alone.
      const withoutParts = projection.apply(
        { ...recover(state), metricSeries: {} },
        linesAdded("loc-3", 5),
      );

      expect(withoutParts.linesAdded).toBe(5);
    });

    /** @scenario a sequence keeps the order things happened in rather than the order they arrived */
    it("places a late-arriving step by when it started, not by when it turned up", () => {
      const projection = makeProjection();
      const toolAt = (spanId: string, tool: string, startMs: number) =>
        spanFactsEvent({
          name: "claude_code.tool",
          spanId,
          startMs,
          endMs: startMs + 100,
          facts: { tool_name: tool },
        });

      let state = projection.apply(
        projection.init(),
        toolAt("t1", "Read", 3_000),
      );
      state = projection.apply(state, toolAt("t2", "Bash", 5_000));

      // Spans are batched on the wire, so this one lands last despite having
      // started between the other two.
      const late = toolAt("t3", "Grep", 4_000);

      const next = projection.apply(recover(state), late);

      expect(next.steps.map((step) => step.name)).toEqual([
        "Read",
        "Grep",
        "Bash",
      ]);

      // Without the recorded start times every earlier step reads as time zero,
      // so the late step can only be appended — the order the spans arrived in.
      const withoutTimes = projection.apply(
        {
          ...recover(state),
          steps: state.steps.map((step) => ({ ...step, startedAtMs: 0 })),
        },
        late,
      );

      expect(withoutTimes.steps.map((step) => step.name)).toEqual([
        "Read",
        "Bash",
        "Grep",
      ]);
    });
  });
});

describe("coding-agent session fold, per-agent gating", () => {
  describe("when a Cowork session folds from events only", () => {
    /** @scenario a Cowork session is an agent session */
    it("folds the model call — tokens, model, cost — from the api_request event", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: {
            "event.name": "claude_code.api_request",
            cost_usd: 0.42,
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 1_000,
            cache_creation_tokens: 200,
            model: "claude-fable-5",
            duration_ms: 800,
          },
        }),
        initStateOf(projection),
      );

      expect(state.agent).toBe("claude_cowork");
      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.outputTokens).toBe(50);
      expect(state.cacheReadTokens).toBe(1_000);
      expect(state.cacheCreationTokens).toBe(200);
      expect(state.costUsd).toBeCloseTo(0.42);
      expect(state.models).toEqual(["claude-fable-5"]);
    });

    it("folds the tool run — name, count, step — from the tool_result event", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          timeMs: 2_000,
          facts: {
            "event.name": "claude_code.tool_result",
            tool_name: "Bash",
            success: "true",
            duration_ms: 120,
            tool_result_size_bytes: 2_048,
          },
        }),
        initStateOf(projection),
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts).toEqual({ Bash: 1 });
      expect(state.steps).toEqual([
        { name: "Bash", count: 1, startedAtMs: 2_000, failed: false },
      ]);
      expect(state.toolResultBytes).toBe(2_048);
    });

    /** @scenario a Cowork session is an agent session */
    it("counts a turn once when the beta trace export also emits its span", () => {
      const projection = makeProjection();
      const modelFacts = {
        model: "claude-fable-5",
        input_tokens: 100,
        output_tokens: 50,
      };

      // Cowork behind its beta trace-export flag: the SAME turn arrives twice,
      // once as Claude Code's llm_request span and once as the api_request
      // event Cowork folds its model calls from.
      const afterSpan = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "cw-llm-1",
          agent: "claude_cowork",
          facts: modelFacts,
        }),
        initStateOf(projection),
      );
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: { "event.name": "claude_code.api_request", ...modelFacts },
        }),
        afterSpan,
      );

      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.outputTokens).toBe(50);
    });

    /** @scenario a Cowork session is an agent session */
    it("counts a tool run once when the beta trace export also emits its span", () => {
      const projection = makeProjection();

      const afterSpan = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "cw-tool-1",
          agent: "claude_cowork",
          facts: { tool_name: "Bash", duration_ms: 120 },
        }),
        initStateOf(projection),
      );
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          timeMs: 2_000,
          facts: {
            "event.name": "claude_code.tool_result",
            tool_name: "Bash",
            success: "true",
            duration_ms: 120,
          },
        }),
        afterSpan,
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts).toEqual({ Bash: 1 });
    });

    it("identifies the user from Cowork's account uuid", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: {
            "event.name": "claude_code.user_prompt",
            prompt_length: 12,
            "user.account_uuid": "0f6f44f5-2f4c-4a5e-9d3b-7f8f2f9a1b2c",
          },
        }),
        initStateOf(projection),
      );

      expect(state.userId).toBe("0f6f44f5-2f4c-4a5e-9d3b-7f8f2f9a1b2c");
    });
  });

  describe("when a span-bearing agent's api_request event contributes", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("folds cost only — its tokens arrive on the llm_request span", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_code",
          facts: {
            "event.name": "claude_code.api_request",
            cost_usd: 0.42,
            input_tokens: 100,
            output_tokens: 50,
          },
        }),
        initStateOf(projection),
      );

      expect(state.costUsd).toBeCloseTo(0.42);
      // The double-count gate: these fold from the span for claude_code.
      expect(state.modelCalls).toBe(0);
      expect(state.inputTokens).toBe(0);
      expect(state.outputTokens).toBe(0);
    });
  });

  describe("when a span-bearing agent's tool_result event contributes", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("folds result bytes only — the run itself arrives on the tool span", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_code",
          facts: {
            "event.name": "claude_code.tool_result",
            tool_name: "Bash",
            success: "true",
            duration_ms: 120,
            tool_result_size_bytes: 2_048,
          },
        }),
        initStateOf(projection),
      );

      expect(state.toolResultBytes).toBe(2_048);
      // The other half of the gate — untested until now, and the half that
      // would double every Claude Code tool run if it regressed.
      expect(state.toolCalls).toBe(0);
      expect(state.toolCounts).toEqual({});
      expect(state.steps).toEqual([]);
    });
  });
});
