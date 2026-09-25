// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
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

export class MemoryGovernanceCostRollupRepository extends GovernanceCostRollupRepository {
  private readonly cells = new Map<string, MemoryGovernanceCostCell>();

  static create(): MemoryGovernanceCostRollupRepository {
    return new MemoryGovernanceCostRollupRepository();
  }

  /** The newest version of a cell replaces the one before it, as the table's collapse does. */
  seed(cell: MemoryGovernanceCostCell): void {
    this.cells.set(cellKey(cell), cell);
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
