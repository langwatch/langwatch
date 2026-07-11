/**
 * The coding-agent session fold, driven through the real projection class with
 * RAW OTLP span events — the shape the pipeline actually delivers.
 *
 * The derivation is unit-tested against normalized spans elsewhere. This exists
 * because the fold sits on the other side of the raw→normalized boundary, and a
 * gate that reads the wrong field there fails silently: the projection runs, no
 * error is logged, and the table simply stays empty.
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import type { SpanReceivedEvent } from "../../schemas/events";
import { CodingAgentSessionFoldProjection } from "../codingAgentSession.foldProjection";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function makeProjection() {
  return new CodingAgentSessionFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

/** A raw OTLP span exactly as the receiver hands it to the fold. */
function rawSpanEvent({
  name,
  spanId,
  attributes = {},
  startMs = 1_000,
  endMs = 2_000,
}: {
  name: string;
  spanId: string;
  attributes?: Record<string, string | number>;
  startMs?: number;
  endMs?: number;
}): SpanReceivedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    data: {
      span: {
        traceId: TRACE_ID,
        spanId,
        name,
        kind: 1,
        startTimeUnixNano: String(startMs * 1_000_000),
        endTimeUnixNano: String(endMs * 1_000_000),
        attributes: Object.entries(attributes).map(([key, value]) => ({
          key,
          value:
            typeof value === "number"
              ? { intValue: String(value) }
              : { stringValue: value },
        })),
        status: { code: 0 },
        events: [],
        links: [],
      },
      resource: { attributes: [] },
      instrumentationScope: { name: "com.anthropic.claude_code.tracing" },
    },
  } as unknown as SpanReceivedEvent;
}

describe("CodingAgentSessionFoldProjection", () => {
  describe("given the RAW span events the pipeline actually delivers", () => {
    it("folds a model call, so the session is not silently empty", () => {
      const projection = makeProjection();

      const state = projection.handleTraceSpanReceived(
        rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          attributes: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 900,
            stop_reason: "end_turn",
            request_id: "req_1",
          },
        }),
        (projection as unknown as { initState: () => never }).initState(),
      );

      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.cacheReadTokens).toBe(900);
      expect(state.stopReason).toBe("end_turn");
      expect(state.finalRequestId).toBe("req_1");
      expect(state.traceId).toBe(TRACE_ID);
    });

    it("folds a tool call and keeps it in the step sequence", () => {
      const projection = makeProjection();
      let state = (
        projection as unknown as { initState: () => never }
      ).initState();

      state = projection.handleTraceSpanReceived(
        rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-1",
          attributes: { tool_name: "Bash" },
        }),
        state,
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts.Bash).toBe(1);
      expect(state.steps.map((s) => s.name)).toEqual(["Bash"]);
    });
  });

  describe("given a span from an ordinary LLM trace", () => {
    it("is ignored without decoding it", () => {
      const projection = makeProjection();
      const init = (
        projection as unknown as { initState: () => never }
      ).initState();

      const state = projection.handleTraceSpanReceived(
        rawSpanEvent({ name: "openai.chat", spanId: "s-1" }),
        init,
      );

      expect(state).toBe(init);
    });
  });
});
