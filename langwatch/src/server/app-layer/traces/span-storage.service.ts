import type { ClickHouseClient } from "@clickhouse/client";
import type { Span } from "~/server/tracer/types";
import { traced } from "../tracing";
import { SpanStorageClickHouseRepository } from "./repositories/span-storage.clickhouse.repository";
import {
  NullSpanStorageRepository,
  type SpanStorageRepository,
} from "./repositories/span-storage.repository";
import type { SpanInsertData } from "./types";

export class SpanStorageService {
  constructor(readonly repository: SpanStorageRepository) {}

  static create(clickhouse: ClickHouseClient | null): SpanStorageService {
    const repo = clickhouse
      ? new SpanStorageClickHouseRepository(clickhouse)
      : new NullSpanStorageRepository();
    return traced(new SpanStorageService(repo), "SpanStorageService");
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  async getSpansByTraceId(tenantId: string, traceId: string): Promise<Span[]> {
    return this.repository.getSpansByTraceId(tenantId, traceId);
  }
}
