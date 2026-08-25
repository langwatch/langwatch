import { getLangWatchTracer } from "langwatch";
import type { EvaluationService as EvaluationCapability } from "@langwatch/evaluation-contract";
import { getApp } from "~/server/app-layer/app";
import { resolveInputsMarker } from "~/server/app-layer/evaluations/evaluation-inputs-offload";
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
 * Querying, deduplication, and memory-limit fallback belong to the canonical
 * Evaluation service. This compatibility class keeps only tracing and the
 * ADR-040 offloaded-input resolution used by legacy Trace callers.
 */
export class EvaluationService {
  private readonly tracer = getLangWatchTracer("langwatch.evaluations.service");
  private readonly resolveInputsMarker: ResolveEvaluationInputsMarker;
  private readonly injectedService?: EvaluationCapability;
  private cachedService?: EvaluationCapability;

  constructor({
    resolveInputsMarker = defaultResolveInputsMarker,
    service,
  }: {
    resolveInputsMarker?: ResolveEvaluationInputsMarker;
    service?: EvaluationCapability;
  } = {}) {
    this.resolveInputsMarker = resolveInputsMarker;
    this.injectedService = service;
  }

  /**
   * The canonical Evaluation service, taken lazily from the process App.
   * Lazy because this compatibility wrapper is still constructed by legacy
   * Trace callers that may never reach an evaluation read.
   */
  private get evaluations(): EvaluationCapability {
    if (this.injectedService) return this.injectedService;
    return (this.cachedService ??= getApp().evaluations);
  }

  static create(): EvaluationService {
    return new EvaluationService();
  }

  async getEvaluationsForTrace({
    projectId,
    traceId,
    protections,
  }: {
    projectId: string;
    traceId: string;
    protections?: Protections;
  }): Promise<TraceEvaluation[]> {
    // Single-trace read is the multi-trace read with one id — keeps the
    // query shape and the memory-limit fallback policy in one place.
    const evaluationsByTrace = await this.getEvaluationsMultiple({
      projectId,
      traceIds: [traceId],
      protections,
    });
    return evaluationsByTrace[traceId] ?? [];
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
        this.evaluations.findTraceEvaluations({
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
   * recorded no inputs, ClickHouse is unavailable, or the (already-pruned)
   * read still hits the ceiling.
   */
  async getEvaluationInputs({
    projectId,
    evaluationId,
  }: {
    projectId: string;
    evaluationId: string;
    protections?: Protections;
  }): Promise<Record<string, unknown> | null> {
    return await this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationInputs",
      {
        attributes: {
          "tenant.id": projectId,
          "evaluation.id": evaluationId,
        },
      },
      async () => {
        const inputs = await this.evaluations.tryGetInputs({
          tenantId: projectId,
          evaluationId,
        });
        // ADR-040: when inputs were offloaded, `inputs` is a stored-object
        // marker. Resolve it to the full inputs here - the natural lazy seam
        // the UI already fetches through - so the caller cannot tell whether
        // the inputs were inline or offloaded. Non-markers pass through.
        return this.resolveInputsMarker({ projectId, inputs });
      },
    );
  }
}
