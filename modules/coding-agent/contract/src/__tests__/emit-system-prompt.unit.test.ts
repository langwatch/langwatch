// System prompt recorded once per transcript; flag prevents duplication across model calls.

import type { SpanDetail } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createSpanEntryAccumulator, emitSystemPrompt } from "../coding-agent-transcript-state.ts";

const span = ({
  startTimeMs,
  input,
}: {
  startTimeMs: number;
  input: string | null;
}): SpanDetail => ({
  spanId: "span_1",
  parentSpanId: null,
  name: "chat",
  type: "llm",
  startTimeMs,
  endTimeMs: startTimeMs,
  durationMs: 0,
  status: "ok",
  input,
  events: [],
});

/** A model-call span carrying a chat input with a system message. */
const spanWithSystem = (text: string, startTimeMs = 1_000): SpanDetail =>
  span({ startTimeMs, input: JSON.stringify([{ role: "system", content: text }]) });

const systemEntries = (accumulator: ReturnType<typeof createSpanEntryAccumulator>) =>
  accumulator.entries.filter((entry) => entry.kind === "system_prompt");

describe("emitSystemPrompt", () => {
  describe("given a span carrying a system prompt", () => {
    it("records it, with the span's own start time", () => {
      const accumulator = createSpanEntryAccumulator();

      emitSystemPrompt(spanWithSystem("you are helpful", 4_200), accumulator);

      expect(systemEntries(accumulator)).toMatchObject([
        { kind: "system_prompt", atMs: 4_200, text: "you are helpful" },
      ]);
    });

    it("records its length, which is what the transcript budget reads", () => {
      const accumulator = createSpanEntryAccumulator();

      emitSystemPrompt(spanWithSystem("abcde"), accumulator);

      expect(systemEntries(accumulator)[0]).toMatchObject({ chars: 5 });
    });
  });

  describe("given several spans carrying the same prompt", () => {
    it("records it once, not once per span", () => {
      // A conversation's system prompt rides on every model call. Without the
      // flag the transcript would repeat it for the whole conversation.
      const accumulator = createSpanEntryAccumulator();

      emitSystemPrompt(spanWithSystem("you are helpful", 1_000), accumulator);
      emitSystemPrompt(spanWithSystem("you are helpful", 2_000), accumulator);
      emitSystemPrompt(spanWithSystem("you are helpful", 3_000), accumulator);

      expect(systemEntries(accumulator)).toHaveLength(1);
      expect(systemEntries(accumulator)[0]).toMatchObject({ atMs: 1_000 });
    });

    it("keeps the FIRST, so the prompt is dated when the conversation began", () => {
      const accumulator = createSpanEntryAccumulator();

      emitSystemPrompt(spanWithSystem("first", 1_000), accumulator);
      emitSystemPrompt(spanWithSystem("second", 2_000), accumulator);

      expect(systemEntries(accumulator)[0]).toMatchObject({ text: "first" });
    });
  });

  describe("given a span carrying no system prompt", () => {
    it("records nothing and leaves the flag down, so a later span can still emit", () => {
      const accumulator = createSpanEntryAccumulator();

      emitSystemPrompt(span({ startTimeMs: 1, input: null }), accumulator);
      expect(systemEntries(accumulator)).toHaveLength(0);

      emitSystemPrompt(spanWithSystem("arrived late", 5_000), accumulator);
      expect(systemEntries(accumulator)).toMatchObject([{ text: "arrived late" }]);
    });
  });
});
