import type { GatewayBudget } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";

import { VirtualKeyDirectBudgetRepository } from "../gateway-virtual-key-direct-budget.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** The live budgets naming a key directly or managed by its drawer, oldest first. */
export class MemoryVirtualKeyDirectBudgetRepository extends VirtualKeyDirectBudgetRepository {
  static create(store: MemoryGatewayStore): MemoryVirtualKeyDirectBudgetRepository {
    return new MemoryVirtualKeyDirectBudgetRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findBudgetsTargetingKeys(input: {
    organizationId: string;
    virtualKeyIds: string[];
  }): Promise<GatewayBudget[]> {
    const keys = new Set(input.virtualKeyIds);

    return [...this.store.budgets.values()]
      .filter(
        (budget) =>
          budget.organizationId === input.organizationId &&
          budget.archivedAt === null &&
          ((budget.scopeType === "VIRTUAL_KEY" && keys.has(budget.scopeId)) ||
            (budget.managedByVirtualKeyId !== null && keys.has(budget.managedByVirtualKeyId))),
      )
      .toSorted((left, right) => Temporal.Instant.compare(left.createdAt, right.createdAt));
  }
}
