import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";
import { TraceDerivationSpanReaderPort } from "../../../ports/trace-derivation-span-reader.port.ts";
import type { MemoryTraceSpanStore } from "./memory-trace-span.store.ts";

/**
 * Read-time derivations over the memory span store. Same rows the span
 * storage row wrote, same trace-at-a-time read: the partition hint is
 * meaningless without partitions, so it is accepted and ignored.
 */
export class MemoryTraceDerivationSpanRepository extends TraceDerivationSpanReaderPort {
  readonly #store: MemoryTraceSpanStore;

  static create(store: MemoryTraceSpanStore): MemoryTraceDerivationSpanRepository {
    return new MemoryTraceDerivationSpanRepository(store);
  }

  private constructor(store: MemoryTraceSpanStore) {
    super();
    this.#store = store;
  }

  async findNormalizedSpansByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]> {
    const spans = this.#store.findNormalizedByTrace(input);
    return typeof input.limit === "number" ? spans.slice(0, input.limit) : spans;
  }

  async findDerivedEventsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]> {
    return this.#store.findDerivedEvents(input);
  }
}
