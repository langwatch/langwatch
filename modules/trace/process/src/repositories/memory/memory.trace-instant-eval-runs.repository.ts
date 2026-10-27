import {
  type TraceInstantEvalRunRow,
  TraceInstantEvalRunsReadRepository,
} from "../trace-instant-eval-runs.repository.ts";

/** A run as a test seeds it, with the project that recorded it. */
type SeededRun = TraceInstantEvalRunRow & { readonly projectId: string };

/** Instant-eval's shared run rows in memory, seeded by a test; trace writes none. */
export class MemoryTraceInstantEvalRunsRepository extends TraceInstantEvalRunsReadRepository {
  static create({
    runs = [],
  }: { runs?: readonly SeededRun[] } = {}): MemoryTraceInstantEvalRunsRepository {
    return new MemoryTraceInstantEvalRunsRepository(runs);
  }

  private constructor(private readonly runs: readonly SeededRun[]) {
    super();
  }

  async findRunsByIds({
    projectId,
    runIds,
  }: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<TraceInstantEvalRunRow[]> {
    const wanted = new Set(runIds);
    return this.runs
      .filter((run) => run.projectId === projectId && wanted.has(run.runId))
      .map(({ runId, createdAt, finishedAt }) => ({ runId, createdAt, finishedAt }));
  }
}
