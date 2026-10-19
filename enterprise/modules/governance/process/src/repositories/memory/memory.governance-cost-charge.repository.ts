// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  GovernanceCostChargeRepository,
  type GovernanceCostChargeRow,
} from "../governance-cost-charge.repository.ts";

/** Keyed by tenant and event id: a redelivered event replaces itself, as the table collapses it. */
export class MemoryGovernanceCostChargeRepository extends GovernanceCostChargeRepository {
  private readonly rows = new Map<string, GovernanceCostChargeRow>();

  private constructor() {
    super();
  }

  static create(): MemoryGovernanceCostChargeRepository {
    return new MemoryGovernanceCostChargeRepository();
  }

  async append(row: GovernanceCostChargeRow): Promise<void> {
    this.rows.set(`${row.TenantId}:${row.EventId}`, { ...row });
  }

  async bulkAppend(rows: GovernanceCostChargeRow[]): Promise<void> {
    for (const row of rows) await this.append(row);
  }

  async findChargesForDay(input: {
    tenantId: string;
    day: string;
    costSource: string;
  }): Promise<GovernanceCostChargeRow[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.TenantId === input.tenantId &&
          row.Day === input.day &&
          row.CostSource === input.costSource,
      )
      .map((row) => ({ ...row }));
  }

  async findLatestChargeOccurredAt(input: {
    tenantId: string;
    costSource: string;
  }): Promise<number | null> {
    const moments = [...this.rows.values()]
      .filter((row) => row.TenantId === input.tenantId && row.CostSource === input.costSource)
      .map((row) => row.EventOccurredAt);
    const latest = Math.max(0, ...moments);
    return latest > 0 ? latest : null;
  }
}
