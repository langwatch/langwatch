import type { SpanInsertData } from "@langwatch/trace-contract";
import type { TraceClickHouseWriteResolver } from "../ports/clickhouse.port";
import { TraceSpanStoragePort } from "../ports/trace-span-storage.port";
import { TraceSpanStorageClickHouseRepository } from "../repositories/clickhouse/trace-span-storage.repository";

/**
 * The span-storage write capability, composed from nothing but a tenant-keyed
 * ClickHouse client and the retention fallback the event store already stamps.
 *
 * This is the whole seam a background process needs to persist canonical spans.
 * The application reaches the same rows through `SpanStorageService`, which
 * additionally carries the read half — blob-offload resolution and the
 * visibility gate — that an ingestion consumer never asks for. Requiring those
 * anyway is what kept the write path unbuildable outside the application, so
 * this adapter states the writer's dependencies instead of inheriting the
 * reader's.
 */
export class ClickHouseTraceSpanStorageAdapter extends TraceSpanStoragePort {
  private constructor(private readonly repository: TraceSpanStorageClickHouseRepository) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    /** The fallback stamped on a span that declares no retention of its own. */
    defaultRetentionDays: number;
  }): ClickHouseTraceSpanStorageAdapter {
    return new ClickHouseTraceSpanStorageAdapter(
      TraceSpanStorageClickHouseRepository.create({
        resolveClient: options.resolveClient,
        defaultRetentionDays: options.defaultRetentionDays,
      }),
    );
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  async insertSpans(spans: SpanInsertData[]): Promise<void> {
    await this.repository.insertSpans(spans);
  }
}
