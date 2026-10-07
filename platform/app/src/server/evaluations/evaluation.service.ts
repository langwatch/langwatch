import type { Authorization } from "@langwatch/actor";
import { getLangWatchTracer } from "langwatch";
import { getApp } from "~/server/app-layer/app";
import { resolveInputsMarker } from "~/server/app-layer/evaluations/evaluation-inputs-offload";
import type { TraceEvaluationsRepository } from "~/server/app-layer/evaluations/repositories/trace-evaluations.clickhouse.repository";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import type { Protections } from "~/server/traces/protections";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * Resolves an offloaded-inputs marker (ADR-040) back to the full inputs at the
 * read boundary. The production default builds a per-project stored-objects
 * service and streams the durable object; a plain (non-marker) object passes
 * through unchanged. Injected so tests can supply a stub without standing up
 * object storage.
 */
export type ResolveEvaluationInputsMarker = (args: {
  projectId: string;
  inputs: Record<string, unknown> | null;
}) => Promise<Record<string, unknown> | null>;

const defaultResolveInputsMarker: ResolveEvaluationInputsMarker = ({
  projectId,
  inputs,
}) =>
  resolveInputsMarker({
    projectId,
    inputs,
    storedObjects: createStoredObjectsService({ projectId }),
  });

/**
 * Service for fetching per-trace evaluation runs from ClickHouse.
 * Queries `evaluation_runs` and collapses ReplacingMergeTree versions.
 *
 * The query, the dedup, and the memory-limit retry live in
 * `TraceEvaluationsClickHouseRepository`; this class keeps tracing and the
 * ADR-040 offloaded-inputs resolution.
 */
export class EvaluationService {
  private readonly tracer = getLangWatchTracer("langwatch.evaluations.service");
  private readonly resolveInputsMarker: ResolveEvaluationInputsMarker;
  private readonly injectedRepository?: TraceEvaluationsRepository;
  private cachedRepository?: TraceEvaluationsRepository;

  constructor({
    resolveInputsMarker = defaultResolveInputsMarker,
    repository,
  }: {
    resolveInputsMarker?: ResolveEvaluationInputsMarker;
    repository?: TraceEvaluationsRepository;
  } = {}) {
    this.resolveInputsMarker = resolveInputsMarker;
    this.injectedRepository = repository;
  }

  /**
   * The evaluations repository, taken lazily from
   * `getApp().evaluations.traceEvaluations` — the one the composition root
   * built over its ClickHouse resolver. Lazy because this service is
   * constructed inside `TraceService`, including on read paths and in unit
   * tests that never reach an evaluations query and never boot an App.
   */
  private get repository(): TraceEvaluationsRepository {
    if (this.injectedRepository) return this.injectedRepository;
    return (this.cachedRepository ??= getApp().evaluations.traceEvaluations);
  }

  static create(): EvaluationService {
    return new EvaluationService();
  }

  /**
   * One trace's evaluations, read through the proof (ADR-144 block F): on an
   * aggregate the proof is narrowed to the member that holds the trace, so
   * the drawer shows that member's evaluations.
   */
  async getEvaluationsForTrace({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): Promise<TraceEvaluation[]> {
    return await this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationsForTrace",
      { attributes: { "trace.id": traceId } },
      async () => {
        const evaluationsByTrace = await this.repository.findManyByTraceIds({
          authorization,
          traceIds: [traceId],
        });
        return evaluationsByTrace[traceId] ?? [];
      },
    );
  }

  async getEvaluationsMultiple({
    projectId,
    traceIds,
    protections: _protections,
  }: {
    projectId: string;
    traceIds: string[];
    protections?: Protections;
  }): Promise<Record<string, TraceEvaluation[]>> {
    return await this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationsMultiple",
      {
        attributes: {
          "tenant.id": projectId,
          "trace.count": traceIds.length,
        },
      },
      () =>
        this.repository.findManyByTraceIdsForTenant({
          tenantId: projectId,
          traceIds,
        }),
    );
  }

  /**
   * Fetch the heavy `Inputs` blob for one evaluation, on demand.
   *
   * The list reads drop `Inputs` under memory pressure because a `TraceId`
   * filter can't prune granules. This read is keyed by `EvaluationId` — the
   * table's second sort column — so ClickHouse prunes to the matching
   * granule(s) and the read stays bounded. Returns null when the evaluation
   * recorded no inputs, no project the proof reads holds it, or the
   * (already-pruned) read still hits the ceiling.
   */
  async getEvaluationInputs({
    authorization,
    evaluationId,
  }: {
    authorization: Authorization;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    return await this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationInputs",
      { attributes: { "evaluation.id": evaluationId } },
      async () => {
        const read = await this.repository.findInputsByEvaluationId({
          authorization,
          evaluationId,
        });
        if (!read) return null;
        // ADR-040: when inputs were offloaded, `inputs` is a stored-object
        // marker. Resolve it to the full inputs here - the natural lazy seam
        // the UI already fetches through - so the caller cannot tell whether
        // the inputs were inline or offloaded. Non-markers pass through. The
        // marker lives under the project the row was read from, which on an
        // aggregate is the member, not the aggregate.
        return this.resolveInputsMarker({
          projectId: read.tenantId,
          inputs: read.inputs,
        });
      },
    );
  }
}
