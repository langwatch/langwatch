// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BillableEventsMeter,
  type BillableEventRecord,
} from "../billable-events-meter.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/** In-memory write twin of the billable-events ClickHouse table. */
export class MemoryBillableEventsMeterRepository extends BillableEventsMeter {
  readonly #store: MemoryBillingStore;

  private constructor(store: MemoryBillingStore) {
    super();
    this.#store = store;
  }

  static create(store: MemoryBillingStore): MemoryBillableEventsMeterRepository {
    return new MemoryBillableEventsMeterRepository(store);
  }

  async insert(input: { record: BillableEventRecord; organizationId: string }): Promise<void> {
    this.#store.billableEvents.push({ ...input.record, organizationId: input.organizationId });
  }
}
