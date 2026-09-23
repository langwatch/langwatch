import { TracePayloadReaderRepository } from "../trace-payload-reader.repository.ts";

/**
 * Memory-backed payloads return null for offloaded fields: event_log is unavailable,
 * and callers treat absence as "never offloaded".
 */
export class MemoryTracePayloadReaderRepository extends TracePayloadReaderRepository {
  static create(): MemoryTracePayloadReaderRepository {
    return new MemoryTracePayloadReaderRepository();
  }

  private constructor() {
    super();
  }

  async read(): Promise<string> {
    throw new Error("the memory trace repositories hold no offloaded payloads");
  }
}
