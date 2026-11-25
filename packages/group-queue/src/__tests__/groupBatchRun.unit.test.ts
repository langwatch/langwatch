import { describe, expect, it } from "vitest";

import { runGroupBatch } from "../groupBatchRun.ts";

type Outcome = { completed: string[]; failed: string[]; calls: string[][] };

/** Drives the descent with a call that fails while it carries any of `poison`. */
async function run({
  groups,
  poison,
  overloaded = false,
}: {
  groups: string[];
  poison: string[];
  overloaded?: boolean;
}): Promise<Outcome & { continuations: Map<string, boolean[]> }> {
  const outcome: Outcome = { completed: [], failed: [], calls: [] };
  const continuations = new Map<string, boolean[]>();
  const record = (job: string, isContinuation: boolean) =>
    continuations.set(job, [...(continuations.get(job) ?? []), isContinuation]);
  const failing = (set: readonly string[]) => set.some((job) => poison.includes(job));
  await runGroupBatch({
    jobs: groups,
    runAll: async (set, isContinuation) => {
      outcome.calls.push([...set]);
      for (const job of set) record(job, isContinuation(job));
      if (failing(set)) throw new Error(overloaded ? "overloaded" : "poison");
    },
    runOne: async (job, isContinuation) => {
      outcome.calls.push([job]);
      record(job, isContinuation);
      if (failing([job])) throw new Error("poison");
    },
    succeed: async (set) => {
      outcome.completed.push(...set);
    },
    fail: async (job) => {
      outcome.failed.push(job);
    },
    splitsOnFailure: (error) => !(error instanceof Error && error.message === "overloaded"),
  });
  return { ...outcome, continuations };
}

const sixteen = Array.from({ length: 16 }, (_, index) => `g${index}`);

describe("runGroupBatch", () => {
  describe("given every group succeeds", () => {
    it("runs them all in one call and completes each", async () => {
      const outcome = await run({ groups: sixteen, poison: [] });

      expect(outcome.calls).toEqual([sixteen]);
      expect(outcome.completed).toEqual(sixteen);
      expect(outcome.failed).toEqual([]);
    });
  });

  describe("given one group fails", () => {
    /** @scenario "One failing group is retried alone while the others complete" */
    it("fails only that group and completes the other fifteen", async () => {
      const outcome = await run({ groups: sixteen, poison: ["g5"] });

      expect(outcome.failed).toEqual(["g5"]);
      expect(outcome.completed.toSorted()).toEqual(sixteen.filter((g) => g !== "g5").toSorted());
    });

    it("runs the halves in order, never two calls at once over one group", async () => {
      const outcome = await run({ groups: sixteen, poison: ["g5"] });

      expect(outcome.calls[1]).toEqual(sixteen.slice(0, 8));
      expect(outcome.calls.at(-1)).toEqual(sixteen.slice(8));
    });

    it("marks every later call over a group an earlier call carried as a continuation", async () => {
      const outcome = await run({ groups: sixteen, poison: ["g5"] });

      expect(outcome.continuations.get("g5")?.[0]).toBe(false);
      expect(outcome.continuations.get("g5")?.slice(1).every(Boolean)).toBe(true);
    });
  });

  describe("given the call fails for shared overload", () => {
    /** @scenario "A shared overload backs every group off without splitting" */
    it("fails every group from the one call, unsplit", async () => {
      const outcome = await run({ groups: sixteen, poison: ["g5"], overloaded: true });

      expect(outcome.calls).toEqual([sixteen]);
      expect(outcome.failed.toSorted()).toEqual(sixteen.toSorted());
    });
  });
});
