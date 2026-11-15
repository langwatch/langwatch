import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";

import type {
  LiveTraceEvaluationAnalyticsRow,
  TraceEvaluationAnalyticsWrite,
} from "../../rules/trace-evaluation-analytics.rules.ts";
import { TraceEvaluationAnalyticsRepository } from "../trace-evaluation-analytics.repository.ts";

/**
 * The trace_evaluation_analytics twin for a process with no ClickHouse: keeps every insert, and
 * answers live rows the way the GROUP BY every column HAVING sum(Sign) != 0 read does.
 */
export class MemoryTraceEvaluationAnalyticsRepository extends TraceEvaluationAnalyticsRepository {
  readonly inserted: TraceEvaluationAnalyticsWrite[] = [];

  static create(): MemoryTraceEvaluationAnalyticsRepository {
    return new MemoryTraceEvaluationAnalyticsRepository();
  }

  private constructor() {
    super();
  }

  async insertRows(input: { writes: readonly TraceEvaluationAnalyticsWrite[] }): Promise<void> {
    this.inserted.push(...input.writes);
  }

  async findLiveRows(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    occurredAtFromMs: number;
  }): Promise<LiveTraceEvaluationAnalyticsRow[]> {
    const tenants = new Set(projectIdsReadBy(input.authorization));
    return this.groups().filter(
      ({ row }) =>
        tenants.has(row.tenantId) &&
        input.traceIds.includes(row.traceId) &&
        row.occurredAtMs >= input.occurredAtFromMs,
    );
  }

  /** Every row a reader of the table sees, for a test to assert on. */
  liveRows(): LiveTraceEvaluationAnalyticsRow[] {
    return this.groups().filter((group) => group.signSum > 0);
  }

  private groups(): LiveTraceEvaluationAnalyticsRow[] {
    const groups = new Map<string, LiveTraceEvaluationAnalyticsRow>();
    for (const { sign, row, revision, updatedAtMs, retentionDays } of this.inserted) {
      const key = stableKeyOf({ row, revision, updatedAtMs, retentionDays });
      const signSum = (groups.get(key)?.signSum ?? 0) + sign;
      groups.set(key, { row, revision, updatedAtMs, retentionDays, signSum });
    }
    return [...groups.values()].filter((group) => group.signSum !== 0);
  }
}

/** Every column's value, object keys sorted, so two equal rows group however they were built. */
function stableKeyOf(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.keys(nested)
            .toSorted()
            .map((key) => [key, (nested as Record<string, unknown>)[key]]),
        )
      : nested,
  );
}
