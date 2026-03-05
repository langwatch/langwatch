import type { Span } from "~/server/tracer/types";
import { getClickHouseClient } from "~/server/clickhouse/client";
import {
  SpanStorageClickHouseRepository,
  type SpanStorageRepository,
} from "./repositories/span-storage.clickhouse.repository";

class NullSpanStorageRepository implements SpanStorageRepository {
  async getSpansByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<Span[]> {
    return [];
  }
}

export class SpanStorageService {
  constructor(private readonly repository: SpanStorageRepository) {}

  static create(): SpanStorageService {
    const client = getClickHouseClient();
    if (!client) return new SpanStorageService(new NullSpanStorageRepository());
    return new SpanStorageService(new SpanStorageClickHouseRepository(client));
  }

  async getSpansByTraceId(tenantId: string, traceId: string): Promise<Span[]> {
    return this.repository.getSpansByTraceId(tenantId, traceId);
  }
}
