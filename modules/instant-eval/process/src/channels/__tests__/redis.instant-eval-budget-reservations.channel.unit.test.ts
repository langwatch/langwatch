/**
 * The shared hold store: what it asks Redis for, and how it reads the answer
 * back. @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import {
  type InstantEvalBudgetReservationsRedis,
  RedisInstantEvalBudgetReservationsChannel,
} from "../redis/redis.instant-eval-budget-reservations.channel.ts";

type Call = { script: string; keyCount: number; args: string[] };

function channelAnswering(reply: unknown) {
  const evals: Call[] = [];
  const deleted: string[] = [];
  const removed: [string, string][] = [];
  const redis: InstantEvalBudgetReservationsRedis = {
    eval: async (script, keyCount, ...args) => {
      evals.push({ script, keyCount, args });

      return reply;
    },
    del: async (key) => void deleted.push(key),
    srem: async (key, member) => void removed.push([key, member]),
  };

  return {
    evals,
    deleted,
    removed,
    channel: RedisInstantEvalBudgetReservationsChannel.create({ redis }),
  };
}

describe("given holds kept where every pod can see them", () => {
  describe("when one is taken", () => {
    /** @scenario "Holds are shared across processes" */
    it("keys the index and the hold in one hash slot, with the lifetime in seconds", async () => {
      const { channel, evals } = channelAnswering([1, "40"]);

      const outcome = await channel.reserve({
        organizationId: "org_1",
        reservationId: "run_a",
        nanoUsd: 40.4,
        limitNanoUsd: 60,
        ttlMs: 90_000,
      });

      expect(outcome).toEqual({ isReserved: true, heldNanoUsd: 40 });
      expect(evals[0]!.keyCount).toBe(1);
      expect(evals[0]!.args[0]).toBe("langwatch:{instant-evals:free-budget:org_1}:reservations");
      expect(evals[0]!.args[1]).toBe("langwatch:{instant-evals:free-budget:org_1}:reservation:");
      expect(evals[0]!.args.slice(2)).toEqual(["run_a", "40", "60", "90"]);
    });
  });

  describe("when it does not fit", () => {
    /** @scenario "Runs accepted together share the budget" */
    it("reports the refusal with what the others hold", async () => {
      const { channel } = channelAnswering([0, "55"]);

      await expect(
        channel.reserve({
          organizationId: "org_1",
          reservationId: "run_b",
          nanoUsd: 40,
          limitNanoUsd: 60,
          ttlMs: 90_000,
        }),
      ).resolves.toEqual({ isReserved: false, heldNanoUsd: 55 });
    });
  });

  describe("when a hold is released", () => {
    /** @scenario "A hold is released when the run's spend lands" */
    it("drops the hold key and its index member", async () => {
      const { channel, deleted, removed } = channelAnswering([1, "0"]);

      await channel.release({ organizationId: "org_1", reservationId: "run_a" });

      expect(deleted).toEqual(["langwatch:{instant-evals:free-budget:org_1}:reservation:run_a"]);
      expect(removed).toEqual([
        ["langwatch:{instant-evals:free-budget:org_1}:reservations", "run_a"],
      ]);
    });
  });

  describe("when the total is read leaving the caller's own hold out", () => {
    /** @scenario "A run under way counts the runs accepted beside it" */
    it("passes the exclusion, and an empty one when there is none", async () => {
      const { channel, evals } = channelAnswering("30");

      await expect(channel.heldNanoUsd({ organizationId: "org_1", except: "run_a" })).resolves.toBe(
        30,
      );
      await channel.heldNanoUsd({ organizationId: "org_1" });

      expect(evals[0]!.args[2]).toBe("run_a");
      expect(evals[1]!.args[2]).toBe("");
    });
  });
});
