/**
 * The coding-agent session fold, driven with the contribution events the
 * pipeline actually delivers (ADR-056).
 *
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
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
  projectCodingAgentSessionToRow,
  rebuildCodingAgentSessionStateFromRow,
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
}: {
  name: string;
  spanId: string;
  traceId?: string;
  facts?: Record<string, string | number | boolean>;
  startMs?: number;
  endMs?: number;
  statusCode?: number;
}): SpanFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
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
}: {
  facts: Record<string, string | number | boolean>;
  traceId?: string | null;
  timeMs?: number;
}): LogFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
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
        version: "2026-07-21",
      });

      expect(row.sessionId).toBe(SESSION_ID);
      expect(row.sessionKeySource).toBe("provider");
      expect(row.traceIds).toEqual([TRACE_A]);
      expect(row.inputTokens).toBe(10);
    });
  });
});

describe("read-back losslessness (ADR-066)", () => {
  describe("when a folded session is projected to a row and rebuilt", () => {
    /**
     * The outage fix depends on this exactly: store.get() reconstructs working
     * state from the row instead of replaying event_log. If any field the fold
     * needs fails to round-trip, a cache miss would silently fold onto partial
     * state — so this asserts the WHOLE state survives, and calls out the
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

      // The fields the pre-ADR-066 row could not represent are actually populated.
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

      const rebuilt = rebuildCodingAgentSessionStateFromRow(row);

      expect(rebuilt).toEqual(state);
    });
  });
});
