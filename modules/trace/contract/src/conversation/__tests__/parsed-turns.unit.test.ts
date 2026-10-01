import { describe, expect, it } from "vitest";

import { buildParsedTurns, type ConversationTurnSource } from "../parsed-turns.ts";

const turn = (overrides: Partial<ConversationTurnSource> = {}): ConversationTurnSource => ({
  traceId: "trc",
  timestamp: 1_700_000_000_000,
  durationMs: 1_000,
  models: ["gpt-5-mini"],
  totalCost: 0.01,
  totalTokens: 100,
  input: null,
  output: null,
  ...overrides,
});

describe("buildParsedTurns", () => {
  describe("given turns carrying stored chat payloads", () => {
    /** @scenario "A thread is parsed once for every reader" */
    it("reads the user text, the assistant prose and the reasoning", () => {
      const parsed = buildParsedTurns({
        turns: [
          turn({
            input: JSON.stringify([{ role: "user", content: "how are you" }]),
            output: JSON.stringify([
              {
                role: "assistant",
                content: [
                  { type: "thinking", text: "weighing it up" },
                  { type: "text", text: "doing well" },
                ],
              },
            ]),
          }),
        ],
      });
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.userText).toContain("how are you");
      expect(parsed[0]!.assistantText).toBe("doing well");
      expect(parsed[0]!.assistantReasoning).toContain("weighing it up");
      // The raw envelope never leaks into the readable text.
      expect(parsed[0]!.assistantText).not.toContain('"type"');
    });

    /** @scenario "A thread is parsed once for every reader" */
    it("keeps the source turn reachable on the parse", () => {
      const source = turn({ traceId: "trace-7" });
      const parsed = buildParsedTurns({ turns: [source] });
      expect(parsed[0]!.turn).toBe(source);
    });

    /** @scenario "A thread is parsed once for every reader" */
    it("splits the media by the side it was recorded on", () => {
      const parsed = buildParsedTurns({
        turns: [
          turn({
            inputMediaRefs: [
              { kind: "audio", url: "/api/files/p/caller", role: "user" },
              { kind: "audio", url: "/api/files/p/reply", role: "assistant" },
            ],
            outputMediaRefs: [{ kind: "audio", url: "/api/files/p/reply", role: "assistant" }],
          }),
        ],
      });
      expect(parsed[0]!.userMedia).toHaveLength(1);
      expect(parsed[0]!.assistantMedia).toHaveLength(1);
    });

    /** @scenario "A thread is parsed once for every reader" */
    it("gives the first turn no gap", () => {
      const parsed = buildParsedTurns({ turns: [turn()] });
      expect(parsed[0]!.gapSecs).toBe(0);
      expect(parsed[0]!.shouldShowGap).toBe(false);
    });
  });

  describe("given a turn that started well after the previous one finished", () => {
    /** @scenario "The wall-clock gap between turns is measured from the previous turn's end" */
    it("measures the gap from the previous turn's end", () => {
      const parsed = buildParsedTurns({
        turns: [turn({ timestamp: 1_000_000, durationMs: 2_000 }), turn({ timestamp: 1_032_000 })],
      });
      expect(parsed[1]!.gapSecs).toBe(30);
      expect(parsed[1]!.shouldShowGap).toBe(true);
    });

    /** @scenario "The wall-clock gap between turns is measured from the previous turn's end" */
    it("does not show a gap short enough to read as the same exchange", () => {
      const parsed = buildParsedTurns({
        turns: [turn({ timestamp: 1_000_000, durationMs: 1_000 }), turn({ timestamp: 1_003_000 })],
      });
      expect(parsed[1]!.gapSecs).toBe(2);
      expect(parsed[1]!.shouldShowGap).toBe(false);
    });
  });

  describe("given no turns", () => {
    it("returns nothing", () => {
      expect(buildParsedTurns({ turns: [] })).toEqual([]);
    });
  });
});
