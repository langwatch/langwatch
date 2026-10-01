import {
  type TraceClusteringSampleCounts,
  TraceClusteringSampleRepository,
  type TraceClusteringSampleRow,
} from "../trace-clustering-sample.repository.ts";

/** The memory tier folds no summary projection, so clustering finds nothing to read. */
export class MemoryNullTraceClusteringSampleRepository extends TraceClusteringSampleRepository {
  private constructor() {
    super();
  }

  static create(): MemoryNullTraceClusteringSampleRepository {
    return new MemoryNullTraceClusteringSampleRepository();
  }

  async countTraces(): Promise<TraceClusteringSampleCounts> {
    return { total: 0, recent: 0, assigned: 0 };
  }

  async findPageRows(): Promise<TraceClusteringSampleRow[]> {
    return [];
  }
}
