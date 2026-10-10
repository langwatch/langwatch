// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BillingContractBudgetRepository,
  type BillingContractBudgetRecord,
} from "../billing-contract-budget.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/** The Prisma read's twin over the store's contract budgets. */
export class MemoryBillingContractBudgetRepository extends BillingContractBudgetRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingContractBudgetRepository {
    return new MemoryBillingContractBudgetRepository(store);
  }

  async findContractBudget({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BillingContractBudgetRecord[]> {
    const budget = this.store.contractBudgets.get(organizationId);
    return budget ? [budget] : [];
  }
}
