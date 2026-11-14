// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `governanceCostRollup.clickhouse.repository.ts` reads, as built reads (ADR-202). */
import {
  clickhouseRead,
  column,
  type Condition,
  type ConditionOps,
  type Expression,
  type ReaderReadStatement,
  type SingleTenantScope,
  fn,
  param,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";

import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
} from "../../features/cost/rules/governance-cost-rollup-cell.rules.ts";
import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GovernanceCostRollupRepository,
  type GovernanceCostCurrencyGroup,
  type GovernanceCostDayCurrencyGroup,
  type GovernanceCostDayLaneGroup,
  type GovernanceCostModelGroup,
  type GovernanceCostProviderGroup,
  type GovernanceCostRollupCellAddress,
  type GovernanceCostRollupRow,
  type GovernanceCostPeriodRecordGroup,
  type GovernanceCostProviderDayGroup,
  type GovernanceCostRollupWindow,
  type GovernanceCostSpenderGroup,
} from "../governance-cost-rollup.repository.ts";
import type { GovernanceClickHouseReadResolver } from "../governance.repositories.ts";
import { governanceCostRollup1d as rollup } from "./clickhouse.governance-cost-rollup-1d.table.ts";
import { governanceCostRollupRestatementIndex as restatements } from "./clickhouse.governance-cost-rollup-restatement-index.table.ts";

const TABLE = rollup.$table.name;
const RESTATEMENT_INDEX_TABLE = restatements.$table.name;
const SYNCHRONOUS_INSERT = { async_insert: 0, wait_for_async_insert: 0 };
const UNPRICED_CURRENCIES = { max: 8 };
const NULL_INT64 = column.nullable(column.int64());

type Ops<T extends string> = ConditionOps<T, Record<never, never>>;
type Rows = Record<string, unknown>[];

/** The cell key, tenant and partition key first, every column as itself. */
const CELL_KEY = {
  TenantId: rollup.TenantId,
  Day: rollup.Day,
  CostSource: rollup.CostSource,
  IngestionSourceId: rollup.IngestionSourceId,
  Provider: rollup.Provider,
  Model: rollup.Model,
  AgentId: rollup.AgentId,
  CurrencyCode: rollup.CurrencyCode,
  RawActorId: rollup.RawActorId,
} as const;
const CELL_KEY_COLUMNS = Object.values(CELL_KEY);

/** `argMax(tuple(x), EventTimestamp).1`: the tuple keeps a NULL latest value from losing to a set one. */
const latestNullable = <V>(of: Expression<V | null, typeof ROLLUP>) =>
  fn.tupleElement(fn.argMax(fn.tuple(of), rollup.EventTimestamp), "0");
const latest = <V>(of: Expression<V, typeof ROLLUP>) => fn.argMax(of, rollup.EventTimestamp);
const ROLLUP = "governance_cost_rollup_1d";

type CellAmounts<T extends string> = {
  readonly LatestAmountNanoUsd: Expression<number | null, T>;
  readonly LatestAmountNanoMinor: Expression<number, T>;
  readonly CurrencyCode: Expression<string, T>;
};

/** No USD figure, and no non-zero amount in another currency either (main's `OR` chain, by De Morgan). */
function holdsNoAmountInAnyCurrency<T extends string>({
  ops: { and, isNull, ne, not, oneOf },
  cells,
}: {
  ops: Ops<T>;
  cells: CellAmounts<T>;
}): Condition<T> {
  return and(
    isNull(cells.LatestAmountNanoUsd),
    not(
      and(
        not(oneOf(cells.CurrencyCode, [GOVERNANCE_COST_CURRENCY_USD, ""])),
        ne(cells.LatestAmountNanoMinor, 0),
      ),
    ),
  );
}

function currenciesWithoutUsd<T extends string>({
  ops: { and, isNull, ne },
  cells,
}: {
  ops: Ops<T>;
  cells: CellAmounts<T>;
}) {
  return fn.arraySort(
    fn.groupUniqArrayIf(
      cells.CurrencyCode,
      and(isNull(cells.LatestAmountNanoUsd), ne(cells.CurrencyCode, GOVERNANCE_COST_CURRENCY_USD)),
      UNPRICED_CURRENCIES,
    ),
  );
}

const scopeOf = (tenantId: string) => tenantScope.single({ tenantId });

/** Every cell of the window collapsed to its surviving version, at the current shape. */
function latestPulledCells({
  scope,
  window,
  costSource = GOVERNANCE_COST_SOURCE.PULLED,
  provider,
}: {
  scope: SingleTenantScope;
  window: GovernanceCostRollupWindow;
  costSource?: string;
  provider?: string;
}) {
  return clickhouseRead({ scope })
    .from(rollup)
    .select({
      ...CELL_KEY,
      LatestAmountNanoUsd: latestNullable(rollup.AmountNanoUsd),
      LatestAmountNanoMinor: latest(rollup.AmountNanoMinor),
    })
    .where(({ and, eq, gte, lte }) =>
      and(
        gte(rollup.Day, window.fromDay),
        lte(rollup.Day, window.toDay),
        ...(provider === undefined ? [] : [eq(rollup.Provider, provider)]),
        eq(rollup.CostSource, costSource),
        eq(rollup.Version, GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST),
      ),
    )
    .groupBy(...CELL_KEY_COLUMNS)
    .as("cells");
}

const int = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => str(entry)) : [];

function currencyLines(value: unknown): GovernanceCostDayCurrencyGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line: unknown) => {
    if (!Array.isArray(line)) return [];
    const [code, amount, previous, withoutAmount, withoutPrevious]: unknown[] = line;
    return [
      {
        currencyCode: str(code),
        amountNanoMinor: int(amount),
        previousAmountNanoMinor: previous == null ? null : Number(previous),
        cellsWithoutAmount: int(withoutAmount),
        cellsWithoutPreviousAmount: int(withoutPrevious),
      },
    ];
  });
}

function restatementKeysOf(pulledItemsJson: string): string[] {
  if (!pulledItemsJson) return [];
  try {
    const parsed: unknown = JSON.parse(pulledItemsJson);
    return parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

/** A cell's surviving version. Keys carry `Latest`: an alias may not shadow a column it reads. */
const LATEST_PAYLOAD = {
  LatestOrganizationId: latest(rollup.OrganizationId),
  LatestExactOrEstimate: latest(rollup.ExactOrEstimate),
  LatestAmountNanoUsd: latestNullable(rollup.AmountNanoUsd),
  LatestAmountNanoMinor: latest(rollup.AmountNanoMinor),
  LatestTokensInput: latest(rollup.TokensInput),
  LatestTokensOutput: latest(rollup.TokensOutput),
  LatestTokensCacheRead: latest(rollup.TokensCacheRead),
  LatestTokensCacheWrite: latest(rollup.TokensCacheWrite),
  LatestRequestCount: latest(rollup.RequestCount),
  LatestRevisionCount: latest(rollup.RevisionCount),
  LatestPreviousAmountNanoUsd: latestNullable(rollup.PreviousAmountNanoUsd),
  LatestRevisedAt: latestNullable(fn.toUnixTimestamp(rollup.RevisedAt)),
  LatestLastObservedAt: fn.toUnixTimestamp(latest(rollup.LastObservedAt)),
  LatestPulledItemsJson: latest(rollup.PulledItemsJson),
  LatestVersion: latest(rollup.Version),
  LatestAppliedEventIds: latest(rollup.AppliedEventIds),
  LatestCreatedAt: latest(rollup.CreatedAt),
  LatestLastEventOccurredAt: latest(rollup.LastEventOccurredAt),
  LatestEventTimestamp: fn.max(rollup.EventTimestamp),
};

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
    OrganizationId: str(row.LatestOrganizationId),
    ExactOrEstimate: str(row.LatestExactOrEstimate),
    AmountNanoUsd: row.LatestAmountNanoUsd == null ? null : Number(row.LatestAmountNanoUsd),
    AmountNanoMinor: int(row.LatestAmountNanoMinor),
    TokensInput: int(row.LatestTokensInput),
    TokensOutput: int(row.LatestTokensOutput),
    TokensCacheRead: int(row.LatestTokensCacheRead),
    TokensCacheWrite: int(row.LatestTokensCacheWrite),
    RequestCount: int(row.LatestRequestCount),
    RevisionCount: int(row.LatestRevisionCount),
    PreviousAmountNanoUsd:
      row.LatestPreviousAmountNanoUsd == null ? null : Number(row.LatestPreviousAmountNanoUsd),
    RevisedAt: row.LatestRevisedAt == null ? null : Number(row.LatestRevisedAt),
    LastObservedAt: int(row.LatestLastObservedAt),
    PulledItemsJson: str(row.LatestPulledItemsJson),
    Version: str(row.LatestVersion),
    AppliedEventIds: strArray(row.LatestAppliedEventIds),
    CreatedAt: int(row.LatestCreatedAt),
    LastEventOccurredAt: int(row.LatestLastEventOccurredAt),
    EventTimestamp: int(row.LatestEventTimestamp),
  };
}

/** Main's day read, layer by layer: collapse each cell, carry the day's latest revision, bucket. */
function daysByLaneRead(input: GovernanceCostRollupWindow & { costSource?: string }) {
  const scope = scopeOf(input.tenantId);
  const cells = clickhouseRead({ scope })
    .from(rollup)
    .select({
      ...CELL_KEY,
      LatestAmountNanoUsd: latestNullable(rollup.AmountNanoUsd),
      LatestAmountNanoMinor: latest(rollup.AmountNanoMinor),
      LatestPreviousAmountNanoUsd: latestNullable(rollup.PreviousAmountNanoUsd),
      LatestRevisedAt: latestNullable(fn.toUnixTimestamp(rollup.RevisedAt)),
      LatestLastObservedAt: fn.toUnixTimestamp(latest(rollup.LastObservedAt)),
      CellCreatedAt: fn.min(rollup.CreatedAt),
    })
    .where(({ and, eq, gte, lte }) =>
      and(
        gte(rollup.Day, input.fromDay),
        lte(rollup.Day, input.toDay),
        eq(rollup.Version, GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST),
        ...(input.costSource ? [eq(rollup.CostSource, input.costSource)] : []),
      ),
    )
    .groupBy(...CELL_KEY_COLUMNS)
    .as("cells");
  const dayed = clickhouseRead({ scope })
    .from(cells)
    .select({
      Day: cells.Day,
      CostSource: cells.CostSource,
      CurrencyCode: cells.CurrencyCode,
      LatestAmountNanoUsd: cells.LatestAmountNanoUsd,
      LatestAmountNanoMinor: cells.LatestAmountNanoMinor,
      LatestPreviousAmountNanoUsd: cells.LatestPreviousAmountNanoUsd,
      LatestRevisedAt: cells.LatestRevisedAt,
      LatestLastObservedAt: cells.LatestLastObservedAt,
      CellCreatedAt: cells.CellCreatedAt,
      DayLatestRevisedAt: fn.over(fn.max(cells.LatestRevisedAt), {
        partitionBy: [cells.Day, cells.CostSource],
      }),
    })
    .as("dayed");
  const bucketed = clickhouseRead({ scope })
    .from(dayed)
    .select((ops) => {
      const { and, eq, gte, isNotNull, lt } = ops;
      const holdsNoAmountAtAll = holdsNoAmountInAnyCurrency({ ops, cells: dayed });
      const dayStartSeconds = fn.toUnixTimestamp(fn.cast(dayed.Day, column.dateTime()));
      // `ifNull(a, 0)` of main's comparisons: a NULL revision time compares false.
      const createdByRevision = and(
        gte(dayed.CellCreatedAt, fn.multiply(dayStartSeconds, 1000)),
        lt(dayed.CellCreatedAt, fn.multiply(fn.plus(dayStartSeconds, 86400), 1000)),
        isNotNull(dayed.DayLatestRevisedAt),
        gte(dayed.CellCreatedAt, fn.multiply(dayed.DayLatestRevisedAt, 1000)),
      );
      const revisedWithTheDay = and(
        isNotNull(dayed.LatestRevisedAt),
        eq(dayed.LatestRevisedAt, dayed.DayLatestRevisedAt),
      );
      const zero = fn.toInt64(param.int64(0));
      return {
        Day: dayed.Day,
        CostSource: dayed.CostSource,
        CurrencyCode: dayed.CurrencyCode,
        LatestAmountNanoUsd: dayed.LatestAmountNanoUsd,
        LatestAmountNanoMinor: dayed.LatestAmountNanoMinor,
        LatestRevisedAt: dayed.LatestRevisedAt,
        LatestLastObservedAt: dayed.LatestLastObservedAt,
        HoldsNoAmountAtAll: holdsNoAmountAtAll,
        CreatedByRevision: createdByRevision,
        PriorAmountNanoUsd: fn.if(
          createdByRevision,
          fn.toNullable(zero),
          fn.if(
            revisedWithTheDay,
            dayed.LatestPreviousAmountNanoUsd,
            fn.if(
              holdsNoAmountAtAll,
              fn.nullAs(NULL_INT64),
              fn.ifNull(dayed.LatestAmountNanoUsd, zero),
            ),
          ),
        ),
        PriorAmountNanoMinor: fn.if(
          createdByRevision,
          fn.nullAs(NULL_INT64),
          fn.if(
            revisedWithTheDay,
            fn.if(
              eq(dayed.CurrencyCode, GOVERNANCE_COST_CURRENCY_USD),
              dayed.LatestPreviousAmountNanoUsd,
              fn.nullAs(NULL_INT64),
            ),
            fn.toNullable(dayed.LatestAmountNanoMinor),
          ),
        ),
      };
    })
    .as("bucketed");
  const currencies = clickhouseRead({ scope })
    .from(bucketed)
    .select(({ and, isNull, not }) => ({
      Day: bucketed.Day,
      CostSource: bucketed.CostSource,
      CurrencyCode: bucketed.CurrencyCode,
      CurrencyAmountNanoUsd: fn.sumOrNull(bucketed.LatestAmountNanoUsd),
      CurrencyAmountNanoMinor: fn.sum(bucketed.LatestAmountNanoMinor),
      CurrencyCellsWithoutAmount: fn.countIf(bucketed.HoldsNoAmountAtAll),
      CurrencyCellsWithoutUsdFigure: fn.countIf(isNull(bucketed.LatestAmountNanoUsd)),
      RevisedAt: fn.max(bucketed.LatestRevisedAt),
      CurrencyPriorAmountNanoUsd: fn.sumOrNull(bucketed.PriorAmountNanoUsd),
      CellsWithoutPreviousAmount: fn.countIf(isNull(bucketed.PriorAmountNanoUsd)),
      CurrencyPriorAmountNanoMinor: fn.sumOrNull(bucketed.PriorAmountNanoMinor),
      CurrencyCellsWithoutPreviousMinor: fn.countIf(
        and(isNull(bucketed.PriorAmountNanoMinor), not(bucketed.CreatedByRevision)),
      ),
      LastObservedAt: fn.max(bucketed.LatestLastObservedAt),
    }))
    .groupBy(bucketed.Day, bucketed.CostSource, bucketed.CurrencyCode)
    .as("currencies");
  return clickhouseRead({ scope })
    .from(currencies)
    .select(({ and, gt, ne }) => ({
      Day: currencies.Day,
      CostSource: currencies.CostSource,
      AmountNanoUsd: fn.sumOrNull(currencies.CurrencyAmountNanoUsd),
      CellsWithoutAmount: fn.sum(currencies.CurrencyCellsWithoutAmount),
      CurrenciesWithoutUsdAmount: fn.arraySort(
        fn.groupUniqArrayIf(
          currencies.CurrencyCode,
          and(
            gt(currencies.CurrencyCellsWithoutUsdFigure, 0),
            ne(currencies.CurrencyCode, GOVERNANCE_COST_CURRENCY_USD),
          ),
          UNPRICED_CURRENCIES,
        ),
      ),
      RevisedAt: fn.max(currencies.RevisedAt),
      PreviousAmountNanoUsd: fn.sumOrNull(currencies.CurrencyPriorAmountNanoUsd),
      CellsWithoutPreviousAmount: fn.sum(currencies.CellsWithoutPreviousAmount),
      LastObservedAt: fn.max(currencies.LastObservedAt),
      ByCurrency: fn.groupArray(
        fn.tuple(
          currencies.CurrencyCode,
          currencies.CurrencyAmountNanoMinor,
          currencies.CurrencyPriorAmountNanoMinor,
          currencies.CurrencyCellsWithoutAmount,
          currencies.CurrencyCellsWithoutPreviousMinor,
        ),
      ),
    }))
    .groupBy(currencies.Day, currencies.CostSource)
    .orderBy(currencies.Day)
    .orderBy(currencies.CostSource)
    .build();
}

export class ClickHouseGovernanceCostRollupRepository extends GovernanceCostRollupRepository {
  private constructor(private readonly resolveClient: GovernanceClickHouseReadResolver) {
    super();
  }

  static create(
    resolveClient: GovernanceClickHouseReadResolver,
  ): ClickHouseGovernanceCostRollupRepository {
    return new ClickHouseGovernanceCostRollupRepository(resolveClient);
  }

  async sumDaysByProvider(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostProviderDayGroup[]> {
    const scope = scopeOf(input.tenantId);
    const cells = latestPulledCells({ scope, window: input });
    const statement = clickhouseRead({ scope })
      .from(cells)
      .select((ops) => ({
        Day: cells.Day,
        Provider: cells.Provider,
        AmountNanoUsd: fn.sumOrNull(cells.LatestAmountNanoUsd),
        CellsWithoutAmount: fn.countIf(holdsNoAmountInAnyCurrency({ ops, cells })),
        CurrenciesWithoutUsdAmount: currenciesWithoutUsd({ ops, cells }),
      }))
      .groupBy(cells.Day, cells.Provider)
      .orderBy(cells.Day)
      .orderBy(cells.Provider)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
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
    const scope = scopeOf(input.tenantId);
    const cells = latestPulledCells({ scope, window: input, provider: input.provider });
    const statement = clickhouseRead({ scope })
      .from(cells)
      .select((ops) => ({
        Model: cells.Model,
        AgentId: cells.AgentId,
        AmountNanoUsd: fn.sumOrNull(cells.LatestAmountNanoUsd),
        CellsWithoutAmount: fn.countIf(holdsNoAmountInAnyCurrency({ ops, cells })),
        CurrenciesWithoutUsdAmount: currenciesWithoutUsd({ ops, cells }),
      }))
      .groupBy(cells.Model, cells.AgentId)
      .orderBy(cells.Model)
      .orderBy(cells.AgentId)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
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
    const scope = scopeOf(input.tenantId);
    const cells = latestPulledCells({ scope, window: input });
    const statement = clickhouseRead({ scope })
      .from(cells)
      .select(({ isNull }) => ({
        Provider: cells.Provider,
        RawActorId: cells.RawActorId,
        AgentId: cells.AgentId,
        AmountNanoUsd: fn.sumOrNull(cells.LatestAmountNanoUsd),
        CellsWithoutAmount: fn.countIf(isNull(cells.LatestAmountNanoUsd)),
      }))
      .groupBy(cells.Provider, cells.RawActorId, cells.AgentId)
      .orderBy(cells.Provider)
      .orderBy(cells.RawActorId)
      .orderBy(cells.AgentId)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
    return rows.map((row) => ({
      provider: str(row.Provider),
      rawActorId: str(row.RawActorId),
      agentId: str(row.AgentId),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  async sumWindowByModel(input: GovernanceCostRollupWindow): Promise<GovernanceCostModelGroup[]> {
    const scope = scopeOf(input.tenantId);
    const cells = latestPulledCells({ scope, window: input });
    const statement = clickhouseRead({ scope })
      .from(cells)
      .select(({ isNull }) => ({
        Model: cells.Model,
        AmountNanoUsd: fn.sumOrNull(cells.LatestAmountNanoUsd),
        CellsWithoutAmount: fn.countIf(isNull(cells.LatestAmountNanoUsd)),
      }))
      .groupBy(cells.Model)
      .orderBy(cells.Model)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
    return rows.map((row) => ({
      model: str(row.Model),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  async sumDaysByLane(
    input: GovernanceCostRollupWindow & { costSource?: string },
  ): Promise<GovernanceCostDayLaneGroup[]> {
    const rows = await this.rowsOf(input.tenantId, daysByLaneRead(input));
    return rows.map((row) => ({
      day: str(row.Day),
      costSource: str(row.CostSource),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
      revisedAt: row.RevisedAt == null ? null : Number(row.RevisedAt),
      previousAmountNanoUsd:
        row.PreviousAmountNanoUsd == null ? null : Number(row.PreviousAmountNanoUsd),
      cellsWithoutPreviousAmount: int(row.CellsWithoutPreviousAmount),
      lastObservedAt: int(row.LastObservedAt),
      byCurrency: currencyLines(row.ByCurrency),
    }));
  }

  async sumWindowByProvider(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostProviderGroup[]> {
    const scope = scopeOf(input.tenantId);
    const cells = latestPulledCells({ scope, window: input });
    const statement = clickhouseRead({ scope })
      .from(cells)
      .select((ops) => ({
        Provider: cells.Provider,
        AmountNanoUsd: fn.sumOrNull(cells.LatestAmountNanoUsd),
        CellsWithoutAmount: fn.countIf(holdsNoAmountInAnyCurrency({ ops, cells })),
        CurrenciesWithoutUsdAmount: currenciesWithoutUsd({ ops, cells }),
      }))
      .groupBy(cells.Provider)
      .orderBy(cells.Provider)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
    return rows.map((row) => ({
      provider: str(row.Provider),
      amountNanoUsd: row.AmountNanoUsd == null ? null : Number(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
    }));
  }

  async sumWindowByCurrency(
    input: GovernanceCostRollupWindow & { costSource: string },
  ): Promise<GovernanceCostCurrencyGroup[]> {
    const scope = scopeOf(input.tenantId);
    const cells = latestPulledCells({ scope, window: input, costSource: input.costSource });
    const statement = clickhouseRead({ scope })
      .from(cells)
      .select((ops) => ({
        CurrencyCode: cells.CurrencyCode,
        AmountNanoMinor: fn.sumOrNull(cells.LatestAmountNanoMinor),
        CellsWithoutAmount: fn.countIf(holdsNoAmountInAnyCurrency({ ops, cells })),
      }))
      .groupBy(cells.CurrencyCode)
      .orderBy(cells.CurrencyCode)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
    return rows.map((row) => ({
      currencyCode: str(row.CurrencyCode),
      amountNanoMinor: row.AmountNanoMinor == null ? null : Number(row.AmountNanoMinor),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  /** Existence needs no dedup pass: any current-version row proves the cell exists. */
  async hasRowsForSource(
    input: GovernanceCostRollupWindow & { costSource: string; ingestionSourceId: string },
  ): Promise<boolean> {
    const statement = clickhouseRead({ scope: scopeOf(input.tenantId) })
      .from(rollup)
      .select({ TenantId: rollup.TenantId })
      .where(({ and, eq, gte, lte }) =>
        and(
          gte(rollup.Day, input.fromDay),
          lte(rollup.Day, input.toDay),
          eq(rollup.CostSource, input.costSource),
          eq(rollup.IngestionSourceId, input.ingestionSourceId),
          eq(rollup.Version, GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST),
        ),
      )
      .limit(1)
      .build();
    const rows = await this.rowsOf(input.tenantId, statement);
    return rows.length > 0;
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
    const statement = clickhouseRead({ scope: scopeOf(cell.TenantId) })
      .from(rollup)
      .select({ ...CELL_KEY, ...LATEST_PAYLOAD })
      .where(({ and, eq }) =>
        and(
          eq(rollup.Day, cell.Day),
          eq(rollup.CostSource, cell.CostSource),
          eq(rollup.IngestionSourceId, cell.IngestionSourceId),
          eq(rollup.Provider, cell.Provider),
          eq(rollup.Model, cell.Model),
          eq(rollup.AgentId, cell.AgentId),
          eq(rollup.CurrencyCode, cell.CurrencyCode),
          eq(rollup.RawActorId, cell.RawActorId),
        ),
      )
      .groupBy(...CELL_KEY_COLUMNS)
      .build();
    return (await this.rowsOf(cell.TenantId, statement)).map(decodeRow);
  }

  async findCellsForDay(input: {
    tenantId: string;
    day: string;
    costSource: string;
  }): Promise<GovernanceCostRollupRow[]> {
    const statement = clickhouseRead({ scope: scopeOf(input.tenantId) })
      .from(rollup)
      .select({ ...CELL_KEY, ...LATEST_PAYLOAD })
      .where(({ and, eq }) =>
        and(eq(rollup.Day, input.day), eq(rollup.CostSource, input.costSource)),
      )
      .groupBy(...CELL_KEY_COLUMNS)
      .orderBy(rollup.CostSource)
      .orderBy(rollup.Provider)
      .orderBy(rollup.Model)
      .orderBy(rollup.RawActorId)
      .orderBy(rollup.CurrencyCode)
      .build();
    return (await this.rowsOf(input.tenantId, statement)).map(decodeRow);
  }

  async findLatestSummarizedOccurredAt(input: {
    tenantId: string;
    costSource: string;
  }): Promise<number | null> {
    const statement = clickhouseRead({ scope: scopeOf(input.tenantId) })
      .from(rollup)
      .select({ LatestOccurredAt: fn.max(rollup.LastEventOccurredAt) })
      .where(({ eq }) => eq(rollup.CostSource, input.costSource))
      .build();
    const latestOccurredAt = int(
      (await this.rowsOf(input.tenantId, statement))[0]?.LatestOccurredAt,
    );
    return latestOccurredAt > 0 ? latestOccurredAt : null;
  }

  /** Main's index write: only keys the index has not recorded, keyed by tenant first. */
  private async recordRestatementKeys(row: GovernanceCostRollupRow): Promise<void> {
    const keys = restatementKeysOf(row.PulledItemsJson);
    if (keys.length === 0) return;
    const statement = clickhouseRead({ scope: scopeOf(row.TenantId) })
      .from(restatements)
      .distinct()
      .select({ RestatementKey: restatements.RestatementKey })
      .where(({ oneOf }) => oneOf(restatements.RestatementKey, keys))
      .build();
    const recorded = new Set(
      (await this.rowsOf(row.TenantId, statement)).map((entry) => str(entry.RestatementKey)),
    );
    const unrecorded = keys.filter((key) => !recorded.has(key));
    if (unrecorded.length === 0) return;
    const client = await this.resolveClient(row.TenantId);
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

  private async rowsOf(
    tenantId: string,
    statement: ReaderReadStatement<Record<string, unknown>>,
  ): Promise<Rows> {
    const client = await this.resolveClient(tenantId);
    const { rows } = await client.read({ statement });
    return rows;
  }
}
