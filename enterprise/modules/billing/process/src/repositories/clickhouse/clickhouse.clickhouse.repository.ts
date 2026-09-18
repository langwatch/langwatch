import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { BillableEventsRepository } from "../billable-events.repository.ts";
import { BillableEventsClickHouseRepository } from "./clickhouse.billable-events.repository.ts";

/** Constructs billing's ClickHouse reader from the process client. */
export class ClickHouseBillingAdapter {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    this.#clickhouse = clickhouse;
  }

  static create(options: { clickhouse: ClickHouseQueryClient }): ClickHouseBillingAdapter {
    return new ClickHouseBillingAdapter(options.clickhouse);
  }

  build(): BillableEventsRepository {
    return BillableEventsClickHouseRepository.create(this.#clickhouse);
  }
}
