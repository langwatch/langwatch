import {
  BillableEventsClickHouseRepository,
  type BillableEventsClickHouseClient,
} from "../repositories/clickhouse/clickhouse.billable-events.repository.ts";
import type { BillableEventsPort } from "../ports/billable-events.port.ts";

export type BillingClickHouseClientResolver = (
  tenantId: string,
) => Promise<BillableEventsClickHouseClient>;

/** Constructs the feature's ClickHouse reader without exposing it. */
export class ClickHouseBillingAdapter {
  private constructor(
    private readonly resolveClient: BillingClickHouseClientResolver,
    private readonly resolveOrganizationClient: BillingClickHouseClientResolver,
  ) {}

  static create(options: {
    resolveClient: BillingClickHouseClientResolver;
    resolveOrganizationClient: BillingClickHouseClientResolver;
  }): ClickHouseBillingAdapter {
    return new ClickHouseBillingAdapter(options.resolveClient, options.resolveOrganizationClient);
  }

  build(): BillableEventsPort {
    return BillableEventsClickHouseRepository.create({
      resolveClient: this.resolveClient,
      resolveOrganizationClient: this.resolveOrganizationClient,
    });
  }
}
