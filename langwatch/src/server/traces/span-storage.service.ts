import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import type { Span } from "~/server/tracer/types";
import {
  SpanStorageClickHouseRepository,
  type SpanStorageRepository,
} from "./repositories/span-storage.clickhouse.repository";

export class SpanStorageService {
  private readonly useClickHouse: boolean;

  constructor(
    private readonly repository: SpanStorageRepository | null,
    clickHouseAvailable: boolean,
  ) {
    this.useClickHouse = clickHouseAvailable;
  }

  static create(): SpanStorageService {
    return new SpanStorageService(null, isClickHouseEnabled());
  }

  async getSpansByTraceId(tenantId: string, traceId: string): Promise<Span[]> {
    if (!this.useClickHouse) {
      return [];
    }
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) return [];
    const repo = new SpanStorageClickHouseRepository(client);
    return repo.getSpansByTraceId(tenantId, traceId);
  }
}
