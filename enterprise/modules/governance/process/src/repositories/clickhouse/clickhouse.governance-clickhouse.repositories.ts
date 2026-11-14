// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type {
  GovernanceClickHouseReadClient,
  GovernanceClickHouseRepositories,
} from "../governance.repositories.ts";
import { ClickHouseAnomalySpendRepository } from "./clickhouse.anomaly-spend.repository.ts";
import { ClickHouseOcsfEventsRepository } from "./clickhouse.ocsf-events.repository.ts";

/**
 * The routed ClickHouse member, adapted to the vendor-shaped client every
 * ClickHouse-tier governance repository asks its resolver for. One tenant
 * per resolution, exactly as the tables' own rule requires: every statement
 * names its tenant. Same convention as `modules/trace/process`'s
 * `ClickHouseTraceClientsRepository` (`repositories/clickhouse/clickhouse.trace-member-client.repository.ts`).
 * A built read names its own tenant, so `read` goes straight to the member.
 */
class MemberGovernanceClickHouseClient implements GovernanceClickHouseReadClient {
  readonly read: ClickHouseQueryClient["read"];

  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {
    this.read = (input) => clickhouse.read(input);
  }

  async insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
  }
}

/**
 * The member, as the tenant-keyed resolver every ClickHouse-tier governance
 * repository takes: `read` for its built reads, `insert` for its rows.
 */
function memberClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): (tenantId: string) => Promise<MemberGovernanceClickHouseClient> {
  const resolve = (tenantId: string) =>
    Promise.resolve(new MemberGovernanceClickHouseClient(clickhouse, tenantId));
  return resolve;
}

/**
 * Live tier for the ClickHouse-backed governance repositories. The process
 * hands this class the real `clickhouse` process member — one
 * `ClickHouseQueryClient` instance, not a resolver function — and this file
 * wraps it into the per-tenant resolver every repository below is written
 * against, unchanged from when the composition package owned the query text.
 */
export class ClickHouseGovernanceRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create(
    members: Readonly<{ clickhouse: ClickHouseQueryClient }>,
  ): GovernanceClickHouseRepositories {
    const clickhouse = memberClickHouseResolver(members.clickhouse);

    return {
      anomalySpend: ClickHouseAnomalySpendRepository.create(clickhouse),
      ocsfEvents: ClickHouseOcsfEventsRepository.create(clickhouse),
    };
  }
}

export { memberClickHouseResolver };
