import { describe, expect, it } from "vitest";
import type { Trace } from "~/server/tracer/types";
import { legacyTraceToTurn } from "../legacyTraceToTurn";

const trace = (overrides: Partial<Trace> = {}): Trace =>
  ({
    trace_id: "trace-abcdef123456",
    project_id: "project-1",
    metadata: {},
    timestamps: {
      started_at: 1_700_000_000_000,
      inserted_at: 1_700_000_000_500,
      updated_at: 1_700_000_000_500,
    },
    spans: [],
    ...overrides,
  }) as Trace;

describe("given a fetched trace to read as one conversation turn", () => {
  describe("when the trace carries content and metrics", () => {
    it("carries the text on both sides of the turn", () => {
      const turn = legacyTraceToTurn(
        trace({
          input: { value: "what is the return policy?" },
          output: { value: "thirty days" },
        }),
      );

      expect(turn.input).toBe("what is the return policy?");
      expect(turn.output).toBe("thirty days");
    });

    it("identifies the turn by its trace and start time", () => {
      const turn = legacyTraceToTurn(trace());

      expect(turn.traceId).toBe("trace-abcdef123456");
      expect(turn.timestamp).toBe(1_700_000_000_000);
      expect(turn.name).toBe("trace-ab");
    });

    it("reads the separator's ledger off the trace metrics", () => {
      const turn = legacyTraceToTurn(
        trace({
          metrics: {
            total_time_ms: 1_234,
            first_token_ms: 300,
            total_cost: 0.0125,
            prompt_tokens: 90,
            completion_tokens: 10,
            tokens_estimated: true,
          },
        }),
      );

      expect(turn.durationMs).toBe(1_234);
      expect(turn.ttft).toBe(300);
      expect(turn.totalCost).toBe(0.0125);
      expect(turn.totalTokens).toBe(100);
      expect(turn.inputTokens).toBe(90);
      expect(turn.outputTokens).toBe(10);
      expect(turn.tokensEstimated).toBe(true);
    });

    it("carries the thread and user the trace belongs to", () => {
      const turn = legacyTraceToTurn(
        trace({
          metadata: {
            thread_id: "thread-7",
            user_id: "user-3",
            labels: ["support"],
          },
        }),
      );

      expect(turn.conversationId).toBe("thread-7");
      expect(turn.userId).toBe("user-3");
      expect(turn.labels).toEqual(["support"]);
    });

    it("counts the trace's spans as the turn's steps", () => {
      const turn = legacyTraceToTurn(
        trace({ spans: [{}, {}] as Trace["spans"] }),
      );

      expect(turn.spanCount).toBe(2);
    });
  });

  describe("when the trace failed", () => {
    it("reads as an errored turn carrying the failure", () => {
      const turn = legacyTraceToTurn(
        trace({
          error: {
            has_error: true,
            message: "provider timed out",
            stacktrace: [],
          },
        }),
      );

      expect(turn.status).toBe("error");
      expect(turn.error).toBe("provider timed out");
    });
  });

  describe("when the trace carries neither content nor metrics", () => {
    it("reads as an empty turn rather than guessing values", () => {
      const turn = legacyTraceToTurn(trace());

      expect(turn.status).toBe("ok");
      expect(turn.input).toBeNull();
      expect(turn.output).toBeNull();
      expect(turn.durationMs).toBe(0);
      expect(turn.totalCost).toBe(0);
      expect(turn.totalTokens).toBe(0);
      expect(turn.ttft).toBeUndefined();
      expect(turn.models).toEqual([]);
      expect(turn.labels).toEqual([]);
      expect(turn.evaluations).toEqual([]);
      expect(turn.events).toEqual([]);
      expect(turn.conversationId).toBeUndefined();
    });
  });
});
