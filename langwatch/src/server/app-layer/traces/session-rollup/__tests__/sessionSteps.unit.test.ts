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
      it("halves by min/max decimation, keeping BOTH peaks and valleys", () => {
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

        // One more append trips the downsample.
        appendSessionStep({
          attributes,
          harness: "claude",
          startMs: MAX_SESSION_STEPS * 1000,
          inputTokens: 999,
        });

        const merged = parseSessionSteps(attributes[SESSION_STEPS_ATTR]);
        // 513 entries → 128 four-step buckets (each emits its 100 min + 200 max)
        // + the trailing 999 = 257 points.
        expect(merged).toHaveLength(Math.ceil((MAX_SESSION_STEPS + 1) / 2));
        // The valleys are NOT erased (the keep-max regression): the decimated
        // body carries an equal number of 100 valleys and 200 peaks.
        const body = merged.slice(0, 256);
        expect(body.filter((s) => s.inputTokens === 100)).toHaveLength(128);
        expect(body.filter((s) => s.inputTokens === 200)).toHaveLength(128);
        // The trailing element is carried through as its own bucket.
        expect(merged.at(-1)).toEqual({
          startMs: MAX_SESSION_STEPS * 1000,
          inputTokens: 999,
        });
        // Ordering is preserved (startMs strictly increasing).
        for (let i = 1; i < merged.length; i++) {
          expect(merged[i]!.startMs).toBeGreaterThan(merged[i - 1]!.startMs);
        }
      });

      it("preserves an isolated valley through the downsample (regression: keep-max erased it)", () => {
        const attributes: Record<string, string> = {};
        // A single 20k drop in a 200k plateau, at an even index so keep-max
        // would have paired it with the following 200k peak and merged it away.
        // Min/max decimation keeps the bucket's min, so the valley survives.
        const valleyIdx = 100;
        for (let i = 0; i <= MAX_SESSION_STEPS; i++) {
          appendSessionStep({
            attributes,
            harness: "claude",
            startMs: i * 1000,
            inputTokens: i === valleyIdx ? 20_000 : 200_000,
          });
        }

        const merged = parseSessionSteps(attributes[SESSION_STEPS_ATTR]);
        // The lone valley survives — keep-max would have lost it into the peaks.
        expect(
          merged.some(
            (s) => s.inputTokens === 20_000 && s.startMs === valleyIdx * 1000,
          ),
        ).toBe(true);
        expect(merged.some((s) => s.inputTokens === 200_000)).toBe(true);
      });
    });
  });

  describe("given out-of-order arrivals that trip the downsample at the cap", () => {
    describe("when the downsample runs", () => {
      it("sorts by start time first so peaks and valleys are not corrupted", () => {
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
        // 513 entries → ceil(513 / 2) = 257 after min/max decimation.
        expect(merged).toHaveLength(Math.ceil((MAX_SESSION_STEPS + 1) / 2));
        // Output is chronologically ordered despite descending arrival.
        for (let i = 1; i < merged.length; i++) {
          expect(merged[i]!.startMs).toBeGreaterThan(merged[i - 1]!.startMs);
        }
        // Both extrema survive — decimating by append order (unsorted) would
        // have bucketed non-adjacent times and corrupted the sawtooth.
        const body = merged.slice(0, 256);
        expect(body.filter((s) => s.inputTokens === 100)).toHaveLength(128);
        expect(body.filter((s) => s.inputTokens === 200)).toHaveLength(128);
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
