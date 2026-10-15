import { describe, expect, it } from "vitest";

import { inBatches, MAX_GROUP_IDS_PER_CALL } from "../model/dlq-batches.ts";

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

  describe("given a batch fails", () => {
    it("stops before sending the batches after it", async () => {
      const groupIds = Array.from({ length: 4_500 }, (_, index) => `group-${index}`);
      let calls = 0;

      const run = inBatches({ queueName: "q", groupIds }, async () => {
        calls += 1;
        if (calls === 2) throw new Error("redis down");
        return { redrivenCount: 2_000 };
      });

      await expect(run).rejects.toThrow("redis down");
      expect(calls).toBe(2);
    });
  });
});
