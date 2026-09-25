// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `governanceCostRollup.clickhouse.repository.ts` reads. */
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
  GovernanceCostRollupRepository,
  type GovernanceCostModelGroup,
  type GovernanceCostPeriodRecordGroup,
  type GovernanceCostProviderDayGroup,
  type GovernanceCostRollupWindow,
  type GovernanceCostSpenderGroup,
} from "../governance-cost-rollup.repository.ts";
import type { GovernanceClickHouseTenantResolver } from "../governance.repositories.ts";

const TABLE = "governance_cost_rollup_1d";
const PROJECTION_VERSION_LATEST = "2026-08-28";
const UNPRICED_CURRENCY_SAMPLE_LIMIT = 8;
const KEY_COLUMNS = [
  "TenantId",
  "Day",
  "CostSource",
  "IngestionSourceId",
  "Provider",
  "Model",
  "AgentId",
  "CurrencyCode",
  "RawActorId",
] as const;

/** No USD figure, and nothing in another currency either. */
const HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL = `
            LatestAmountNanoUsd IS NULL
            AND (
              CurrencyCode = {usd:String}
              OR CurrencyCode = ''
              OR LatestAmountNanoMinor = 0
            )`;

const CURRENCIES_WITHOUT_USD_SQL = `arraySort(groupUniqArrayIf(${UNPRICED_CURRENCY_SAMPLE_LIMIT})(
            CurrencyCode,
            LatestAmountNanoUsd IS NULL AND CurrencyCode != {usd:String}
          ))`;

/** Every cell collapsed to its surviving version, tenant and partition key first. */
function latestPulledCells(extraWhere = ""): string {
  return `
          SELECT
            ${KEY_COLUMNS.join(",\n            ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
            argMax(AmountNanoMinor, EventTimestamp) AS LatestAmountNanoMinor
          FROM ${TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}${extraWhere}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}`;
}

function windowParams(input: GovernanceCostRollupWindow): Record<string, unknown> {
  return {
    tenantid: input.tenantId,
    fromday: input.fromDay,
    today: input.toDay,
    costsource: GOVERNANCE_COST_SOURCE.PULLED,
    version: PROJECTION_VERSION_LATEST,
    usd: GOVERNANCE_COST_CURRENCY_USD,
  };
}

const int = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => str(entry)) : [];

export class ClickHouseGovernanceCostRollupRepository extends GovernanceCostRollupRepository {
  private constructor(private readonly resolveClient: GovernanceClickHouseTenantResolver) {
    super();
  }

  static create(
    resolveClient: GovernanceClickHouseTenantResolver,
  ): ClickHouseGovernanceCostRollupRepository {
    return new ClickHouseGovernanceCostRollupRepository(resolveClient);
  }

  async sumDaysByProvider(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostProviderDayGroup[]> {
    const rows = await this.read(input, {
      query: `
        SELECT
          Day                            AS Day,
          Provider                       AS Provider,
          sumOrNull(LatestAmountNanoUsd) AS AmountNanoUsd,
          countIf(${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
          ) AS CellsWithoutAmount,
          ${CURRENCIES_WITHOUT_USD_SQL} AS CurrenciesWithoutUsdAmount
        FROM (${latestPulledCells()}
        )
        GROUP BY Day, Provider
        ORDER BY Day, Provider`,
    });
    return rows.map((row) => ({
      day: str(row.Day),
      provider: str(row.Provider),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
    }));
  }

  async sumPeriodRecordsByProvider(
    input: GovernanceCostRollupWindow & { provider: string },
  ): Promise<GovernanceCostPeriodRecordGroup[]> {
    const rows = await this.read(input, {
      query: `
        SELECT
          Model                          AS Model,
          AgentId                        AS AgentId,
          sumOrNull(LatestAmountNanoUsd) AS AmountNanoUsd,
          countIf(${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
          ) AS CellsWithoutAmount,
          ${CURRENCIES_WITHOUT_USD_SQL} AS CurrenciesWithoutUsdAmount
        FROM (${latestPulledCells("\n            AND Provider = {provider:String}")}
        )
        GROUP BY Model, AgentId
        ORDER BY Model, AgentId`,
      params: { provider: input.provider },
    });
    return rows.map((row) => ({
      model: str(row.Model),
      agentId: str(row.AgentId),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
    }));
  }

  async sumWindowBySpender(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostSpenderGroup[]> {
    const rows = await this.read(input, {
      query: `
        SELECT
          Provider                             AS Provider,
          RawActorId                           AS RawActorId,
          AgentId                              AS AgentId,
          sumOrNull(LatestAmountNanoUsd)       AS AmountNanoUsd,
          countIf(LatestAmountNanoUsd IS NULL) AS CellsWithoutAmount
        FROM (${latestPulledCells()}
        )
        GROUP BY Provider, RawActorId, AgentId
        ORDER BY Provider, RawActorId, AgentId`,
    });
    return rows.map((row) => ({
      provider: str(row.Provider),
      rawActorId: str(row.RawActorId),
      agentId: str(row.AgentId),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  async sumWindowByModel(input: GovernanceCostRollupWindow): Promise<GovernanceCostModelGroup[]> {
    const rows = await this.read(input, {
      query: `
        SELECT
          Model                                AS Model,
          sumOrNull(LatestAmountNanoUsd)       AS AmountNanoUsd,
          countIf(LatestAmountNanoUsd IS NULL) AS CellsWithoutAmount
        FROM (${latestPulledCells()}
        )
        GROUP BY Model
        ORDER BY Model`,
    });
    return rows.map((row) => ({
      model: str(row.Model),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  private async read(
    window: GovernanceCostRollupWindow,
    statement: { query: string; params?: Record<string, unknown> },
  ): Promise<Record<string, unknown>[]> {
    const client = await this.resolveClient(window.tenantId);
    const result = await client.query<Record<string, unknown>>({
      query: statement.query,
      query_params: { ...windowParams(window), ...statement.params },
      format: "JSONEachRow",
    });
    return result.json();
  }
}
