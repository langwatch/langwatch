// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  clickhouseRead,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type { BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import {
  GOVERNANCE_COST_CHARGE_TABLE,
  GovernanceCostChargeRepository,
  type GovernanceCostChargeRow,
} from "../governance-cost-charge.repository.ts";
import type { GovernanceClickHouseReadResolver } from "../governance.repositories.ts";
import { governanceCostRollupCharges as charges } from "./clickhouse.governance-cost-rollup-charges.table.ts";

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
  private constructor(private readonly resolveClient: GovernanceClickHouseReadResolver) {
    super();
  }

  static create(
    resolveClient: GovernanceClickHouseReadResolver,
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
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(charges)
      .final()
      .select({
        TenantId: charges.TenantId,
        Day: charges.Day,
        CostSource: charges.CostSource,
        IngestionSourceId: charges.IngestionSourceId,
        Provider: charges.Provider,
        Model: charges.Model,
        AgentId: charges.AgentId,
        CurrencyCode: charges.CurrencyCode,
        RawActorId: charges.RawActorId,
        EventId: charges.EventId,
        RestatementKey: charges.RestatementKey,
        IsRetraction: charges.IsRetraction,
        ObservedAtMs: charges.ObservedAtMs,
        AmountNanoMinor: charges.AmountNanoMinor,
        EventOccurredAt: charges.EventOccurredAt,
      })
      .where(({ and, eq }) =>
        and(eq(charges.Day, input.day), eq(charges.CostSource, input.costSource)),
      )
      .build();
    return (await this.rowsOf(input.tenantId, statement)).map(decodeCharge);
  }

  async findLatestChargeOccurredAt(input: {
    tenantId: string;
    costSource: string;
  }): Promise<number | null> {
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(charges)
      .select({ LatestOccurredAt: fn.max(charges.EventOccurredAt) })
      .where(({ eq }) => eq(charges.CostSource, input.costSource))
      .build();
    const latest = int((await this.rowsOf(input.tenantId, statement))[0]?.LatestOccurredAt);
    return latest > 0 ? latest : null;
  }

  private async rowsOf(
    tenantId: string,
    statement: ReaderReadStatement<Record<string, unknown>>,
  ): Promise<Record<string, unknown>[]> {
    const client = await this.resolveClient(tenantId);
    const { rows } = await client.read({ statement });
    return rows;
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
