import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { Trace, TraceApi, TracePreconditionSampleInput } from "@langwatch/trace-contract";

const SAMPLE_POOL_SIZE = 100;
const TOP_UP_BELOW = 10;

type SampleTrace = Trace & { passesPreconditions: boolean };

/** Main's `traces.getSampleTraces` (routers/traces.ts:393-480): a check's try-it-out sample. */
export class TracePreconditionSampleService {
  static create(deps: {
    traces: Pick<TraceApi, "readSampleTraces" | "resolveViewerProtections">;
    evaluators: Pick<EvaluatorApi, "findTraceIdsPassingPreconditions">;
    shuffle?: <T>(items: readonly T[]) => T[];
  }): TracePreconditionSampleService {
    return new TracePreconditionSampleService(
      deps.traces,
      deps.evaluators,
      deps.shuffle ?? shuffle,
    );
  }

  private constructor(
    private readonly traces: Pick<TraceApi, "readSampleTraces" | "resolveViewerProtections">,
    private readonly evaluators: Pick<EvaluatorApi, "findTraceIdsPassingPreconditions">,
    private readonly shuffle: <T>(items: readonly T[]) => T[],
  ) {}

  async readSample(input: TracePreconditionSampleInput): Promise<SampleTrace[]> {
    const { query, evaluatorType, preconditions, expectedResults } = input;
    const protections = await this.traces.resolveViewerProtections({
      projectId: query.projectId,
      userId: input.viewerUserId,
    });
    const traces = await this.traces.readSampleTraces({
      query,
      protections,
      pageSize: SAMPLE_POOL_SIZE,
    });
    if (traces.length === 0) return [];

    const passingIds = new Set(
      await this.evaluators.findTraceIdsPassingPreconditions({
        evaluatorType,
        preconditions,
        traces,
      }),
    );
    const samples = this.shuffle(traces.filter((trace) => passingIds.has(trace.trace_id)))
      .slice(0, expectedResults)
      .map((trace) => ({ ...trace, passesPreconditions: true }));
    if (samples.length >= TOP_UP_BELOW) return samples;

    return samples.concat(
      this.shuffle(traces.filter((trace) => !passingIds.has(trace.trace_id)))
        .slice(0, expectedResults - samples.length)
        .map((trace) => ({ ...trace, passesPreconditions: false })),
    );
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: Math.random() }))
    .toSorted((left, right) => left.key - right.key)
    .map(({ item }) => item);
}
