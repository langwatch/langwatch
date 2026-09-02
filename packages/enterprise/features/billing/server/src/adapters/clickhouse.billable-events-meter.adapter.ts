// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseSettings, DataFormat } from "@clickhouse/client";
import { BillableEventsMeterClickHouseRepository } from "../repositories/clickhouse/clickhouse.billable-events-meter.repository";
import type { BillableEventsMeterPort } from "../ports/billable-events-meter.port";

/**
 * The one statement this meter issues, rather than a vendor client.
 *
 * Structural for the reason the metric and suite ports are: a background
 * worker composes this write over the Eventing substrate's own ClickHouse
 * client, which describes a `readonly` batch and the settings map generally.
 * Naming the driver class refused that client for no behavioural reason, while
 * a driver client still satisfies this shape.
 */
export interface BillableEventsMeterClickHouseClient {
  insert(params: {
    table: string;
    /** Read-only on purpose: nothing here mutates the batch it is handed. */
    values: readonly unknown[];
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
}

/**
 * Organization-keyed, and nullable: billing routes ClickHouse per organization,
 * and a deployment with no ClickHouse at all resolves to nothing rather than
 * failing — the meter is a SaaS-only write.
 */
export type BillableEventsMeterClickHouseClientResolver = (
  organizationId: string,
) => Promise<BillableEventsMeterClickHouseClient | null>;

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
