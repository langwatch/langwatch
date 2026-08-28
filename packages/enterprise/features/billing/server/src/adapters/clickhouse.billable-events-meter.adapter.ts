// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";
import { BillableEventsMeterClickHouseRepository } from "../repositories/clickhouse/clickhouse.billable-events-meter.repository";
import type { BillableEventsMeterPort } from "../ports/billable-events-meter.port";

/**
 * Organization-keyed, and nullable: billing routes ClickHouse per organization,
 * and a deployment with no ClickHouse at all resolves to nothing rather than
 * failing — the meter is a SaaS-only write.
 */
export type BillableEventsMeterClickHouseClientResolver = (
  organizationId: string,
) => Promise<ClickHouseClient | null>;

/** Constructs the meter's ClickHouse writer without exposing it. */
export class ClickHouseBillableEventsMeterAdapter {
  private constructor(
    private readonly resolveClient: BillableEventsMeterClickHouseClientResolver,
  ) {}

  static create(options: {
    resolveClient: BillableEventsMeterClickHouseClientResolver;
  }): ClickHouseBillableEventsMeterAdapter {
    return new ClickHouseBillableEventsMeterAdapter(options.resolveClient);
  }

  build(): BillableEventsMeterPort {
    return BillableEventsMeterClickHouseRepository.create({
      resolveClient: this.resolveClient,
    });
  }
}
