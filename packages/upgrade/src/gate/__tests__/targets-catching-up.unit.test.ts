/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startTargetCatchUp } from "../target-catch-up.ts";
import { watchTargetsCatchingUp } from "../targets-catching-up.ts";

const EVERY_MS = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchTargetsCatchingUp", () => {
  describe("when Redis holds the worker's list", () => {
    /** @scenario "A ClickHouse read from a private target still catching up answers upgrade_in_progress after admission" */
    it("hands on the organisations at once and again on each read", async () => {
      const seen: (readonly string[])[] = [];
      const lists = [["org_private"], []];
      let reads = 0;
      const watching = watchTargetsCatchingUp({
        store: { read: async () => lists[Math.min(reads++, lists.length - 1)] ?? [] },
        onChange: (organizationIds: readonly string[]) => seen.push(organizationIds),
        everyMs: EVERY_MS,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([["org_private"]]);
      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(seen).toEqual([["org_private"], []]);
      await watching.stop();
    });
  });

  describe("when Redis does not answer", () => {
    /** @scenario "A process that cannot read the catching-up targets from Redis answers as before" */
    it("hands on an empty list, so the process answers as before, and keeps reading", async () => {
      const seen: (readonly string[])[] = [];
      const read = vi.fn(async (): Promise<readonly string[]> => {
        throw new Error("Redis did not answer in time");
      });
      const watching = watchTargetsCatchingUp({
        store: { read },
        onChange: (organizationIds: readonly string[]) => seen.push(organizationIds),
        everyMs: EVERY_MS,
      });

      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(seen).toEqual([[], []]);
      expect(read).toHaveBeenCalledTimes(2);
      await watching.stop();
    });
  });
});

describe("startTargetCatchUp sharing the targets behind", () => {
  const catchUpSharing = ({
    behind,
    share,
  }: {
    behind: string[][];
    share: (targets: readonly string[]) => Promise<void>;
  }) => {
    let asked = 0;
    const runs: number[] = [];
    const running = startTargetCatchUp({
      findTargetsBehind: async () => behind[Math.min(asked++, behind.length - 1)] ?? [],
      findLeaseHolder: async () => null,
      upgrade: async () => {
        runs.push(Date.now());
        return { code: "done" as const, logTail: [] };
      },
      warn: () => undefined,
      shareTargetsBehind: share,
      everyMs: EVERY_MS,
      maxMs: 4 * EVERY_MS,
    });
    return { runs, running };
  };

  describe("when a private target is behind and then catches up", () => {
    /** @scenario "The worker shares which private targets are catching up with every instance" */
    it("shares the target at once and on each pass, then an empty list once it is current", async () => {
      const shared: (readonly string[])[] = [];
      const { running } = catchUpSharing({
        behind: [["private:org_a"], ["private:org_a"], []],
        share: async (targets) => {
          shared.push(targets);
        },
      });

      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(shared).toEqual([["private:org_a"], ["private:org_a"], []]);
      await running.stop();
    });
  });

  describe("when Redis refuses the write", () => {
    /** @scenario "A process that cannot read the catching-up targets from Redis answers as before" */
    it("still runs the upgrade to catch the target up", async () => {
      const { runs, running } = catchUpSharing({
        behind: [["private:org_a"]],
        share: async () => {
          throw new Error("Redis did not answer in time");
        },
      });

      await vi.advanceTimersByTimeAsync(EVERY_MS);
      expect(runs).toHaveLength(1);
      await running.stop();
    });
  });
});
