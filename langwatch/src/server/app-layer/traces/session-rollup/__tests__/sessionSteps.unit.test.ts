import { describe, expect, it } from "vitest";
import {
  appendSessionStep,
  MAX_SESSION_STEPS,
  parseSessionSteps,
  SESSION_HARNESS_ATTR,
  SESSION_STEPS_ATTR,
} from "../sessionSteps";

describe("appendSessionStep", () => {
  describe("given an empty attribute map", () => {
    describe("when a step is appended", () => {
      it("writes the step series and the harness marker", () => {
        const attributes: Record<string, string> = {};
        appendSessionStep({
          attributes,
          harness: "claude",
          startMs: 1000,
          inputTokens: 500,
        });

        expect(parseSessionSteps(attributes[SESSION_STEPS_ATTR])).toEqual([
          { startMs: 1000, inputTokens: 500 },
        ]);
        expect(attributes[SESSION_HARNESS_ATTR]).toBe("claude");
      });
    });
  });

  describe("given an existing step series", () => {
    describe("when another step is appended", () => {
      it("preserves order and appends", () => {
        const attributes: Record<string, string> = {};
        appendSessionStep({
          attributes,
          harness: "codex",
          startMs: 1000,
          inputTokens: 100,
        });
        appendSessionStep({
          attributes,
          harness: "codex",
          startMs: 2000,
          inputTokens: 200,
        });

        expect(parseSessionSteps(attributes[SESSION_STEPS_ATTR])).toEqual([
          { startMs: 1000, inputTokens: 100 },
          { startMs: 2000, inputTokens: 200 },
        ]);
      });
    });
  });

  describe("given a series at the cap", () => {
    describe("when appending would exceed MAX_SESSION_STEPS", () => {
      it("merges adjacent pairs keeping the larger input size, halving resolution", () => {
        const attributes: Record<string, string> = {};
        // Fill exactly to the cap: sawtooth 100, 200, 100, 200, ...
        for (let i = 0; i < MAX_SESSION_STEPS; i++) {
          appendSessionStep({
            attributes,
            harness: "claude",
            startMs: i * 1000,
            inputTokens: i % 2 === 0 ? 100 : 200,
          });
        }
        expect(parseSessionSteps(attributes[SESSION_STEPS_ATTR])).toHaveLength(
          MAX_SESSION_STEPS,
        );

        // One more append trips the merge.
        appendSessionStep({
          attributes,
          harness: "claude",
          startMs: MAX_SESSION_STEPS * 1000,
          inputTokens: 999,
        });

        const merged = parseSessionSteps(attributes[SESSION_STEPS_ATTR]);
        // 513 entries → ceil(513 / 2) = 257 after pairwise merge.
        expect(merged).toHaveLength(Math.ceil((MAX_SESSION_STEPS + 1) / 2));
        // Sawtooth peaks survive: every merged pair keeps the 200 peak.
        expect(merged.slice(0, 256).every((s) => s.inputTokens === 200)).toBe(
          true,
        );
        // The odd trailing element is carried through unmerged.
        expect(merged.at(-1)).toEqual({
          startMs: MAX_SESSION_STEPS * 1000,
          inputTokens: 999,
        });
        // Ordering is preserved (startMs strictly increasing).
        for (let i = 1; i < merged.length; i++) {
          expect(merged[i]!.startMs).toBeGreaterThan(merged[i - 1]!.startMs);
        }
      });
    });
  });

  describe("given out-of-order arrivals that trip the merge at the cap", () => {
    describe("when the merge runs", () => {
      it("sorts by start time before pairing so the sawtooth is not corrupted", () => {
        const attributes: Record<string, string> = {};
        // Append MAX+1 steps in DESCENDING start time (out of order). Sawtooth
        // is defined by TIME index: even startMs index → 100, odd → 200.
        for (let i = MAX_SESSION_STEPS; i >= 0; i--) {
          appendSessionStep({
            attributes,
            harness: "claude",
            startMs: i * 1000,
            inputTokens: i % 2 === 0 ? 100 : 200,
          });
        }

        const merged = parseSessionSteps(attributes[SESSION_STEPS_ATTR]);
        // 513 entries → ceil(513 / 2) = 257 after pairwise merge.
        expect(merged).toHaveLength(Math.ceil((MAX_SESSION_STEPS + 1) / 2));
        // Output is chronologically ordered despite descending arrival.
        for (let i = 1; i < merged.length; i++) {
          expect(merged[i]!.startMs).toBeGreaterThan(merged[i - 1]!.startMs);
        }
        // Each chronological pair kept its 200 peak — merging by append order
        // (unsorted) would have paired non-adjacent times and lost peaks.
        expect(merged.slice(0, 256).every((s) => s.inputTokens === 200)).toBe(
          true,
        );
      });
    });
  });
});

describe("parseSessionSteps", () => {
  describe("given absent or malformed input", () => {
    it("returns an empty array without throwing", () => {
      expect(parseSessionSteps(undefined)).toEqual([]);
      expect(parseSessionSteps("not json")).toEqual([]);
      expect(parseSessionSteps("{}")).toEqual([]);
      expect(parseSessionSteps('[{"startMs":1}]')).toEqual([]);
    });
  });
});
