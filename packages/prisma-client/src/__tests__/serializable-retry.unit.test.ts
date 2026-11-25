/**
 * How long `withSerializationRetry` waits before running a lost transaction
 * again, and what it throws when it stops (#8200).
 * @see specs/identity/authentication-settings.feature
 */

import { describe, expect, it, vi } from "vitest";

import { Prisma } from "../generated/client.ts";
import { withSerializationRetry } from "../serializable-retry.ts";

function conflict() {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "7.9.1" },
  );
}

/**
 * A `run` and a `wait` that write to one log, so the order they were called
 * in — not just how often — is what the test reads back.
 */
function harness({ random = () => 0.5 }: { random?: () => number } = {}) {
  const log: string[] = [];
  const wait = vi.fn(async (ms: number) => {
    log.push(`wait ${ms}`);
  });
  const losing = (races: number, outcome = "would_strand_user") => {
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      log.push(`run ${calls}`);
      if (calls <= races) throw conflict();
      return outcome;
    });
  };
  return { log, deps: { wait, random }, losing };
}

describe("withSerializationRetry", () => {
  describe("given a transaction that loses three races before it commits", () => {
    /** @scenario "A transaction that lost a race is run again after a short random wait" */
    it("runs four times, waiting a draw from a doubling window between each, and never after the last", async () => {
      const { log, deps, losing } = harness();

      await expect(withSerializationRetry(losing(3), deps)).resolves.toBe("would_strand_user");

      expect(log).toEqual(["run 1", "wait 5", "run 2", "wait 10", "run 3", "wait 20", "run 4"]);
    });

    it.each([
      { draw: 0, waits: [0, 0, 0] },
      { draw: 0.25, waits: [2.5, 5, 10] },
      { draw: 0.999, waits: [9.99, 19.98, 39.96] },
    ])("scales the draw $draw over windows of 10, 20 and 40 ms", async ({ draw, waits }) => {
      const { deps, losing } = harness({ random: () => draw });

      await withSerializationRetry(losing(3), deps);

      expect(deps.wait.mock.calls.map(([ms]) => ms)).toEqual(
        waits.map((ms) => expect.closeTo(ms, 6)),
      );
    });
  });

  describe("given a transaction that loses every race", () => {
    /** @scenario "A conflict that outlives the retry budget is thrown as it was" */
    it("throws the fourth conflict after four runs and three waits", async () => {
      const { log, deps, losing } = harness();
      const run = losing(Number.POSITIVE_INFINITY);

      await expect(withSerializationRetry(run, deps)).rejects.toMatchObject({
        code: "P2034",
      });

      expect(run).toHaveBeenCalledTimes(4);
      expect(log.filter((entry) => entry.startsWith("wait"))).toEqual([
        "wait 5",
        "wait 10",
        "wait 20",
      ]);
    });
  });

  describe("given a transaction that fails for a reason other than a lost race", () => {
    /** @scenario "A failure that is not a lost race is thrown at once" */
    it("throws it from the first run, without waiting", async () => {
      const { deps } = harness();
      const failure = new Error("connection closed");
      const run = vi.fn().mockRejectedValue(failure);

      await expect(withSerializationRetry(run, deps)).rejects.toBe(failure);

      expect(run).toHaveBeenCalledTimes(1);
      expect(deps.wait).not.toHaveBeenCalled();
    });
  });

  describe("given a transaction that commits first time", () => {
    it("returns its answer without waiting", async () => {
      const { deps, losing } = harness();

      await expect(withSerializationRetry(losing(0, "deleted"), deps)).resolves.toBe("deleted");

      expect(deps.wait).not.toHaveBeenCalled();
    });
  });
});
