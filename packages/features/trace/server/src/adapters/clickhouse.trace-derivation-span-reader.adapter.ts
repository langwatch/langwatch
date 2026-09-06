import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";
import { TraceDerivationSpanReaderPort } from "../ports/trace-derivation-span-reader.port.ts";
import type { TraceClickHouseWriteResolver } from "../ports/clickhouse.port.ts";
import { TraceDerivationSpanClickHouseRepository } from "../repositories/clickhouse/trace-derivation-span.repository.ts";

/** Answers the derivation reader from this deployment's own ClickHouse. */
export class ClickHouseTraceDerivationSpanReaderAdapter extends TraceDerivationSpanReaderPort {
  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
  }): ClickHouseTraceDerivationSpanReaderAdapter {
    return new ClickHouseTraceDerivationSpanReaderAdapter(
      TraceDerivationSpanClickHouseRepository.create({ resolveClient: options.resolveClient }),
    );
  }

  private constructor(private readonly repository: TraceDerivationSpanClickHouseRepository) {
    super();
  }

  findNormalizedSpansByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]> {
    return this.repository.findNormalizedSpansByTraceId(input);
  }

  findDerivedEventsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]> {
    return this.repository.findDerivedEventsByTraceId(input);
  }
}
