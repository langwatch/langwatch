import type { NormalizedSpan } from "@langwatch/trace-contract";
import type { TraceClickHouseWriteResolver } from "../ports/clickhouse.port";
import { TraceStoredSpanReaderPort } from "../ports/trace-stored-span-reader.port";
import { TraceSpanStorageClickHouseRepository } from "../repositories/clickhouse/trace-span-storage.repository";

/**
 * The stored-span read half, composed from exactly what the write half needs
 * and nothing more: a tenant-keyed ClickHouse client and the retention fallback
 * the event store already stamps.
 *
 * It shares the repository with {@link ClickHouseTraceSpanStorageAdapter} on
 * purpose. `stored_spans` has one row shape, one key triple and one partition
 * column, and a reader that spelled any of the three differently from the
 * writer would resolve nothing while looking correct. The two adapters exist
 * because the CAPABILITIES are different — one is the ingestion hot path, the
 * other a redelivery lookup — not because the table is.
 */
export class ClickHouseTraceStoredSpanReaderAdapter extends TraceStoredSpanReaderPort {
  private constructor(private readonly repository: TraceSpanStorageClickHouseRepository) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    /** The fallback stamped on a span that declares no retention of its own. */
    defaultRetentionDays: number;
  }): ClickHouseTraceStoredSpanReaderAdapter {
    return new ClickHouseTraceStoredSpanReaderAdapter(
      TraceSpanStorageClickHouseRepository.create({
        resolveClient: options.resolveClient,
        defaultRetentionDays: options.defaultRetentionDays,
      }),
    );
  }

  tryGetNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null> {
    return this.repository.findNormalizedSpanById(input);
  }
}
