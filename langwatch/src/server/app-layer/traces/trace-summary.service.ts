import type { ClickHouseClient } from "@clickhouse/client";
import { TraceNotFoundError } from "./errors";
import { traced } from "../tracing";
import { TraceSummaryClickHouseRepository } from "./repositories/trace-summary.clickhouse.repository";
import {
  NullTraceSummaryRepository,
  type TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
import type { TraceSummaryData } from "./types";

export class TraceSummaryService {
  constructor(readonly repository: TraceSummaryRepository) {}

  static create(clickhouse: ClickHouseClient | null): TraceSummaryService {
    const repo = clickhouse
      ? new TraceSummaryClickHouseRepository(clickhouse)
      : new NullTraceSummaryRepository();
    return traced(new TraceSummaryService(repo), "TraceSummaryService");
  }

  async upsert(data: TraceSummaryData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<TraceSummaryData> {
    const result = await this.repository.getByTraceId(tenantId, traceId);
    if (!result) throw new TraceNotFoundError(traceId);
    return result;
  }
}
