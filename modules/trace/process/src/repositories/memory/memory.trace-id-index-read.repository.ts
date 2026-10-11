import {
  TraceIdIndexReadRepository,
  type TraceIdIndexWindow,
} from "../trace-id-index-read.repository.ts";

/** No ClickHouse, so no index: every read takes its existing path. */
export class MemoryTraceIdIndexReadRepository extends TraceIdIndexReadRepository {
  static create(): MemoryTraceIdIndexReadRepository {
    return new MemoryTraceIdIndexReadRepository();
  }

  private constructor() {
    super();
  }

  async findWindows(): Promise<TraceIdIndexWindow[]> {
    return [];
  }
}
