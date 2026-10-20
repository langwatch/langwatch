/**
 * @vitest-environment node
 * @see specs/upgrade/serving-gate.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startTargetCatchUp } from "../target-catch-up.ts";

const EVERY_MS = 1_000;

function catchUpOver({ behind, holder = null }: { behind: string[][]; holder?: unknown }) {
  const runs: number[] = [];
  const warned: string[] = [];
  let asked = 0;
  const running = startTargetCatchUp({
    findTargetsBehind: async () => behind[Math.min(asked++, behind.length - 1)] ?? [],
    findLeaseHolder: async () => holder,
    upgrade: async () => {
      runs.push(Date.now());
      return { code: "done" as const, logTail: [] };
    },
    warn: (message) => warned.push(message),
    everyMs: EVERY_MS,
    maxMs: 4 * EVERY_MS,
  });
  return { runs, warned, running };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startTargetCatchUp", () => {
  describe("when a held private target is behind and no run holds the lease", () => {
    /** @scenario "An admitted worker runs the upgrade again while a held private target is behind" */
    it("runs the upgrade on its next pass and names the target", async () => {
      const { runs, warned, running } = catchUpOver({ behind: [["private:org_1"], []] });
      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(runs).toHaveLength(1);
      expect(warned[0]).toContain("private:org_1");
      await running.stop();
    });
  });

  describe("when the target is still behind after the upgrade", () => {
    it("waits twice as long before the next pass, up to the ceiling", async () => {
      const { runs, running } = catchUpOver({ behind: [["private:org_1"]] });
      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(runs).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(runs).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(runs).toHaveLength(2);
      await running.stop();
    });
  });

  describe("when no target is behind", () => {
    /** @scenario "An admitted worker with every ClickHouse target current runs no upgrade" */
    it("never runs the upgrade", async () => {
      const { runs, running } = catchUpOver({ behind: [[]] });
      await vi.advanceTimersByTimeAsync(5 * EVERY_MS);
      expect(runs).toEqual([]);
      await running.stop();
    });
  });

  describe("when another run holds the lease", () => {
    it("leaves the target to that run", async () => {
      const { runs, running } = catchUpOver({
        behind: [["private:org_1"]],
        holder: { owner: "x" },
      });
      await vi.advanceTimersByTimeAsync(3 * EVERY_MS);
      expect(runs).toEqual([]);
      await running.stop();
    });
  });

  describe("when it is stopped", () => {
    it("runs no further pass", async () => {
      const { runs, running } = catchUpOver({ behind: [["private:org_1"]] });
      await running.stop();
      await vi.advanceTimersByTimeAsync(5 * EVERY_MS);
      expect(runs).toEqual([]);
    });
  });
});
