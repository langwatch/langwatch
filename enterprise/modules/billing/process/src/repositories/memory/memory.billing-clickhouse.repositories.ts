// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingClickHouseRepositories } from "../billing.repositories.ts";
import { MemoryBillableEventsMeterRepository } from "./memory.billable-events-meter.repository.ts";
import { MemoryBillableEventsRepository } from "./memory.billable-events.repository.ts";
import { MemoryBillingStore } from "./memory.billing.store.ts";

/** Memory tier for the ClickHouse-backed billing rows. */
export class MemoryBillingClickHouseRepositories {
  static readonly requires = [] as const;

  static create(): BillingClickHouseRepositories {
    const store = MemoryBillingStore.create();

    return {
      billableEvents: MemoryBillableEventsRepository.create(store),
      billableEventsMeter: MemoryBillableEventsMeterRepository.create(store),
    };
  }
}
