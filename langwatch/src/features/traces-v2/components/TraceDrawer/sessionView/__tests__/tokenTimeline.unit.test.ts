import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { deriveTokenTimeline, findCacheRebuilds } from "../tokenTimeline";

function modelCall({
  atMs,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
  inputTokens = 0,
  outputTokens = 0,
}: {
  atMs: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}): TranscriptEntry {
  return {
    kind: "model_call",
    atMs,
    model: "claude-opus-4-8",
    tokens: inputTokens + outputTokens,
    costUsd: 0.1,
    durationMs: 500,
    spanId: `llm-${atMs}`,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

function prompt(atMs: number, text: string): TranscriptEntry {
  return { kind: "user_prompt", atMs, text, chars: text.length };
}

describe("deriveTokenTimeline", () => {
  describe("given a session with model calls interleaved with tools", () => {
    it("keeps only the model calls, in order", () => {
      const timeline = deriveTokenTimeline([
        prompt(1_000, "fix the build"),
        modelCall({ atMs: 2_000, cacheReadTokens: 100 }),
        modelCall({ atMs: 3_000, cacheReadTokens: 200 }),
      ]);

      expect(timeline).toHaveLength(2);
      expect(timeline.map((p) => p.cacheReadTokens)).toEqual([100, 200]);
      expect(timeline.map((p) => p.index)).toEqual([0, 1]);
    });
  });
});

describe("findCacheRebuilds", () => {
  describe("given a cold start", () => {
    it("does not flag the first call — there is nothing to reuse yet", () => {
      const events = findCacheRebuilds([
        modelCall({ atMs: 1_000, cacheCreationTokens: 50_000 }),
      ]);
      expect(events).toEqual([]);
    });
  });

  describe("given a call that re-creates most of the previous context", () => {
    it("flags it, naming the prompt that preceded it", () => {
      const events = findCacheRebuilds([
        prompt(500, "let's refactor the auth module"),
        modelCall({ atMs: 1_000, cacheReadTokens: 100_000 }),
        prompt(1_500, "wait, actually undo that and start over"),
        modelCall({ atMs: 2_000, cacheCreationTokens: 90_000 }),
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        // Second model call of the session, so the chart and the annotation
        // can both name it "call 2".
        callIndex: 1,
        atMs: 2_000,
        cacheCreationTokens: 90_000,
        previousContextTokens: 100_000,
        precedingPrompt: "wait, actually undo that and start over",
      });
    });
  });

  describe("given a call whose cache write is small relative to prior context", () => {
    it("does not flag ordinary incremental cache growth", () => {
      const events = findCacheRebuilds([
        modelCall({ atMs: 1_000, cacheReadTokens: 100_000 }),
        modelCall({
          atMs: 2_000,
          cacheReadTokens: 100_000,
          cacheCreationTokens: 2_000,
        }),
      ]);
      expect(events).toEqual([]);
    });
  });

  describe("given a rebuild below the minimum token floor", () => {
    it("does not flag noise on a session with a tiny context", () => {
      const events = findCacheRebuilds([
        modelCall({ atMs: 1_000, cacheReadTokens: 500 }),
        modelCall({ atMs: 2_000, cacheCreationTokens: 400 }),
      ]);
      expect(events).toEqual([]);
    });
  });
});
