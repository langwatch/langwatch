// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageWindow,
} from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";

import type {
  IngestionPrincipalSummaryRow,
  PersonalUsageReader,
  PersonalUsageSummaryRow,
  PersonalUsageTopModelRow,
} from "../../app/governance.members.ts";

/** One trace's contribution to `trace_summaries`, as a test seeds it. */
export type MemoryTraceUsageRow = {
  tenantId: string;
  occurredAtMs: number;
  totalCost: number;
  nonBilledCost: number;
  promptTokens: number;
  completionTokens: number;
  models: string[];
};

/** One collapsed gateway request's principal-scope ledger contribution. */
export type MemoryPrincipalLedgerRow = {
  tenantId: string;
  userId: string;
  occurredAtMs: number;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  model: string;
};

function inWindow(occurredAtMs: number, window: PersonalUsageWindow): boolean {
  return occurredAtMs >= window.startMs && occurredAtMs < window.endMs;
}

function dayOf(occurredAtMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(occurredAtMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
}

/**
 * The personal-usage twin: two seeded logs (trace usage, principal ledger),
 * matching the live repository's two data sources. `record*` are the test
 * seam; the seven `PersonalUsageReader` methods answer honestly from what
 * was seeded, inventing nothing.
 */
export class MemoryPersonalUsageRepository implements PersonalUsageReader {
  private readonly traceRows: MemoryTraceUsageRow[] = [];
  private readonly principalRows: MemoryPrincipalLedgerRow[] = [];

  static create(): MemoryPersonalUsageRepository {
    return new MemoryPersonalUsageRepository();
  }

  recordTraceUsage(row: MemoryTraceUsageRow): void {
    this.traceRows.push(row);
  }

  recordPrincipalLedger(row: MemoryPrincipalLedgerRow): void {
    this.principalRows.push(row);
  }

  async findSummary(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageSummaryRow> {
    const rows = this.traceRowsFor(input.tenantId, input.window);
    return {
      totalCost: rows.reduce((sum, row) => sum + row.totalCost, 0),
      billedCost: rows.reduce((sum, row) => sum + (row.totalCost - row.nonBilledCost), 0),
      requestCount: rows.length,
      promptTokens: rows.reduce((sum, row) => sum + row.promptTokens, 0),
      completionTokens: rows.reduce((sum, row) => sum + row.completionTokens, 0),
    };
  }

  async findTopModels(input: {
    tenantId: string;
    window: PersonalUsageWindow;
    limit: number;
  }): Promise<PersonalUsageTopModelRow[]> {
    const counts = this.modelCounts(this.traceRowsFor(input.tenantId, input.window));
    return [...counts.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, input.limit)
      .map(([model, requests]) => ({ model, requests }));
  }

  async findDailyBuckets(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]> {
    const byDay = new Map<string, { spentUsd: number; billedUsd: number; requests: number }>();
    for (const row of this.traceRowsFor(input.tenantId, input.window)) {
      const day = dayOf(row.occurredAtMs);
      const bucket = byDay.get(day) ?? { spentUsd: 0, billedUsd: 0, requests: 0 };
      bucket.spentUsd += row.totalCost;
      bucket.billedUsd += row.totalCost - row.nonBilledCost;
      bucket.requests += 1;
      byDay.set(day, bucket);
    }
    return [...byDay.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([day, bucket]) => ({ day, ...bucket }));
  }

  async findModelBreakdown(input: {
    tenantId: string;
    window: PersonalUsageWindow;
    limit: number;
  }): Promise<PersonalUsageBreakdown[]> {
    const byModel = new Map<string, { spentUsd: number; billedUsd: number; requests: number }>();
    for (const row of this.traceRowsFor(input.tenantId, input.window)) {
      for (const model of row.models) {
        const entry = byModel.get(model) ?? { spentUsd: 0, billedUsd: 0, requests: 0 };
        entry.spentUsd += row.totalCost;
        entry.billedUsd += row.totalCost - row.nonBilledCost;
        entry.requests += 1;
        byModel.set(model, entry);
      }
    }
    return [...byModel.entries()]
      .toSorted(([, a], [, b]) => b.spentUsd - a.spentUsd)
      .slice(0, input.limit)
      .map(([label, entry]) => ({ label, ...entry }));
  }

  async getIngestionPrincipalSummary(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<IngestionPrincipalSummaryRow> {
    const rows = this.principalRowsFor(input.tenantId, input.userId, input.window);
    if (rows.length === 0) {
      return {
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        topModel: null,
      };
    }
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.model, (counts.get(row.model) ?? 0) + 1);
    const top = [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0];
    return {
      totalCost: rows.reduce((sum, row) => sum + row.amountNanoUsd / 1_000_000_000, 0),
      requestCount: rows.length,
      promptTokens: rows.reduce((sum, row) => sum + row.tokensInput, 0),
      completionTokens: rows.reduce((sum, row) => sum + row.tokensOutput, 0),
      topModel: top ? { name: top[0], requests: top[1] } : null,
    };
  }

  async findIngestionPrincipalBuckets(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]> {
    const byDay = new Map<string, { spentUsd: number; requests: number }>();
    for (const row of this.principalRowsFor(input.tenantId, input.userId, input.window)) {
      const day = dayOf(row.occurredAtMs);
      const bucket = byDay.get(day) ?? { spentUsd: 0, requests: 0 };
      bucket.spentUsd += row.amountNanoUsd / 1_000_000_000;
      bucket.requests += 1;
      byDay.set(day, bucket);
    }
    return (
      [...byDay.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        // Gateway-ledger spend is real per-token spend: fully billed.
        .map(([day, bucket]) => ({
          day,
          spentUsd: bucket.spentUsd,
          billedUsd: bucket.spentUsd,
          requests: bucket.requests,
        }))
    );
  }

  async findIngestionPrincipalBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBreakdown[]> {
    const byModel = new Map<string, { spentUsd: number; requests: number }>();
    for (const row of this.principalRowsFor(input.tenantId, input.userId, input.window)) {
      const entry = byModel.get(row.model) ?? { spentUsd: 0, requests: 0 };
      entry.spentUsd += row.amountNanoUsd / 1_000_000_000;
      entry.requests += 1;
      byModel.set(row.model, entry);
    }
    return [...byModel.entries()]
      .toSorted(([, a], [, b]) => b.spentUsd - a.spentUsd)
      .map(([label, entry]) => ({
        label,
        spentUsd: entry.spentUsd,
        billedUsd: entry.spentUsd,
        requests: entry.requests,
      }));
  }

  private traceRowsFor(tenantId: string, window: PersonalUsageWindow): MemoryTraceUsageRow[] {
    return this.traceRows.filter(
      (row) => row.tenantId === tenantId && inWindow(row.occurredAtMs, window),
    );
  }

  private principalRowsFor(
    tenantId: string,
    userId: string,
    window: PersonalUsageWindow,
  ): MemoryPrincipalLedgerRow[] {
    return this.principalRows.filter(
      (row) =>
        row.tenantId === tenantId && row.userId === userId && inWindow(row.occurredAtMs, window),
    );
  }

  private modelCounts(rows: MemoryTraceUsageRow[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const model of row.models) counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    return counts;
  }
}
