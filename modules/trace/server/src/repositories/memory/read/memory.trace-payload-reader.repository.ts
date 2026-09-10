import { TracePayloadReaderPort } from "../../read/trace-payload-reader.repository.ts";

/**
 * The claim-check twin for a process with no ClickHouse.
 *
 * Absence is the honest answer here rather than a refusal: an offloaded
 * payload lives in `event_log`, which the memory tier does not hold, and every
 * caller of this row already treats a null as "the field was never offloaded"
 * and falls back to the inline preview it was handed. Answering null therefore
 * degrades a memory-backed read exactly the way a trace whose field fitted
 * inline does, instead of failing a read the process could still serve.
 */
export class MemoryTracePayloadReaderRepository extends TracePayloadReaderPort {
  static create(): MemoryTracePayloadReaderRepository {
    return new MemoryTracePayloadReaderRepository();
  }

  private constructor() {
    super();
  }

  async tryRead(): Promise<string | null> {
    return null;
  }
}
