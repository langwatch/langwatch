import type { TraceClickHouseWriteClient } from "../../src/ports/clickhouse.port";
import {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "../../src/ports/trace-windowed-read-metrics.port";

export class TestWindowedReadMetrics extends TraceWindowedReadMetricsPort {
  private readonly counts = new Map<string, number>();

  record(input: { table: string; outcome: TraceWindowedReadOutcome }): void {
    const key = `${input.table}:${input.outcome}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  count(input: { table: string; outcome: TraceWindowedReadOutcome }): number {
    return this.counts.get(`${input.table}:${input.outcome}`) ?? 0;
  }
}

export function clientReturning(record: Record<string, unknown>): TraceClickHouseWriteClient {
  return {
    async insert(): Promise<undefined> {
      return undefined;
    },
    async query<Row>() {
      return { json: async <T = Row>() => [record] as T[] };
    },
  };
}

export function orderingClient(rows: Array<Record<string, unknown>>): {
  client: TraceClickHouseWriteClient;
  seen: Array<{ query: string; query_params?: Record<string, unknown> }>;
} {
  const seen: Array<{ query: string; query_params?: Record<string, unknown> }> = [];
  const orderedRows = [...rows].sort((left, right) => {
    const lastEventDifference =
      Number(right.LastEventOccurredAt) - Number(left.LastEventOccurredAt);
    if (lastEventDifference !== 0) return lastEventDifference;

    const spanCountDifference = Number(right.SpanCount) - Number(left.SpanCount);
    if (spanCountDifference !== 0) return spanCountDifference;

    const leftApplied = Array.isArray(left.AppliedEventIds) ? left.AppliedEventIds.length : 0;
    const rightApplied = Array.isArray(right.AppliedEventIds) ? right.AppliedEventIds.length : 0;
    if (rightApplied !== leftApplied) return rightApplied - leftApplied;

    const occurredAtDifference = String(left.OccurredAt).localeCompare(String(right.OccurredAt));
    if (occurredAtDifference !== 0) return occurredAtDifference;

    return JSON.stringify(right.AppliedEventIds).localeCompare(
      JSON.stringify(left.AppliedEventIds),
    );
  });
  return {
    client: {
      async insert(): Promise<undefined> {
        return undefined;
      },
      async query(input) {
        seen.push(input);
        return { json: async <T>() => orderedRows as T[] };
      },
    },
    seen,
  };
}

export function capturingInsertClient(): {
  client: TraceClickHouseWriteClient;
  inserts: Array<{ clickhouse_settings?: Record<string, number> }>;
} {
  const inserts: Array<{ clickhouse_settings?: Record<string, number> }> = [];
  return {
    client: {
      async insert(input): Promise<undefined> {
        inserts.push({ clickhouse_settings: input.clickhouse_settings });
        return undefined;
      },
      async query() {
        return { json: async <T>() => [] as T[] };
      },
    },
    inserts,
  };
}
