// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { BillingClickHouseRepositories } from "../billing.repositories.ts";
import { BillableEventsMeterClickHouseRepository } from "./clickhouse.billable-events-meter.repository.ts";
import { BillableEventsClickHouseRepository } from "./clickhouse.billable-events.repository.ts";

/** Live tier for billing's ClickHouse rows, selected with the process client. */
export class ClickHouseBillingRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create(
    members: Readonly<{ clickhouse: ClickHouseQueryClient }>,
  ): BillingClickHouseRepositories {
    return {
      billableEvents: BillableEventsClickHouseRepository.create(members.clickhouse),
      billableEventsMeter: BillableEventsMeterClickHouseRepository.create(members.clickhouse),
    };
  }
}
