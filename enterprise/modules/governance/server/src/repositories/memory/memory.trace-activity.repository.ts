// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernanceSetupActivityReader,
  QuarantineTraceActivityReader,
} from "../../app/governance.members.ts";

type GovernanceOriginSpan = {
  tenantId: string;
  sourceId: string;
  occurredAtMs: number;
};

/**
 * The trace-activity twin: an append-only log of governance-origin spans a
 * test seeds through {@link record}, read back the same way
 * `ClickHouseTraceActivityRepository` reads `trace_summaries`.
 */
export class MemoryTraceActivityRepository
  implements GovernanceSetupActivityReader, QuarantineTraceActivityReader
{
  private readonly spans: GovernanceOriginSpan[] = [];

  static create(): MemoryTraceActivityRepository {
    return new MemoryTraceActivityRepository();
  }

  /** Test seam: record one governance-origin span landing. */
  record(span: GovernanceOriginSpan): void {
    this.spans.push(span);
  }

  async hasRecentActivity(input: { tenantId: string; sinceMs: number }): Promise<boolean> {
    return this.spans.some(
      (span) => span.tenantId === input.tenantId && span.occurredAtMs >= input.sinceMs,
    );
  }

  async findSpanCountsBySource(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<{ sourceId: string; spanCount: number }[]> {
    const counts = new Map<string, number>();
    for (const span of this.spans) {
      if (span.tenantId !== input.tenantId || span.occurredAtMs < input.sinceMs) continue;
      counts.set(span.sourceId, (counts.get(span.sourceId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([sourceId, spanCount]) => ({ sourceId, spanCount }))
      .toSorted((a, b) => b.spanCount - a.spanCount);
  }
}
