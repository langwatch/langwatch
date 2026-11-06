import { describe, expect, it } from "vitest";

import { withAdvisoryLock, type AdvisoryLockDeps } from "../advisory-lock.ts";

/** A client whose try-lock answers from a list, one answer per transaction. */
function clientAnswering(answers: boolean[]) {
  const tries: boolean[] = [];
  return {
    tries,
    prisma: {
      $transaction: (async (run: (transaction: unknown) => Promise<unknown>) => {
        const locked = answers[tries.length] ?? false;
        tries.push(locked);
        return run({ $queryRaw: async () => [{ locked }] });
      }) as never,
    },
  };
}

function clock(): AdvisoryLockDeps & { waits: number[] } {
  let now = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => now,
    random: () => 0.5,
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  };
}

describe("withAdvisoryLock", () => {
  describe("when the lock is held by someone else at first", () => {
    it("gives the connection back, waits and runs the work once it gets the lock", async () => {
      const { prisma, tries } = clientAnswering([false, false, true]);
      const deps = clock();
      let runs = 0;

      const value = await withAdvisoryLock({
        prisma,
        key: "seat-org:acme",
        work: async () => ++runs,
        deps,
      });

      expect(value).toBe(1);
      expect(runs).toBe(1);
      expect(tries).toEqual([false, false, true]);
      expect(deps.waits).toHaveLength(2);
    });
  });

  describe("when the lock stays held past the wait", () => {
    it("refuses without running the work", async () => {
      const { prisma } = clientAnswering([]);
      let runs = 0;

      await expect(
        withAdvisoryLock({
          prisma,
          key: "seat-org:acme",
          work: async () => ++runs,
          waitMs: 500,
          deps: clock(),
        }),
      ).rejects.toMatchObject({ name: "AdvisoryLockBusyError", key: "seat-org:acme" });
      expect(runs).toBe(0);
    });
  });
});
