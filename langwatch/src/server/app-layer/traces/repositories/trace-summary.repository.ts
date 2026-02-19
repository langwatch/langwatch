import type { TraceSummaryData } from "../types";

export interface TraceSummaryRepository {
  upsert(data: TraceSummaryData, tenantId: string): Promise<void>;
  getByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<TraceSummaryData | null>;
}

export class NullTraceSummaryRepository implements TraceSummaryRepository {
  async upsert(_data: TraceSummaryData, _tenantId: string): Promise<void> {}

  async getByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<TraceSummaryData | null> {
    return null;
  }
}
