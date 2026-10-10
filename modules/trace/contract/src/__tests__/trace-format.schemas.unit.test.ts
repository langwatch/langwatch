/**
 * Coverage for `langWatchEventSchema`'s metric-key constraint
 * (specs/api-reference/tracked-event-validation.feature).
 */

import { describe, expect, it } from "vitest";

import { chatMessageSchema, langWatchEventSchema } from "../trace-format.schemas.ts";

const baseEvent = {
  event_id: "event_1",
  event_type: "custom_marker",
  project_id: "project_1",
  event_details: {},
  trace_id: "trace_1",
  timestamps: {
    started_at: 0,
    inserted_at: 0,
    updated_at: 0,
  },
};

describe("langWatchEventSchema", () => {
  describe("given a metric key", () => {
    describe("when the key contains the ASCII unit separator (0x1F)", () => {
      /** @scenario "Ingest rejects a metric key carrying the unit separator" */
      it("fails validation", () => {
        const result = langWatchEventSchema.safeParse({
          ...baseEvent,
          metrics: { "stars\x1fextra": 4 },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the key is an ordinary string", () => {
      it("passes validation", () => {
        const result = langWatchEventSchema.safeParse({
          ...baseEvent,
          metrics: { stars: 4 },
        });

        expect(result.success).toBe(true);
      });
    });
  });
});

describe("chatMessageSchema", () => {
  describe("given AI SDK v5 tool parts", () => {
    /** @scenario "AI SDK tool parts in a stored message satisfy the trace schema" */
    it("accepts a tool-call and a tool-result part as stored", () => {
      const call = chatMessageSchema.safeParse({
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "search", input: { query: "x" } },
        ],
      });
      const result = chatMessageSchema.safeParse({
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "search", output: { type: "json" } },
        ],
      });

      expect(call.success).toBe(true);
      expect(result.success).toBe(true);
    });
  });
});
