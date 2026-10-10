import type { RetentionDaysProvider } from "@langwatch/clickhouse-client";
import type {
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  ProjectableTrace,
  Protections,
  Trace,
  TraceCanonicalisationService,
  TraceSummaryData,
  TraceWithGuardrail,
  TracesForProjectResult,
} from "@langwatch/trace-contract";

import {
  isTraceSpansBatchResolverContractError,
  traceSpansBatchResolverCardinalityError,
  traceSpansBatchResolverMisalignedError,
} from "#rules/trace-spans-batch-resolver-contract-error.rules";

import {
  mapClickHouseEvaluationToTraceEvaluation,
  mapTraceEvaluationsToLegacyEvaluations,
  type ClickHouseEvaluationRunRow,
} from "../../../rules/trace-evaluation-mapping.rules.ts";
import {
  applyEventProtections,
  applyTraceProtections,
  extractRedactionsForObject,
} from "../../../rules/trace-read-redaction.rules.ts";
import type { ResolvedTraceSpans } from "../../../services/trace-offload-resolution.service.ts";
import type {
  ResolveTraceSpansBatchFn,
  ResolveTraceSpansFn,
  TraceLegacyReadRepository,
  TraceLegacyRow,
} from "../repositories/trace-legacy-read.repository.ts";
import { mapNormalizedSpansToSpans } from "../rules/trace-legacy-span-mapping.rules.ts";
import { mapTraceSummaryToTrace } from "../rules/trace-legacy-summary-mapping.rules.ts";

type OccurredAtRange = { from: number; to: number };

type MappingInputs = {
  repository: TraceLegacyReadRepository;
  traceCanonicalisation: TraceCanonicalisationService;
  resolveTraceSpans?: ResolveTraceSpansFn | undefined;
  /** Preferred over `resolveTraceSpans` for whole result sets (#4991 AC6). */
  resolveTraceSpansBatch?: ResolveTraceSpansBatchFn | undefined;
  /** The tenant's retention policy; absent, the span read floors at the platform default. */
  retentionDays?: RetentionDaysProvider | undefined;
};

/** Maps the legacy read's stored rows to legacy traces: canonical IO, offload, protections. */
export class LegacyTraceMappingService {
  private readonly repository: TraceLegacyReadRepository;
  private readonly traceCanonicalisation: TraceCanonicalisationService;
  private readonly resolveTraceSpans: ResolveTraceSpansFn | undefined;
  private readonly resolveTraceSpansBatch: ResolveTraceSpansBatchFn | undefined;
  private readonly retentionDays: RetentionDaysProvider | undefined;

  private constructor(inputs: MappingInputs) {
    this.repository = inputs.repository;
    this.traceCanonicalisation = inputs.traceCanonicalisation;
    this.resolveTraceSpans = inputs.resolveTraceSpans;
    this.resolveTraceSpansBatch = inputs.resolveTraceSpansBatch;
    this.retentionDays = inputs.retentionDays;
  }

  static create(inputs: MappingInputs): LegacyTraceMappingService {
    return new LegacyTraceMappingService(inputs);
  }

  /** @param opts.resolveBlobs resolves offloaded IO. */
  async findTracesWithSpans({
    projectId,
    traceIds,
    protections,
    occurredAt,
    opts,
  }: {
    projectId: string;
    traceIds: string[];
    protections: Protections;
    occurredAt?: OccurredAtRange | undefined;
    opts?: { resolveBlobs?: boolean | undefined };
  }): Promise<Trace[]> {
    const rows = await this.repository.findTracesWithSpans({
      projectId,
      traceIds,
      occurredAt,
      retentionDays: this.retentionDays,
    });
    return this.resolveAndMerge({
      projectId,
      rows,
      protections,
      resolveBlobs: opts?.resolveBlobs,
      failure: "Failed to fetch traces with spans",
    });
  }

  async findTracesByThreadId({
    projectId,
    threadId,
    protections,
    opts,
  }: {
    projectId: string;
    threadId: string;
    protections: Protections;
    opts?: { resolveBlobs?: boolean | undefined };
  }): Promise<Trace[]> {
    const rows = await this.repository.findTracesByThreadId({
      projectId,
      threadId,
      retentionDays: this.retentionDays,
    });
    const traces = await this.resolveAndMerge({
      projectId,
      rows,
      protections,
      resolveBlobs: opts?.resolveBlobs,
      failure: "Failed to fetch traces by thread ID",
    });
    return LegacyTraceMappingService.chronological(traces);
  }

  /** @param opts.maxTraces traces the read may return across every thread asked for. */
  async findTracesWithSpansByThreadIds({
    projectId,
    threadIds,
    protections,
    opts,
  }: {
    projectId: string;
    threadIds: string[];
    protections: Protections;
    opts?: { resolveBlobs?: boolean | undefined; maxTraces?: number | undefined };
  }): Promise<Trace[]> {
    const rows = await this.repository.findTracesWithSpansByThreadIds({
      projectId,
      threadIds,
      maxTraces: opts?.maxTraces,
      retentionDays: this.retentionDays,
    });
    const traces = await this.resolveAndMerge({
      projectId,
      rows,
      protections,
      resolveBlobs: opts?.resolveBlobs,
      failure: "Failed to fetch traces by thread IDs",
    });
    return LegacyTraceMappingService.chronological(traces);
  }

  async listAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options: GetAllTracesForProjectOptions = {},
  ): Promise<TracesForProjectResult> {
    const projectId = input.projectId;
    const { summaries, spans, evaluations, events, annotations, totalHits, scrollId, ...rest } =
      await this.repository.listAllTracesForProject({
        input,
        protections,
        options,
        retentionDays: this.retentionDays,
      });

    const fetched = summaries.map((summary) =>
      this.mapTrace({ projectId, summary, protections, resolution: unresolved([]) }),
    );
    const traces = await this.attachRequestedSpans({
      traces: fetched,
      spans,
      projectId,
      protections,
      includeSpans: options.includeSpans === true,
      resolveBlobs: options.resolveBlobs === true,
    });
    const groups = groupTraces(traces, input.groupBy).map(withGuardrails);
    const traceIds = groups.flat().map((t) => t.trace_id);
    const traceChecks =
      traceIds.length === 0
        ? {}
        : mapTraceEvaluationsToLegacyEvaluations(
            groupEvaluationsByTrace({ traceIds, evalRows: evaluations }),
          );

    // The compiled projector reads trace.events / trace.projectedAnnotations off these objects.
    const pageTraces: ProjectableTrace[] = groups.flat();
    if (events) attachProtectedEvents({ traces: pageTraces, events, protections });
    if (annotations) {
      for (const trace of pageTraces) {
        trace.projectedAnnotations = annotations.get(trace.trace_id) ?? [];
      }
    }

    return { groups, totalHits, traceChecks, scrollId, ...rest };
  }

  private async attachRequestedSpans({
    traces,
    spans,
    projectId,
    protections,
    includeSpans,
    resolveBlobs,
  }: {
    traces: Trace[];
    spans: Map<string, TraceLegacyRow>;
    projectId: string;
    protections: Protections;
    includeSpans: boolean;
    resolveBlobs: boolean;
  }): Promise<Trace[]> {
    // trace_summaries holds only the 64 KB preview, so full IO needs the spans de-offloaded.
    if ((!includeSpans && !resolveBlobs) || traces.length === 0) return traces;
    const enrichable = traces.flatMap((trace, index) => {
      const row = spans.get(trace.trace_id);
      return row && row.spans.length > 0 ? [{ index, row }] : [];
    });
    const merged = await this.resolveAndMergeMany({
      projectId,
      rows: enrichable.map((e) => e.row),
      protections,
      resolveBlobs,
    });
    const result = [...traces];
    enrichable.forEach((e, i) => {
      result[e.index] = merged[i]!;
    });
    // A summary caller keeps the recomputed trace IO but not the spans it never asked for.
    return includeSpans ? result : result.map((trace) => ({ ...trace, spans: [] }));
  }

  /** A resolver contract violation is a code bug and surfaces verbatim; others are named. */
  private async resolveAndMerge({
    failure,
    ...read
  }: {
    projectId: string;
    rows: TraceLegacyRow[];
    protections: Protections;
    resolveBlobs: boolean | undefined;
    failure: string;
  }): Promise<Trace[]> {
    try {
      return await this.resolveAndMergeMany(read);
    } catch (error) {
      if (isTraceSpansBatchResolverContractError(error)) throw error;
      throw new Error(failure, { cause: error });
    }
  }

  /** Resolution runs as one bounded pass over the whole set (#4991 AC6), then each trace maps. */
  private async resolveAndMergeMany({
    projectId,
    rows,
    protections,
    resolveBlobs,
  }: {
    projectId: string;
    rows: TraceLegacyRow[];
    protections: Protections;
    /** Only true resolves offloaded refs; list and search reads keep the preview. */
    resolveBlobs: boolean | undefined;
  }): Promise<Trace[]> {
    const resolutions = await this.resolveSpansBatch({
      projectId,
      spansPerTrace: rows.map((row) => row.spans),
      resolveBlobs,
    });
    return rows.map((row, i) =>
      this.mapTrace({ projectId, summary: row.summary, resolution: resolutions[i]!, protections }),
    );
  }

  private async resolveSpansBatch({
    projectId,
    spansPerTrace,
    resolveBlobs,
  }: {
    projectId: string;
    spansPerTrace: TraceLegacyRow["spans"][];
    resolveBlobs: boolean | undefined;
  }): Promise<ResolvedTraceSpans[]> {
    if (resolveBlobs === true && this.resolveTraceSpansBatch) {
      return resolveWithBatchResolver({
        projectId,
        spansPerTrace,
        resolver: this.resolveTraceSpansBatch,
      });
    }
    if (resolveBlobs === true && this.resolveTraceSpans) {
      const resolutions: ResolvedTraceSpans[] = [];
      for (const spans of spansPerTrace) {
        resolutions.push(await this.resolveTraceSpans(projectId, spans));
      }
      return resolutions;
    }
    return spansPerTrace.map(unresolved);
  }

  /** One trace's resolved spans as the legacy Trace, recomputed IO patched in, protected. */
  private mapTrace({
    projectId,
    summary,
    resolution,
    protections,
  }: {
    projectId: string;
    summary: TraceSummaryData;
    resolution: ResolvedTraceSpans;
    protections: Protections;
  }): Trace {
    const recomputedInput = resolution.anyResolved ? resolution.recomputedInput : null;
    const recomputedOutput = resolution.anyResolved ? resolution.recomputedOutput : null;
    const trace = mapTraceSummaryToTrace({
      summary,
      spans: mapNormalizedSpansToSpans(resolution.resolvedSpans),
      projectId,
      traceCanonicalisation: this.traceCanonicalisation,
    });
    return applyTraceProtections(
      {
        ...trace,
        ...(recomputedInput !== null ? { input: { value: recomputedInput.text } } : {}),
        ...(recomputedOutput !== null ? { output: { value: recomputedOutput.text } } : {}),
      },
      protections,
    );
  }

  /** The thread reads answer in time order; the store answers in trace id order. */
  private static chronological(traces: Trace[]): Trace[] {
    return traces.toSorted(
      (a, b) => (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0),
    );
  }
}

function unresolved(spans: TraceLegacyRow["spans"]): ResolvedTraceSpans {
  return {
    resolvedSpans: spans,
    recomputedInput: null,
    recomputedOutput: null,
    anyResolved: false,
  };
}

async function resolveWithBatchResolver({
  projectId,
  spansPerTrace,
  resolver,
}: {
  projectId: string;
  spansPerTrace: TraceLegacyRow["spans"][];
  resolver: ResolveTraceSpansBatchFn;
}): Promise<ResolvedTraceSpans[]> {
  const resolutions = await resolver(projectId, spansPerTrace);
  // One resolution per trace, in order: the injected fn's type cannot enforce it, so check here.
  if (resolutions.length !== spansPerTrace.length) {
    throw traceSpansBatchResolverCardinalityError({
      got: resolutions.length,
      expected: spansPerTrace.length,
    });
  }
  // Same count but swapped positions would scatter IO onto the wrong trace: check each entry.
  for (const [index, spans] of spansPerTrace.entries()) {
    const resolution = resolutions[index];
    if (resolution?.resolvedSpans.length !== spans.length) {
      throw traceSpansBatchResolverMisalignedError({
        index,
        expected: `${spans.length} span(s)${spans[0] ? ` for trace "${spans[0].traceId}"` : ""}`,
        got: `${resolution?.resolvedSpans.length ?? 0} span(s)`,
      });
    }
    const expected = spans[0]?.traceId;
    const got = resolution.resolvedSpans[0]?.traceId;
    if (expected !== undefined && got !== undefined && expected !== got) {
      throw traceSpansBatchResolverMisalignedError({
        index,
        expected: `trace "${expected}"`,
        got: `trace "${got}"`,
      });
    }
  }
  return resolutions;
}

function groupTraces(traces: Trace[], groupBy?: string): Trace[][] {
  if (!groupBy || groupBy === "none") return traces.map((trace) => [trace]);
  const groups = new Map<string, Trace[]>();
  for (const trace of traces) {
    let key: string | null = null;
    if (groupBy === "user_id") key = trace.metadata.user_id ?? null;
    else if (groupBy === "thread_id") key = trace.metadata.thread_id ?? null;
    // No grouping key: each trace is its own group.
    if (key) groups.set(key, [...(groups.get(key) ?? []), trace]);
    else groups.set(trace.trace_id, [trace]);
  }
  return Array.from(groups.values());
}

function withGuardrails(traces: Trace[]): TraceWithGuardrail[] {
  return traces.map((trace) => ({ ...trace, lastGuardrail: void 0, annotations: void 0 }));
}

function groupEvaluationsByTrace({
  traceIds,
  evalRows,
}: {
  traceIds: string[];
  evalRows: ClickHouseEvaluationRunRow[];
}): Record<string, ReturnType<typeof mapClickHouseEvaluationToTraceEvaluation>[]> {
  const grouped: Record<string, ReturnType<typeof mapClickHouseEvaluationToTraceEvaluation>[]> = {};
  for (const id of traceIds) grouped[id] = [];
  for (const row of evalRows) {
    if (row.TraceId && grouped[row.TraceId]) {
      grouped[row.TraceId]!.push(mapClickHouseEvaluationToTraceEvaluation(row));
    }
  }
  return grouped;
}

/** Events attach after the trace's protections ran, so they get the same blanking and scrubbing. */
function attachProtectedEvents({
  traces,
  events,
  protections,
}: {
  traces: ProjectableTrace[];
  events: Map<string, NonNullable<ProjectableTrace["events"]>>;
  protections: Protections;
}): void {
  for (const trace of traces) {
    const redactions = new Set<string>([
      ...(!protections.canSeeCapturedInput ? extractRedactionsForObject(trace.input?.value) : []),
      ...(!protections.canSeeCapturedOutput ? extractRedactionsForObject(trace.output?.value) : []),
    ]);
    trace.events = (events.get(trace.trace_id) ?? []).map((event) =>
      applyEventProtections(event, protections, redactions),
    );
  }
}
