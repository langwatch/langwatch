// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type {
  GovernanceClickHouseClient,
  GovernanceClickHouseResolver,
} from "../../app/governance.members.ts";
import type {
  GovernanceClickHouseRepositories,
  GovernanceClickHouseTenantResolver,
} from "../governance.repositories.ts";
import { ClickHouseAnomalySpendRepository } from "./clickhouse.anomaly-spend.repository.ts";
import { ClickHouseGatewaySpendRepository } from "./clickhouse.gateway-spend.repository.ts";
import { ClickHouseOcsfEventsRepository } from "./clickhouse.ocsf-events.repository.ts";
import { ClickHousePersonalUsageRepository } from "./clickhouse.personal-usage.repository.ts";
import { ClickHouseRollupErasureRepository } from "./clickhouse.rollup-erasure.repository.ts";
import { ClickHouseTraceActivityRepository } from "./clickhouse.trace-activity.repository.ts";

/**
 * The routed ClickHouse member, adapted to the vendor-shaped client every
 * ClickHouse-tier governance repository asks its resolver for. One tenant
 * per resolution, exactly as the tables' own rule requires: every statement
 * names its tenant. Same convention as `modules/trace/process`'s
 * `MemberTraceClickHouseClient` (`app/trace-composition.build.ts:220-231`).
 */
class MemberGovernanceClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query<Row>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number>;
  }): Promise<{ json(): Promise<Row[]> }> {
    const result = await this.clickhouse.query<Row>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params ?? {},
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
    return { json: async () => result.rows };
  }

  async insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values as readonly Record<string, unknown>[],
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
  }
}

/**
 * The member, as the tenant-keyed resolver every ClickHouse-tier governance
 * repository takes. The resolver's client type is narrowed to `query` and
 * `insert`, which is all any repository behind it calls, so the member-backed
 * wrapper satisfies it directly.
 */
function memberClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): GovernanceClickHouseTenantResolver {
  const resolve = (tenantId: string) =>
    Promise.resolve(new MemberGovernanceClickHouseClient(clickhouse, tenantId));
  return resolve;
}

/**
 * The same member, as the `getClient`-shaped resolver
 * `PrismaActivityMonitorRepository` takes for `activityClickhouse`
 * (`repositories/prisma/prisma.ingestion-source-activity.repository.ts:342,373`).
 * That repository resolves per organization id but scopes every statement it
 * sends by the org's hidden governance Project id instead — a different
 * value from the id `getClient` is called with — so this client reads the
 * tenant each statement is actually scoped to out of the statement's own
 * `tenantId` query param rather than out of `getClient`'s argument. Never
 * null: the member this factory closes over exists whenever it is called.
 */
function memberGovernanceClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): GovernanceClickHouseResolver {
  return {
    async getClient(): Promise<GovernanceClickHouseClient> {
      return {
        async query(input) {
          const tenantId = input.query_params?.tenantId;
          if (typeof tenantId !== "string" || tenantId === "") {
            throw new Error(
              "GovernanceClickHouseClient.query: every statement must bind its own tenantId query param",
            );
          }
          const result = await clickhouse.query({
            tenantId,
            sql: input.query,
            params: input.query_params ?? {},
          });
          return { json: async () => result.rows };
        },
      };
    },
  };
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
      traceActivity: ClickHouseTraceActivityRepository.create(clickhouse),
      personalUsage: ClickHousePersonalUsageRepository.create(clickhouse),
      gatewaySpend: ClickHouseGatewaySpendRepository.create(clickhouse),
      rollupErasure: ClickHouseRollupErasureRepository.create(members.clickhouse),
    };
  }
}

export { memberGovernanceClickHouseResolver };
