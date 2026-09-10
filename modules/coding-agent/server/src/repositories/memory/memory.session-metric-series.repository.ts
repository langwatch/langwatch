import type { CodingAgentSessionMetricSeriesRecord } from "@langwatch/coding-agent-contract";
import {
  SessionMetricSeriesRepository,
  type SessionMetricTotal,
} from "../session-metric-series.repository.ts";
import { MemoryCodingAgentDatabase } from "./memory.coding-agent.database.ts";

/** Metric-only session overlays, held in the process. */
export class MemorySessionMetricSeriesRepository extends SessionMetricSeriesRepository {
  static create(memory: MemoryCodingAgentDatabase): MemorySessionMetricSeriesRepository {
    return new MemorySessionMetricSeriesRepository(memory);
  }

  private constructor(private readonly memory: MemoryCodingAgentDatabase) {
    super();
  }

  /**
   * One series is one row: a re-observed series replaces its earlier value
   * rather than adding to it, which is what the ClickHouse dedup by newest
   * `AsOf` does before it sums.
   */
  async ensure(
    records: CodingAgentSessionMetricSeriesRecord[],
    _retentionDays: number,
  ): Promise<void> {
    for (const record of records) {
      const existing = this.memory.metricSeries.findIndex(
        (held) => held.tenantId === record.tenantId && held.seriesId === record.seriesId,
      );
      if (existing === -1) this.memory.metricSeries.push(record);
      else if ((this.memory.metricSeries[existing]?.asOfUnixMs ?? 0) <= record.asOfUnixMs) {
        this.memory.metricSeries[existing] = record;
      }
    }
  }

  async findTotalsBySessionIds(input: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }): Promise<SessionMetricTotal[]> {
    const totals = new Map<string, SessionMetricTotal>();

    for (const held of this.memory.metricSeries) {
      if (held.tenantId !== input.tenantId) continue;
      if (!input.sessionIds.includes(held.sessionId)) continue;
      if (held.asOfUnixMs < input.fromMs || held.asOfUnixMs > input.toMs) continue;

      const bucket = held.attributes.type ?? "";
      const key = `${held.sessionId}:${held.metricName}:${bucket}`;
      const row = totals.get(key) ?? {
        sessionId: held.sessionId,
        metricName: held.metricName,
        bucket,
        total: 0,
      };
      row.total += held.value;
      totals.set(key, row);
    }

    return [...totals.values()];
  }
}
