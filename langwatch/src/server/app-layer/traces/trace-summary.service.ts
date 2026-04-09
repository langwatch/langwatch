import { TraceNotFoundError } from "./errors";
import type { TraceSummaryRepository } from "./repositories/trace-summary.repository";
import type { TraceSummaryData } from "./types";

export class TraceSummaryService {
  constructor(readonly repository: TraceSummaryRepository) {}

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
