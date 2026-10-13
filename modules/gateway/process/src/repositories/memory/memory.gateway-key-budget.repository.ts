import type { GatewayBudget } from "@langwatch/gateway-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  GatewayKeyBudgetRepository,
  type GatewayKeyBudgetFields,
  type GatewayKeyBudgetScope,
} from "../gateway-key-budget.repository.ts";
import { memoryGatewayDecimal, type MemoryGatewayStore } from "./memory.gateway.store.ts";

/** A key drawer's own budgets, over the budget rows every memory budget read shares. */
export class MemoryGatewayKeyBudgetRepository extends GatewayKeyBudgetRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayKeyBudgetRepository {
    return new MemoryGatewayKeyBudgetRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findDrawerManaged(input: {
    organizationId: string;
    virtualKeyId: string;
  }): Promise<GatewayBudget | null> {
    return (
      this.#active(input.organizationId).find(
        (budget) => budget.managedByVirtualKeyId === input.virtualKeyId,
      ) ?? null
    );
  }

  async createForKey(input: {
    organizationId: string;
    virtualKeyId: string;
    createdById: string;
    resetsAt: Instant;
    fields: GatewayKeyBudgetFields;
  }): Promise<GatewayBudget> {
    const now = nowInstant();
    const budget: GatewayBudget = {
      id: this.store.newId("gatewaybudget"),
      organizationId: input.organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: input.virtualKeyId,
      providerKey: null,
      name: input.fields.name,
      description: null,
      window: input.fields.window,
      limitUsd: memoryGatewayDecimal(input.fields.limitUsd),
      onBreach: input.fields.onBreach,
      timezone: input.fields.timezone,
      externalId: null,
      metadata: {},
      spentUsd: memoryGatewayDecimal("0"),
      currentPeriodStartedAt: now,
      resetsAt: input.resetsAt,
      lastResetAt: null,
      cycleAnchorAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdById: input.createdById,
      managedByVirtualKeyId: input.virtualKeyId,
    };
    this.store.budgets.set(budget.id, budget);

    return budget;
  }

  async updateForKey(input: {
    id: string;
    resetsAt?: Instant;
    fields: GatewayKeyBudgetFields;
  }): Promise<GatewayBudget> {
    return this.#replace(input.id, {
      name: input.fields.name,
      window: input.fields.window,
      limitUsd: memoryGatewayDecimal(input.fields.limitUsd),
      onBreach: input.fields.onBreach,
      timezone: input.fields.timezone,
      ...(input.resetsAt ? { resetsAt: input.resetsAt } : {}),
    });
  }

  async findActiveForKey(input: {
    organizationId: string;
    virtualKeyId: string;
    scope: GatewayKeyBudgetScope;
  }): Promise<GatewayBudget[]> {
    return this.#active(input.organizationId).filter(
      (budget) =>
        budget.managedByVirtualKeyId === input.virtualKeyId ||
        (input.scope === "scopedToKey" &&
          (budget.scopeType === "VIRTUAL_KEY" || budget.scopeType === "ATTRIBUTED_USER") &&
          budget.scopeId === input.virtualKeyId),
    );
  }

  async archive(input: { id: string; archivedAt: Instant }): Promise<GatewayBudget> {
    return this.#replace(input.id, { archivedAt: input.archivedAt });
  }

  #active(organizationId: string): GatewayBudget[] {
    return [...this.store.budgets.values()].filter(
      (budget) => budget.organizationId === organizationId && budget.archivedAt === null,
    );
  }

  #replace(id: string, changes: Partial<GatewayBudget>): GatewayBudget {
    const current = this.store.budgets.get(id);
    if (!current) throw new Error(`No gateway budget ${id} to update`);
    const next = { ...current, ...changes, updatedAt: nowInstant() };
    this.store.budgets.set(id, next);

    return next;
  }
}
