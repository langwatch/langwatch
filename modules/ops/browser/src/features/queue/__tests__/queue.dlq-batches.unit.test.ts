import { describe, expect, it } from "vitest";

import { inBatches, MAX_GROUP_IDS_PER_CALL, PartialBatchError } from "../model/dlq-batches.ts";

describe("inBatches", () => {
  describe("given more group ids than one call accepts", () => {
    it("sends every id, in order, in calls no larger than the limit, and sums the counts", async () => {
      const groupIds = Array.from({ length: 5_992 }, (_, index) => `group-${index}`);
      const calls: string[][] = [];

      const totals = await inBatches({ queueName: "q", groupIds }, async (batch) => {
        expect(batch.queueName).toBe("q");
        calls.push(batch.groupIds);
        return { discardedCount: batch.groupIds.length, jobsDiscarded: batch.groupIds.length * 2 };
      });

      expect(calls.map((ids) => ids.length)).toEqual([2_000, 2_000, 1_992]);
      expect(calls.every((ids) => ids.length <= MAX_GROUP_IDS_PER_CALL)).toBe(true);
      expect(calls.flat()).toEqual(groupIds);
      expect(totals).toEqual({ discardedCount: 5_992, jobsDiscarded: 11_984 });
    });
  });

  describe("given exactly one id more than one call accepts", () => {
    it("sends a second call holding the one remaining id", async () => {
      const groupIds = Array.from(
        { length: MAX_GROUP_IDS_PER_CALL + 1 },
        (_, index) => `g-${index}`,
      );
      const sizes: number[] = [];

      await inBatches({ queueName: "q", groupIds }, async (batch) => {
        sizes.push(batch.groupIds.length);
        return { discardedCount: batch.groupIds.length };
      });

      expect(sizes).toEqual([MAX_GROUP_IDS_PER_CALL, 1]);
    });
  });

  describe("given a batch fails after an earlier one applied", () => {
    it("stops there and reports what the earlier batches applied", async () => {
      const groupIds = Array.from({ length: 4_500 }, (_, index) => `group-${index}`);
      const cause = new Error("redis down");
      let calls = 0;

      const failure = await inBatches({ queueName: "q", groupIds }, async () => {
        calls += 1;
        if (calls === 2) throw cause;
        return { redrivenCount: 2_000, jobsRedriven: 3_000 };
      }).catch((error: unknown) => error);

      expect(calls).toBe(2);
      expect(failure).toBeInstanceOf(PartialBatchError);
      expect((failure as PartialBatchError).cause).toBe(cause);
      expect((failure as PartialBatchError).done).toEqual({
        redrivenCount: 2_000,
        jobsRedriven: 3_000,
      });
    });
  });

  describe("given the first batch fails", () => {
    it("rethrows its error unchanged, since nothing applied", async () => {
      const cause = new Error("forbidden");

      const failure = await inBatches({ queueName: "q", groupIds: ["g"] }, async () => {
        throw cause;
      }).catch((error: unknown) => error);

      expect(failure).toBe(cause);
    });
  });
});
