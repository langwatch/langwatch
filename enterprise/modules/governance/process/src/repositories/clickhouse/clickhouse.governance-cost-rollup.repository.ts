// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `governanceCostRollup.clickhouse.repository.ts` reads. */
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GovernanceCostRollupRepository,
  type GovernanceCostModelGroup,
  type GovernanceCostRollupCellAddress,
  type GovernanceCostRollupRow,
  type GovernanceCostPeriodRecordGroup,
  type GovernanceCostProviderDayGroup,
  type GovernanceCostRollupWindow,
  type GovernanceCostSpenderGroup,
} from "../governance-cost-rollup.repository.ts";
import type { GovernanceClickHouseTenantResolver } from "../governance.repositories.ts";

const TABLE = "governance_cost_rollup_1d";
const RESTATEMENT_INDEX_TABLE = "governance_cost_rollup_restatement_index";
const SYNCHRONOUS_INSERT = { async_insert: 0, wait_for_async_insert: 0 };
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
    version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
    usd: GOVERNANCE_COST_CURRENCY_USD,
  };
}

const int = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => str(entry)) : [];

const CELL_PREDICATE = KEY_COLUMNS.map(
  (column) => `${column} = {${column.toLowerCase()}:String}`,
).join("\n          AND ");

const LATEST_PAYLOAD_COLUMNS = [
  "argMax(OrganizationId, EventTimestamp) AS OrganizationId",
  "argMax(ExactOrEstimate, EventTimestamp) AS ExactOrEstimate",
  "argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS AmountNanoUsd",
  "argMax(AmountNanoMinor, EventTimestamp) AS AmountNanoMinor",
  "argMax(TokensInput, EventTimestamp) AS TokensInput",
  "argMax(TokensOutput, EventTimestamp) AS TokensOutput",
  "argMax(TokensCacheRead, EventTimestamp) AS TokensCacheRead",
  "argMax(TokensCacheWrite, EventTimestamp) AS TokensCacheWrite",
  "argMax(RequestCount, EventTimestamp) AS RequestCount",
  "argMax(RevisionCount, EventTimestamp) AS RevisionCount",
  "argMax(tuple(PreviousAmountNanoUsd), EventTimestamp).1 AS PreviousAmountNanoUsd",
  "argMax(tuple(toUnixTimestamp(RevisedAt)), EventTimestamp).1 AS RevisedAt",
  "toUnixTimestamp(argMax(LastObservedAt, EventTimestamp)) AS LastObservedAt",
  "argMax(PulledItemsJson, EventTimestamp) AS PulledItemsJson",
  "argMax(Version, EventTimestamp) AS Version",
  "argMax(AppliedEventIds, EventTimestamp) AS AppliedEventIds",
  "argMax(CreatedAt, EventTimestamp) AS CreatedAt",
  "argMax(LastEventOccurredAt, EventTimestamp) AS LastEventOccurredAt",
  "max(EventTimestamp) AS LatestEventTimestamp",
] as const;

function restatementKeysOf(pulledItemsJson: string): string[] {
  if (!pulledItemsJson) return [];
  try {
    const parsed: unknown = JSON.parse(pulledItemsJson);
    return parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

function cellParams(cell: GovernanceCostRollupCellAddress): Record<string, unknown> {
  return Object.fromEntries(KEY_COLUMNS.map((column) => [column.toLowerCase(), cell[column]]));
}

function decodeRow(row: Record<string, unknown>): GovernanceCostRollupRow {
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
    OrganizationId: str(row.OrganizationId),
    ExactOrEstimate: str(row.ExactOrEstimate),
    AmountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
    AmountNanoMinor: int(row.AmountNanoMinor),
    TokensInput: int(row.TokensInput),
    TokensOutput: int(row.TokensOutput),
    TokensCacheRead: int(row.TokensCacheRead),
    TokensCacheWrite: int(row.TokensCacheWrite),
    RequestCount: int(row.RequestCount),
    RevisionCount: int(row.RevisionCount),
    PreviousAmountNanoUsd:
      row.PreviousAmountNanoUsd == null ? null : Number(row.PreviousAmountNanoUsd),
    RevisedAt: row.RevisedAt == null ? null : Number(row.RevisedAt),
    LastObservedAt: int(row.LastObservedAt),
    PulledItemsJson: str(row.PulledItemsJson),
    Version: str(row.Version),
    AppliedEventIds: strArray(row.AppliedEventIds),
    CreatedAt: int(row.CreatedAt),
    LastEventOccurredAt: int(row.LastEventOccurredAt),
    EventTimestamp: int(row.LatestEventTimestamp),
  };
}

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

  async upsert(row: GovernanceCostRollupRow): Promise<void> {
    const client = await this.resolveClient(row.TenantId);
    await client.insert({
      table: TABLE,
      values: [{ ...row }],
      format: "JSONEachRow",
      clickhouse_settings: SYNCHRONOUS_INSERT,
    });
    await this.recordRestatementKeys(row);
  }

  async findCellRows(cell: GovernanceCostRollupCellAddress): Promise<GovernanceCostRollupRow[]> {
    const client = await this.resolveClient(cell.TenantId);
    const result = await client.query<Record<string, unknown>>({
      query: `
        SELECT
          ${KEY_COLUMNS.join(",\n          ")},
          ${LATEST_PAYLOAD_COLUMNS.join(",\n          ")}
        FROM ${TABLE}
        WHERE ${CELL_PREDICATE}
        GROUP BY ${KEY_COLUMNS.join(", ")}
      `,
      query_params: cellParams(cell),
      format: "JSONEachRow",
    });
    return (await result.json()).map(decodeRow);
  }

  /** Main's index write: only keys the index has not recorded, keyed by tenant first. */
  private async recordRestatementKeys(row: GovernanceCostRollupRow): Promise<void> {
    const keys = restatementKeysOf(row.PulledItemsJson);
    if (keys.length === 0) return;
    const client = await this.resolveClient(row.TenantId);
    const result = await client.query<Record<string, unknown>>({
      query: `
        SELECT DISTINCT RestatementKey
        FROM ${RESTATEMENT_INDEX_TABLE}
        WHERE TenantId = {tenantid:String}
          AND RestatementKey IN {keys:Array(String)}
      `,
      query_params: { tenantid: row.TenantId, keys },
      format: "JSONEachRow",
    });
    const recorded = new Set((await result.json()).map((entry) => str(entry.RestatementKey)));
    const unrecorded = keys.filter((key) => !recorded.has(key));
    if (unrecorded.length === 0) return;
    await client.insert({
      table: RESTATEMENT_INDEX_TABLE,
      values: unrecorded.map((key) => ({
        TenantId: row.TenantId,
        RestatementKey: key,
        Day: row.Day,
        CostSource: row.CostSource,
        IngestionSourceId: row.IngestionSourceId,
        Provider: row.Provider,
        Model: row.Model,
        AgentId: row.AgentId,
        CurrencyCode: row.CurrencyCode,
        RawActorId: row.RawActorId,
        EventTimestamp: row.EventTimestamp,
      })),
      format: "JSONEachRow",
      clickhouse_settings: SYNCHRONOUS_INSERT,
    });
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
