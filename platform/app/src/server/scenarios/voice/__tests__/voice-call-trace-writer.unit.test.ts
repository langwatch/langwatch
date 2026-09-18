/**
 * @vitest-environment node
 * @see specs/features/agents/voice-agents-v1.feature
 *
 * Unit tests for the voice-call trace writer: how turns group into exchanges,
 * the deterministic ids a re-drive recomputes, the OTLP span attributes the
 * fold and previews read, the timestamp fallback, and the best-effort posture
 * on a `recordSpan` failure.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordSpan } = vi.hoisted(() => ({
  mockRecordSpan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: { recordSpan: (...a: unknown[]) => mockRecordSpan(...a) },
  }),
}));

import type { CallRecord, CallTurn } from "../call-record";
import {
  groupTurnsIntoExchanges,
  recordVoiceCallTraces,
  voiceCallTraceIds,
} from "../voice-call-trace-writer";

function fakeRecord(over: Partial<CallRecord> = {}): CallRecord {
  return {
    conversationId: "conv_1",
    transport: "elevenlabs_convai",
    startedAt: 1_000,
    endedAt: 5_000,
    durationMs: 4_000,
    turns: [],
    isCutAtLimit: false,
    source: "browser",
    ...over,
  };
}

/** The single recorded span, as an attribute-key lookup. */
function attrsOf(call: number): Record<string, unknown> {
  const arg = mockRecordSpan.mock.calls[call]?.[0] as {
    span: { attributes: { key: string; value: Record<string, unknown> }[] };
  };
  const map: Record<string, unknown> = {};
  for (const a of arg.span.attributes) {
    map[a.key] = a.value.stringValue ?? a.value.intValue;
  }
  return map;
}

describe("groupTurnsIntoExchanges", () => {
  describe("when the agent greets before the caller speaks", () => {
    it("makes the greeting exchange 0 with no caller input", () => {
      const turns: CallTurn[] = [
        { role: "agent", text: "Hi, how can I help?" },
        { role: "caller", text: "Cancel my order" },
        { role: "agent", text: "Sure" },
      ];
      const exchanges = groupTurnsIntoExchanges(turns);
      expect(exchanges).toHaveLength(2);
      expect(exchanges[0]).toMatchObject({
        index: 0,
        turnIndices: [0],
        agentText: "Hi, how can I help?",
      });
      expect(exchanges[0]?.callerText).toBeUndefined();
      expect(exchanges[1]).toMatchObject({
        index: 1,
        turnIndices: [1, 2],
        callerText: "Cancel my order",
        agentText: "Sure",
      });
    });
  });

  describe("when two caller turns come in a row", () => {
    it("opens a separate exchange for each", () => {
      const turns: CallTurn[] = [
        { role: "caller", text: "Hello" },
        { role: "caller", text: "Anyone there?" },
        { role: "agent", text: "Yes" },
      ];
      const exchanges = groupTurnsIntoExchanges(turns);
      expect(exchanges.map((e) => e.turnIndices)).toEqual([[0], [1, 2]]);
      expect(exchanges[0]?.agentText).toBeUndefined();
      expect(exchanges[1]?.agentText).toBe("Yes");
    });
  });
});

describe("voiceCallTraceIds", () => {
  describe("when the same conversation and exchange are hashed again", () => {
    /** @scenario "A re-driven finish writes the same trace ids" */
    it("returns identical 32-hex trace and 16-hex span ids", () => {
      const a = voiceCallTraceIds({
        conversationId: "conv_1",
        exchangeIndex: 0,
      });
      const b = voiceCallTraceIds({
        conversationId: "conv_1",
        exchangeIndex: 0,
      });
      expect(a).toEqual(b);
      expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(a.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("when the exchange index differs", () => {
    it("returns different ids", () => {
      const a = voiceCallTraceIds({
        conversationId: "conv_1",
        exchangeIndex: 0,
      });
      const b = voiceCallTraceIds({
        conversationId: "conv_1",
        exchangeIndex: 1,
      });
      expect(a.traceId).not.toBe(b.traceId);
      expect(a.spanId).not.toBe(b.spanId);
    });
  });
});

describe("recordVoiceCallTraces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSpan.mockResolvedValue(undefined);
  });

  describe("given a call with a greeting and one exchange", () => {
    /** @scenario "A finished browser call writes one trace per exchange and every message links to its exchange's trace" */
    it("returns one trace id per turn, shared within an exchange", async () => {
      const record = fakeRecord({
        turns: [
          { role: "agent", text: "Hi" },
          { role: "caller", text: "Cancel" },
          { role: "agent", text: "Done" },
        ],
      });

      const { turnTraceIds } = await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      expect(turnTraceIds).toHaveLength(3);
      // Turns 1 and 2 share exchange 1's trace; turn 0 is exchange 0.
      expect(turnTraceIds[0]).not.toBe(turnTraceIds[1]);
      expect(turnTraceIds[1]).toBe(turnTraceIds[2]);
      expect(mockRecordSpan).toHaveBeenCalledTimes(2);
    });
  });

  describe("given a drawer call (no scenario)", () => {
    it("records application-origin spans with the input/output message JSON", async () => {
      const record = fakeRecord({
        turns: [
          { role: "caller", text: "Cancel my order" },
          { role: "agent", text: "Okay" },
        ],
      });

      await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      const attrs = attrsOf(0);
      expect(attrs["gen_ai.conversation.id"]).toBe("conv_1");
      expect(attrs["langwatch.origin"]).toBe("application");
      expect(attrs["langwatch.span.type"]).toBe("agent");
      expect(attrs["voice.call.caller"]).toBe("human");
      expect(attrs["voice.turn.index"]).toBe(0);
      expect(attrs["gen_ai.input.messages"]).toBe(
        JSON.stringify([{ role: "user", content: "Cancel my order" }]),
      );
      expect(attrs["gen_ai.output.messages"]).toBe(
        JSON.stringify([{ role: "assistant", content: "Okay" }]),
      );
      expect(attrs["scenario.id"]).toBeUndefined();
    });
  });

  describe("given a leading greeting exchange", () => {
    it("omits the input messages when the exchange has no caller utterance", async () => {
      const record = fakeRecord({ turns: [{ role: "agent", text: "Hi" }] });

      await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      const attrs = attrsOf(0);
      expect(attrs["gen_ai.input.messages"]).toBeUndefined();
      expect(attrs["gen_ai.output.messages"]).toBe(
        JSON.stringify([{ role: "assistant", content: "Hi" }]),
      );
    });
  });

  describe("given a scenario context", () => {
    it("marks the origin simulation and carries the scenario attributes", async () => {
      const record = fakeRecord({ turns: [{ role: "caller", text: "Hi" }] });

      await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
        scenario: { scenarioId: "scenario_1", scenarioSetId: "set_1" },
      });

      const attrs = attrsOf(0);
      expect(attrs["langwatch.origin"]).toBe("simulation");
      expect(attrs["scenario.id"]).toBe("scenario_1");
      expect(attrs["scenario.set_id"]).toBe("set_1");
      expect(attrs["scenario.run_id"]).toBe("run_1");
    });
  });

  describe("given turns with no reported offsets", () => {
    it("splits the call window evenly across the exchanges", async () => {
      const record = fakeRecord({
        startedAt: 0,
        endedAt: 4_000,
        turns: [
          { role: "caller", text: "one" },
          { role: "caller", text: "two" },
        ],
      });

      await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      const nano = (call: number) => {
        const span = mockRecordSpan.mock.calls[call]?.[0] as {
          span: { startTimeUnixNano: string; endTimeUnixNano: string };
        };
        return span.span;
      };
      // Two exchanges over [0, 4000] ms => [0,2000] and [2000,4000], in nanos.
      expect(nano(0).startTimeUnixNano).toBe(String(0));
      expect(nano(0).endTimeUnixNano).toBe(String(2_000 * 1_000_000));
      expect(nano(1).startTimeUnixNano).toBe(String(2_000 * 1_000_000));
      expect(nano(1).endTimeUnixNano).toBe(String(4_000 * 1_000_000));
    });
  });

  describe("given turns that report their own offsets", () => {
    it("uses the turn offsets relative to the call start", async () => {
      const record = fakeRecord({
        startedAt: 1_000,
        endedAt: 9_000,
        turns: [{ role: "caller", text: "hi", startMs: 100, endMs: 500 }],
      });

      await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      const span = mockRecordSpan.mock.calls[0]?.[0] as {
        span: { startTimeUnixNano: string; endTimeUnixNano: string };
      };
      expect(span.span.startTimeUnixNano).toBe(String(1_100 * 1_000_000));
      expect(span.span.endTimeUnixNano).toBe(String(1_500 * 1_000_000));
    });
  });

  describe("given a call where only some turns report offsets", () => {
    it("falls back to the even split for the whole call, keeping windows monotonic and non-overlapping", async () => {
      const record = fakeRecord({
        startedAt: 0,
        endedAt: 4_000,
        turns: [
          { role: "caller", text: "one", startMs: 100, endMs: 500 },
          { role: "caller", text: "two" },
        ],
      });

      await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      const windows = mockRecordSpan.mock.calls.map((call) => {
        const { span } = call[0] as {
          span: { startTimeUnixNano: string; endTimeUnixNano: string };
        };
        return {
          start: Number(span.startTimeUnixNano),
          end: Number(span.endTimeUnixNano),
        };
      });

      expect(windows).toHaveLength(2);
      for (const w of windows) {
        expect(w.end).toBeGreaterThanOrEqual(w.start);
      }
      // Each window starts no earlier than the previous one ended.
      windows.reduce((prev, w) => {
        expect(w.start).toBeGreaterThanOrEqual(prev.end);
        return w;
      });
      // The lone measured offset is ignored: even split [0,2000],[2000,4000].
      expect(windows[0]).toEqual({ start: 0, end: 2_000 * 1_000_000 });
      expect(windows[1]).toEqual({
        start: 2_000 * 1_000_000,
        end: 4_000 * 1_000_000,
      });
    });
  });

  describe("when recordSpan fails", () => {
    /** @scenario "A finished browser call writes one trace per exchange and every message links to its exchange's trace" */
    it("swallows the failure and still returns the ids", async () => {
      mockRecordSpan.mockRejectedValue(new Error("queue down"));
      const record = fakeRecord({
        turns: [
          { role: "caller", text: "hi" },
          { role: "agent", text: "hello" },
        ],
      });

      const { turnTraceIds } = await recordVoiceCallTraces({
        projectId: "p1",
        record,
        scenarioRunId: "run_1",
      });

      expect(turnTraceIds).toHaveLength(2);
      expect(turnTraceIds[0]).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("when the call has no turns", () => {
    it("records nothing and returns no ids", async () => {
      const { turnTraceIds } = await recordVoiceCallTraces({
        projectId: "p1",
        record: fakeRecord({ turns: [] }),
        scenarioRunId: "run_1",
      });

      expect(turnTraceIds).toEqual([]);
      expect(mockRecordSpan).not.toHaveBeenCalled();
    });
  });
});
