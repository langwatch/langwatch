// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal } from "@langwatch/time";

import {
  BillableEventsRepository,
  type BillableEventsWindow,
} from "../billable-events.repository.ts";
import type { MemoryBillableEvent, MemoryBillingStore } from "./memory.billing.store.ts";

/** In-memory read twin of billing's ClickHouse event and trace-summary queries. */
export class MemoryBillableEventsRepository extends BillableEventsRepository {
  readonly #store: MemoryBillingStore;

  private constructor(store: MemoryBillingStore) {
    super();
    this.#store = store;
  }

  static create(store: MemoryBillingStore): MemoryBillableEventsRepository {
    return new MemoryBillableEventsRepository(store);
  }

  async findTotal(input: { organizationId: string } & BillableEventsWindow): Promise<number> {
    return distinctCount(this.#eventsInWindow(input).map((event) => event.deduplicationKey));
  }

  /** Memory stays exact so small test data is deterministic; ClickHouse `uniq` remains approximate. */
  async findTotalUniq(input: { organizationId: string } & BillableEventsWindow): Promise<number> {
    return distinctCount(this.#eventsInWindow(input).map((event) => event.deduplicationKey));
  }

  async findTraceSummariesTotalUniq(
    input: { tenantIds: string[] } & BillableEventsWindow,
  ): Promise<number> {
    const tenantIds = new Set(input.tenantIds);
    const { start, end } = window(input);
    const traceIds = this.#store.traceSummaries
      .filter(
        (summary) =>
          tenantIds.has(summary.tenantId) && summary.createdAt >= start && summary.createdAt < end,
      )
      .map((summary) => summary.traceId);

    return distinctCount(traceIds);
  }

  async findByProjectApprox(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<{ projectId: string; count: number }[]> {
    return countsByProject(this.#eventsInWindow(input));
  }

  async findByProject(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<{ projectId: string; count: number }[]> {
    return countsByProject(this.#eventsInWindow(input));
  }

  #eventsInWindow(input: { organizationId: string } & BillableEventsWindow) {
    const { start, end } = window(input);
    return this.#store.billableEvents.filter(
      (event) =>
        event.organizationId === input.organizationId &&
        event.eventTimestamp >= start &&
        event.eventTimestamp < end,
    );
  }
}

function window(input: BillableEventsWindow): { start: number; end: number } {
  return { start: epochMilliseconds(input.startDate), end: epochMilliseconds(input.endDate) };
}

function epochMilliseconds(timestamp: string): number {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(timestamp)) {
    throw new Error(
      "Billable event windows use UTC DateTime64(3) values without timezone suffixes",
    );
  }

  return Temporal.PlainDateTime.from(timestamp.replace(" ", "T")).toZonedDateTime("UTC")
    .epochMilliseconds;
}

function distinctCount(values: readonly string[]): number {
  return new Set(values).size;
}

function countsByProject(
  events: readonly MemoryBillableEvent[],
): { projectId: string; count: number }[] {
  const keysByProject = new Map<string, Set<string>>();
  for (const event of events) {
    const keys = keysByProject.get(event.tenantId) ?? new Set<string>();
    keys.add(event.deduplicationKey);
    keysByProject.set(event.tenantId, keys);
  }

  return [...keysByProject].map(([projectId, keys]) => ({ projectId, count: keys.size }));
}
