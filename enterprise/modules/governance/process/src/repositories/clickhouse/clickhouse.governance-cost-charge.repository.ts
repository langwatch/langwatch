// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import {
  GOVERNANCE_COST_CHARGE_TABLE,
  GovernanceCostChargeRepository,
  type GovernanceCostChargeRow,
} from "../governance-cost-charge.repository.ts";
import type { GovernanceClickHouseTenantResolver } from "../governance.repositories.ts";

const SYNCHRONOUS_INSERT = { async_insert: 0, wait_for_async_insert: 0 };

const int = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

function decodeCharge(row: Record<string, unknown>): GovernanceCostChargeRow {
  return {
    TenantId: str(row.TenantId),
    Day: str(row.Day),
    CostSource: str(row.CostSource),
    IngestionSourceId: str(row.IngestionSourceId),
    Provider: str(row.Provider),
    Model: str(row.Model),
    AgentId: str(row.AgentId),
    CurrencyCode: str(row.CurrencyCode),
    RawActorId: str(row.RawActorId),
    EventId: str(row.EventId),
    RestatementKey: str(row.RestatementKey),
    IsRetraction: int(row.IsRetraction) === 1,
    ObservedAtMs: int(row.ObservedAtMs),
    AmountNanoMinor: int(row.AmountNanoMinor),
    EventOccurredAt: int(row.EventOccurredAt),
  };
}

/** Keyed (TenantId, Day, EventId) in a ReplacingMergeTree, so a redelivered event collapses. */
export class ClickHouseGovernanceCostChargeRepository extends GovernanceCostChargeRepository {
  private constructor(private readonly resolveClient: GovernanceClickHouseTenantResolver) {
    super();
  }

  static create(
    resolveClient: GovernanceClickHouseTenantResolver,
  ): ClickHouseGovernanceCostChargeRepository {
    return new ClickHouseGovernanceCostChargeRepository(resolveClient);
  }

  async append(row: GovernanceCostChargeRow, _context: ProjectionStoreContext): Promise<void> {
    await this.insert(row.TenantId, [row]);
  }

  async bulkAppend(rows: GovernanceCostChargeRow[], context: BulkAppendContext): Promise<void> {
    if (rows.length === 0) return;
    await this.insert(String(context.tenantId), rows);
  }

  async findChargesForDay(input: {
    tenantId: string;
    day: string;
    costSource: string;
  }): Promise<GovernanceCostChargeRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query<Record<string, unknown>>({
      query: `
        SELECT
          TenantId, toString(Day) AS Day, CostSource, IngestionSourceId, Provider, Model,
          AgentId, CurrencyCode, RawActorId, EventId, RestatementKey, IsRetraction,
          ObservedAtMs, AmountNanoMinor, EventOccurredAt
        FROM ${GOVERNANCE_COST_CHARGE_TABLE} FINAL
        WHERE TenantId = {tenantid:String}
          AND Day = {day:Date}
          AND CostSource = {costsource:String}
      `,
      query_params: { tenantid: input.tenantId, day: input.day, costsource: input.costSource },
      format: "JSONEachRow",
    });
    return (await result.json()).map(decodeCharge);
  }

  async findLatestChargeOccurredAt(input: {
    tenantId: string;
    costSource: string;
  }): Promise<number | null> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query<Record<string, unknown>>({
      query: `
        SELECT max(EventOccurredAt) AS LatestOccurredAt
        FROM ${GOVERNANCE_COST_CHARGE_TABLE}
        WHERE TenantId = {tenantid:String}
          AND CostSource = {costsource:String}
      `,
      query_params: { tenantid: input.tenantId, costsource: input.costSource },
      format: "JSONEachRow",
    });
    const latest = int((await result.json())[0]?.LatestOccurredAt);
    return latest > 0 ? latest : null;
  }

  private async insert(tenantId: string, rows: GovernanceCostChargeRow[]): Promise<void> {
    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: GOVERNANCE_COST_CHARGE_TABLE,
      values: rows.map((row) => ({ ...row, IsRetraction: row.IsRetraction ? 1 : 0 })),
      format: "JSONEachRow",
      clickhouse_settings: SYNCHRONOUS_INSERT,
    });
  }
}
