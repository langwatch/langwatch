// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { MemoryAggregateReconcileLockRepository } from "../memory/memory.aggregate-reconcile-lock.repository.ts";

describe("MemoryAggregateReconcileLockRepository", () => {
  it("runs the reconciles of one aggregate one at a time, a failure not blocking the next", async () => {
    const lock = MemoryAggregateReconcileLockRepository.create();
    const order: string[] = [];
    const slow = lock.withAggregateLock({
      aggregateProjectId: "agg-1",
      reconcile: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("first");
        throw new Error("boom");
      },
    });
    const other = lock.withAggregateLock({
      aggregateProjectId: "agg-2",
      reconcile: async () => order.push("other aggregate"),
    });
    const next = lock.withAggregateLock({
      aggregateProjectId: "agg-1",
      reconcile: async () => order.push("second"),
    });

    await expect(slow).rejects.toThrow("boom");
    await Promise.all([other, next]);
    expect(order).toEqual(["other aggregate", "first", "second"]);
  });
});
