// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
  GovernanceCostRollupRepository,
  type GovernanceCostModelGroup,
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

  private pulled(window: GovernanceCostRollupWindow): MemoryGovernanceCostCell[] {
    return [...this.cells.values()].filter(
      (cell) =>
        cell.tenantId === window.tenantId &&
        cell.day >= window.fromDay &&
        cell.day <= window.toDay &&
        cell.costSource === GOVERNANCE_COST_SOURCE.PULLED,
    );
  }
}
