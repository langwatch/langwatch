import type { AnalyticsTraceFactData } from "../types";

export interface AnalyticsTraceFactsRepository {
  upsert(data: AnalyticsTraceFactData, tenantId: string): Promise<void>;
  getByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<AnalyticsTraceFactData | null>;
}

export class NullAnalyticsTraceFactsRepository
  implements AnalyticsTraceFactsRepository
{
  async upsert(
    _data: AnalyticsTraceFactData,
    _tenantId: string,
  ): Promise<void> {}

  async getByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<AnalyticsTraceFactData | null> {
    return null;
  }
}
