import { Temporal } from "@langwatch/time";

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
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

/** One cell at its surviving version: the ClickHouse twin's inner collapse, already applied. */
export interface MemoryGovernanceCostCell {
  tenantId: string;
  day: string;
  costSource: string;
  ingestionSourceId: string;
  provider: string;
  model: string;
  agentId: string;
  currencyCode: string;
  rawActorId: string;
  amountNanoUsd: number | null;
  amountNanoMinor: number;
  /** Unix seconds of the cell's latest revision. */
  revisedAt?: number | null;
  previousAmountNanoUsd?: number | null;
  /** Unix seconds a pull last touched the cell. */
  lastObservedAt?: number;
  /** Epoch ms of the cell's earliest version. */
  createdAt?: number;
}

const UNPRICED_CURRENCY_SAMPLE_LIMIT = 8;

function cellKey(cell: MemoryGovernanceCostCell): string {
  return [
    cell.tenantId,
    cell.day,
    cell.costSource,
    cell.ingestionSourceId,
    cell.provider,
    cell.model,
    cell.agentId,
    cell.currencyCode,
    cell.rawActorId,
  ].join("\u0000");
}

function holdsNoAmountAtAll(cell: MemoryGovernanceCostCell): boolean {
  return (
    cell.amountNanoUsd === null &&
    (cell.currencyCode === GOVERNANCE_COST_CURRENCY_USD ||
      cell.currencyCode === "" ||
      cell.amountNanoMinor === 0)
  );
}

/** `sumOrNull` beside a count of the cells the caller says carry no amount. */
function figureOf(
  cells: readonly MemoryGovernanceCostCell[],
  withoutAmount: (cell: MemoryGovernanceCostCell) => boolean,
): { amountNanoUsd: number | null; cellsWithoutAmount: number } {
  const priced = cells.flatMap((cell) => (cell.amountNanoUsd === null ? [] : [cell.amountNanoUsd]));
  return {
    amountNanoUsd: priced.length === 0 ? null : priced.reduce((sum, amount) => sum + amount, 0),
    cellsWithoutAmount: cells.filter(withoutAmount).length,
  };
}

const unpriced = (cell: MemoryGovernanceCostCell): boolean => cell.amountNanoUsd === null;

function currenciesWithoutUsd(cells: readonly MemoryGovernanceCostCell[]): string[] {
  const codes = cells
    .filter(
      (cell) => cell.amountNanoUsd === null && cell.currencyCode !== GOVERNANCE_COST_CURRENCY_USD,
    )
    .map((cell) => cell.currencyCode);
  return [...new Set(codes)].slice(0, UNPRICED_CURRENCY_SAMPLE_LIMIT).toSorted();
}

function groupBy(
  cells: readonly MemoryGovernanceCostCell[],
  keyOf: (cell: MemoryGovernanceCostCell) => string[],
): { key: string[]; cells: MemoryGovernanceCostCell[] }[] {
  const groups = new Map<string, { key: string[]; cells: MemoryGovernanceCostCell[] }>();
  for (const cell of cells) {
    const key = keyOf(cell);
    const id = key.join("\u0000");
    const group = groups.get(id) ?? { key, cells: [] };
    group.cells.push(cell);
    groups.set(id, group);
  }
  return [...groups.values()].toSorted((a, b) =>
    a.key.join("\u0000").localeCompare(b.key.join("\u0000")),
  );
}

function memoryCellOf(
  row: GovernanceCostRollupCellAddress &
    Partial<GovernanceCostRollupRow> &
    Pick<GovernanceCostRollupRow, "AmountNanoUsd" | "AmountNanoMinor">,
): MemoryGovernanceCostCell {
  return {
    tenantId: row.TenantId,
    day: row.Day,
    costSource: row.CostSource,
    ingestionSourceId: row.IngestionSourceId,
    provider: row.Provider,
    model: row.Model,
    agentId: row.AgentId,
    currencyCode: row.CurrencyCode,
    rawActorId: row.RawActorId,
    amountNanoUsd: row.AmountNanoUsd,
    amountNanoMinor: row.AmountNanoMinor,
    revisedAt: row.RevisedAt,
    previousAmountNanoUsd: row.PreviousAmountNanoUsd,
    lastObservedAt: row.LastObservedAt,
    createdAt: row.CreatedAt,
  };
}

function parsePulledItems(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" ? { ...parsed } : {};
  } catch {
    return {};
  }
}

const DAY_MS = 86_400_000;

const presentValues = (values: readonly (number | null | undefined)[]): number[] =>
  values.flatMap((value) => (value === null || value === undefined ? [] : [value]));

/** ClickHouse's `sumOrNull` as none-or-one: empty when every value is absent. */
function sumsOfPresent(values: readonly (number | null | undefined)[]): number[] {
  const present = presentValues(values);
  return present.length === 0 ? [] : [present.reduce((sum, value) => sum + value, 0)];
}

function maximaOfPresent(values: readonly (number | null | undefined)[]): number[] {
  const present = presentValues(values);
  return present.length === 0 ? [] : [Math.max(...present)];
}

/** The ClickHouse twin's third layer: what one cell contributed before its day's latest revision. */
function bucketed(cell: MemoryGovernanceCostCell, dayLatestRevisedAt: number | null) {
  const createdAt = cell.createdAt ?? 0;
  const dayStart = Temporal.Instant.from(`${cell.day}T00:00:00Z`).epochMilliseconds;
  const createdByRevision =
    createdAt >= dayStart &&
    createdAt < dayStart + DAY_MS &&
    dayLatestRevisedAt !== null &&
    createdAt >= dayLatestRevisedAt * 1000;
  const revisedLatest = (cell.revisedAt ?? null) !== null && cell.revisedAt === dayLatestRevisedAt;
  const noAmount = holdsNoAmountAtAll(cell);
  const previousUsd = cell.previousAmountNanoUsd ?? null;
  let priorUsd: number | null = cell.amountNanoUsd ?? 0;
  let priorMinor: number | null = cell.amountNanoMinor;
  if (createdByRevision) {
    priorUsd = 0;
    priorMinor = null;
  } else if (revisedLatest) {
    priorUsd = previousUsd;
    priorMinor = cell.currencyCode === GOVERNANCE_COST_CURRENCY_USD ? previousUsd : null;
  } else if (noAmount) {
    priorUsd = null;
  }
  return { cell, createdByRevision, noAmount, priorUsd, priorMinor };
}

function currencyLineOf(buckets: readonly ReturnType<typeof bucketed>[]) {
  const line: GovernanceCostDayCurrencyGroup = {
    currencyCode: buckets[0]?.cell.currencyCode ?? "",
    amountNanoMinor: buckets.reduce((sum, bucket) => sum + bucket.cell.amountNanoMinor, 0),
    previousAmountNanoMinor: sumsOfPresent(buckets.map((bucket) => bucket.priorMinor))[0] ?? null,
    cellsWithoutAmount: buckets.filter((bucket) => bucket.noAmount).length,
    cellsWithoutPreviousAmount: buckets.filter(
      (bucket) => bucket.priorMinor === null && !bucket.createdByRevision,
    ).length,
  };
  return {
    line,
    amountNanoUsd: sumsOfPresent(buckets.map((bucket) => bucket.cell.amountNanoUsd))[0] ?? null,
    cellsWithoutUsdFigure: buckets.filter((bucket) => bucket.cell.amountNanoUsd === null).length,
    priorUsd: sumsOfPresent(buckets.map((bucket) => bucket.priorUsd))[0] ?? null,
    cellsWithoutPreviousUsd: buckets.filter((bucket) => bucket.priorUsd === null).length,
  };
}

function dayLaneOf(day: string, costSource: string, cells: MemoryGovernanceCostCell[]) {
  const dayLatestRevisedAt = maximaOfPresent(cells.map((cell) => cell.revisedAt))[0] ?? null;
  const buckets = cells.map((cell) => bucketed(cell, dayLatestRevisedAt));
  const currencies = groupBy(cells, (cell) => [cell.currencyCode]).map(({ key }) =>
    currencyLineOf(buckets.filter((bucket) => bucket.cell.currencyCode === key[0])),
  );
  const group: GovernanceCostDayLaneGroup = {
    day,
    costSource,
    amountNanoUsd: sumsOfPresent(currencies.map((currency) => currency.amountNanoUsd))[0] ?? null,
    cellsWithoutAmount: currencies.reduce(
      (sum, currency) => sum + currency.line.cellsWithoutAmount,
      0,
    ),
    currenciesWithoutUsdAmount: currencies
      .filter(
        (c) => c.cellsWithoutUsdFigure > 0 && c.line.currencyCode !== GOVERNANCE_COST_CURRENCY_USD,
      )
      .map((c) => c.line.currencyCode)
      .slice(0, UNPRICED_CURRENCY_SAMPLE_LIMIT)
      .toSorted(),
    revisedAt: dayLatestRevisedAt,
    previousAmountNanoUsd:
      sumsOfPresent(currencies.map((currency) => currency.priorUsd))[0] ?? null,
    cellsWithoutPreviousAmount: currencies.reduce((sum, c) => sum + c.cellsWithoutPreviousUsd, 0),
    lastObservedAt: maximaOfPresent(cells.map((cell) => cell.lastObservedAt))[0] ?? 0,
    byCurrency: currencies.map((currency) => currency.line),
  };
  return group;
}

export class MemoryGovernanceCostRollupRepository extends GovernanceCostRollupRepository {
  private readonly cells = new Map<string, MemoryGovernanceCostCell>();
  private readonly rows = new Map<string, GovernanceCostRollupRow>();
  private readonly restatementIndex = new Map<string, Set<string>>();

  static create(): MemoryGovernanceCostRollupRepository {
    return new MemoryGovernanceCostRollupRepository();
  }

  /** The newest version of a cell replaces the one before it, as the table's collapse does. */
  seed(cell: MemoryGovernanceCostCell): void {
    this.cells.set(cellKey(cell), cell);
  }

  /** The newest write stands as the cell's surviving version, as the table's argMax collapse reads it. */
  async upsert(row: GovernanceCostRollupRow): Promise<void> {
    const cell = memoryCellOf(row);
    this.rows.set(cellKey(cell), { ...row });
    this.seed(cell);
    const recorded = this.restatementIndex.get(row.TenantId) ?? new Set<string>();
    for (const key of Object.keys(parsePulledItems(row.PulledItemsJson))) recorded.add(key);
    this.restatementIndex.set(row.TenantId, recorded);
  }

  async findCellRows(cell: GovernanceCostRollupCellAddress): Promise<GovernanceCostRollupRow[]> {
    const row = this.rows.get(
      cellKey(memoryCellOf({ ...cell, AmountNanoUsd: null, AmountNanoMinor: 0 })),
    );
    return row ? [{ ...row }] : [];
  }

  /** The restatement keys the index holds for a tenant, as main's index table records them. */
  findRestatementKeys({ tenantId }: { tenantId: string }): string[] {
    return [...(this.restatementIndex.get(tenantId) ?? [])].toSorted();
  }

  async sumDaysByProvider(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostProviderDayGroup[]> {
    return groupBy(this.pulled(input), (cell) => [cell.day, cell.provider]).map(
      ({ key, cells }) => ({
        day: key[0] ?? "",
        provider: key[1] ?? "",
        ...figureOf(cells, holdsNoAmountAtAll),
        currenciesWithoutUsdAmount: currenciesWithoutUsd(cells),
      }),
    );
  }

  async sumPeriodRecordsByProvider(
    input: GovernanceCostRollupWindow & { provider: string },
  ): Promise<GovernanceCostPeriodRecordGroup[]> {
    const cells = this.pulled(input).filter((cell) => cell.provider === input.provider);
    return groupBy(cells, (cell) => [cell.model, cell.agentId]).map(({ key, cells: group }) => ({
      model: key[0] ?? "",
      agentId: key[1] ?? "",
      ...figureOf(group, holdsNoAmountAtAll),
      currenciesWithoutUsdAmount: currenciesWithoutUsd(group),
    }));
  }

  async sumWindowBySpender(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostSpenderGroup[]> {
    const keyOf = (cell: MemoryGovernanceCostCell) => [
      cell.provider,
      cell.rawActorId,
      cell.agentId,
    ];
    return groupBy(this.pulled(input), keyOf).map(({ key, cells }) => ({
      provider: key[0] ?? "",
      rawActorId: key[1] ?? "",
      agentId: key[2] ?? "",
      ...figureOf(cells, unpriced),
    }));
  }

  async sumWindowByModel(input: GovernanceCostRollupWindow): Promise<GovernanceCostModelGroup[]> {
    return groupBy(this.pulled(input), (cell) => [cell.model]).map(({ key, cells }) => ({
      model: key[0] ?? "",
      ...figureOf(cells, unpriced),
    }));
  }

  async sumDaysByLane(
    input: GovernanceCostRollupWindow & { costSource?: string },
  ): Promise<GovernanceCostDayLaneGroup[]> {
    return groupBy(this.inWindow(input, input.costSource), (cell) => [
      cell.day,
      cell.costSource,
    ]).map(({ key, cells }) => dayLaneOf(key[0] ?? "", key[1] ?? "", cells));
  }

  async sumWindowByProvider(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostProviderGroup[]> {
    return groupBy(this.pulled(input), (cell) => [cell.provider]).map(({ key, cells }) => ({
      provider: key[0] ?? "",
      ...figureOf(cells, holdsNoAmountAtAll),
      currenciesWithoutUsdAmount: currenciesWithoutUsd(cells),
    }));
  }

  async sumWindowByCurrency(
    input: GovernanceCostRollupWindow & { costSource: string },
  ): Promise<GovernanceCostCurrencyGroup[]> {
    const cells = this.inWindow(input, input.costSource);
    return groupBy(cells, (cell) => [cell.currencyCode]).map(({ key, cells: group }) => ({
      currencyCode: key[0] ?? "",
      amountNanoMinor: sumsOfPresent(group.map((cell) => cell.amountNanoMinor))[0] ?? null,
      cellsWithoutAmount: group.filter(holdsNoAmountAtAll).length,
    }));
  }

  async hasRowsForSource(
    input: GovernanceCostRollupWindow & { costSource: string; ingestionSourceId: string },
  ): Promise<boolean> {
    return this.inWindow(input, input.costSource).some(
      (cell) => cell.ingestionSourceId === input.ingestionSourceId,
    );
  }

  private pulled(window: GovernanceCostRollupWindow): MemoryGovernanceCostCell[] {
    return this.inWindow(window, GOVERNANCE_COST_SOURCE.PULLED);
  }

  private inWindow(
    window: GovernanceCostRollupWindow,
    costSource: string | undefined,
  ): MemoryGovernanceCostCell[] {
    return [...this.cells.values()].filter(
      (cell) =>
        cell.tenantId === window.tenantId &&
        cell.day >= window.fromDay &&
        cell.day <= window.toDay &&
        (costSource === undefined || cell.costSource === costSource),
    );
  }
}
