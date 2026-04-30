import { TraceNotFoundError } from "./errors";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
import type { TraceSummaryData } from "./types";

export class TraceSummaryService {
  constructor(readonly repository: TraceSummaryRepository) {}

  async upsert(data: TraceSummaryData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData> {
    const result = await this.repository.findByTraceId(
      tenantId,
      traceId,
      options,
    );
    if (!result) throw new TraceNotFoundError(traceId);
    return result;
  }
}
