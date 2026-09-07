/**
 * Where a validated collector body goes: the age cutoff, the span fan-out through the ingestion
 * pipeline, and the evaluation fan-out through the evaluation pipeline. Both report what they
 * rejected so the handler can answer with `partialSuccess`.
 */
import crypto from "node:crypto";

import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  DEFAULT_PII_REDACTION_LEVEL,
  SPAN_MAX_PAST_MS,
  type CollectorRESTParamsValidator,
  type Span,
} from "@langwatch/trace-contract";

import { TraceCollectorSpanService } from "#services/trace-collector-span.service";

import type { CollectorEvaluationReportPort, CollectorSpanIngestPort } from "./collector.api.ts";
import type { CollectorMetadata } from "./collector-body.api.ts";

const logger = createLogger("langwatch.collector");

/**
 * What `partialSuccess.errorMessage` says about a span or an evaluation the pipeline refused.
 * The pipeline's own strings name the datastore and its address, and this body reaches any
 * project key, so the count and the action travel and the diagnosis stays on the log line.
 */
export const SPAN_INGESTION_FAILED = "span ingestion failed, please retry";
export const EVALUATION_INGESTION_FAILED = "evaluation ingestion failed, please retry";

/**
 * OTLP parity: processSpan drops spans older than SPAN_MAX_PAST_MS before the dedup gate, so
 * apply the same age cutoff here — otherwise the REST path alone would write arbitrarily old
 * timestamps into cold ClickHouse partitions, undermining partition pruning.
 */
export function partitionFreshSpans(
  spans: Span[],
  input: Readonly<{ projectId: string; traceId: string }>,
): Readonly<{ freshSpans: Span[]; droppedOldSpans: number }> {
  const startedAtCutoff = nowInstant().epochMilliseconds - SPAN_MAX_PAST_MS;
  const freshSpans: Span[] = [];
  let droppedOldSpans = 0;
  for (const span of spans) {
    if (span.timestamps.started_at && span.timestamps.started_at < startedAtCutoff) {
      droppedOldSpans++;
      continue;
    }
    freshSpans.push(span);
  }
  if (droppedOldSpans > 0) {
    logger.info(
      { projectId: input.projectId, traceId: input.traceId, droppedOldSpans },
      "dropped spans with start time more than 31 days in the past",
    );
  }

  return { freshSpans, droppedOldSpans };
}

/**
 * `ingestNormalizedSpan` catches its own errors and RESOLVES with `{ status: "failed", error }`
 * (it never rejects), so inspect the resolved status — checking the allSettled "rejected"
 * wrapper would count every failure as a success. An unexpected rejection is still treated as a
 * failure defensively. "deduped" is a success, not an error.
 */
function ingestionFailureDetails(
  results: PromiseSettledResult<Readonly<{ status: string; error?: string | undefined }>>[],
): string[] {
  const details: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      details.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    if (result.value.status === "failed") {
      details.push(result.value.error ?? "span ingestion failed");
    }
  }

  return details;
}

/** What the span fan-out rejected, in the vocabulary `partialSuccess` answers with. */
export type SpanDispatchOutcome = Readonly<{
  rejectedSpans: number;
  dispatchFailures: number;
  rejectionErrors: string[];
}>;

async function fanOutSpans(
  freshSpans: Span[],
  input: Readonly<{
    projectId: string;
    metadata: CollectorMetadata;
    expectedOutput: string | null | undefined;
    ingestSpan: CollectorSpanIngestPort;
  }>,
): Promise<string[]> {
  const resource = TraceCollectorSpanService.buildResource({
    reservedTraceMetadata: input.metadata.reservedTraceMetadata,
    customMetadata: input.metadata.customMetadata,
    expectedOutput: input.expectedOutput,
  });

  const results = await Promise.allSettled(
    freshSpans.map((span) =>
      // Route through the ingestion pipeline (not the command sender
      // directly) so the REST collector shares the (tenant, trace, span)
      // dedup gate + ADR-022 spool hook with the OTLP path — a retry storm
      // here must not bypass dedup. occurredAt is stamped inside it.
      input.ingestSpan({
        tenantId: input.projectId,
        span: TraceCollectorSpanService.convertSpanToOtlp(span),
        resource,
        instrumentationScope: { name: "langwatch.rest.collector" },
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      }),
    ),
  );

  return ingestionFailureDetails(results);
}

export async function dispatchSpans(
  freshSpans: Span[],
  input: Readonly<{
    projectId: string;
    traceId: string;
    droppedOldSpans: number;
    metadata: CollectorMetadata;
    expectedOutput: string | null | undefined;
    ingestSpan: CollectorSpanIngestPort;
  }>,
): Promise<SpanDispatchOutcome> {
  const { projectId, traceId, droppedOldSpans } = input;
  const droppedErrors =
    droppedOldSpans > 0
      ? [`${droppedOldSpans} span(s) dropped: start time is more than 31 days in the past`]
      : [];

  try {
    const failureDetails = await fanOutSpans(freshSpans, input);
    const failureErrors = failureDetails.map(() => SPAN_INGESTION_FAILED);
    if (failureErrors.length > 0) {
      logger.error(
        {
          projectId,
          traceId,
          failureCount: failureDetails.length,
          errors: failureDetails,
        },
        "Error dispatching collector spans to event sourcing",
      );
    }

    return {
      rejectedSpans: droppedOldSpans + failureErrors.length,
      dispatchFailures: failureErrors.length,
      rejectionErrors: [...droppedErrors, ...failureErrors],
    };
  } catch (error) {
    // Catch synchronous errors (e.g., from buildResource)
    logger.error({ error, projectId, traceId }, "Error initializing event sourcing dispatch");

    return {
      rejectedSpans: droppedOldSpans + freshSpans.length,
      dispatchFailures: freshSpans.length,
      rejectionErrors: [...droppedErrors, SPAN_INGESTION_FAILED],
    };
  }
}

/** What the evaluation fan-out rejected. */
export type EvaluationDispatchOutcome = Readonly<{
  rejectedEvaluations: number;
  evaluationErrors: string[];
}>;

type CollectorEvaluation = NonNullable<CollectorRESTParamsValidator["evaluations"]>[number];

async function reportOneEvaluation(
  evaluation: CollectorEvaluation,
  input: Readonly<{
    projectId: string;
    traceId: string;
    occurredAt: number;
    deriveEvaluatorId: (name: string) => string;
    reportEvaluation: CollectorEvaluationReportPort;
  }>,
): Promise<void> {
  const { projectId, traceId } = input;
  const evaluationMD5 = crypto
    .createHash("md5")
    .update(JSON.stringify({ traceId, evaluation }))
    .digest("hex");
  const evaluationId = evaluation.evaluation_id ?? `eval_md5_${evaluationMD5}`;
  const evaluatorId = evaluation.evaluator_id ?? input.deriveEvaluatorId(evaluation.name);
  const status = evaluation.status ?? (evaluation.error ? "error" : "processed");
  // A verdict is only real when the evaluator ran to completion —
  // an errored/skipped run's stray passed/score/label must not
  // reach analytics or triggers as a real result (#6833). Same
  // gate as the shared verdictGate helpers applied at the
  // executeEvaluation command boundary.
  const hasVerdict = status === "processed";

  await input.reportEvaluation({
    tenantId: projectId,
    evaluationId,
    evaluatorId,
    evaluatorType: "custom",
    evaluatorName: evaluation.name,
    traceId,
    isGuardrail: evaluation.is_guardrail ?? undefined,
    status,
    score: hasVerdict ? (evaluation.score ?? null) : null,
    passed: hasVerdict ? (evaluation.passed ?? null) : null,
    label: hasVerdict ? (evaluation.label ?? null) : null,
    details: evaluation.details ?? null,
    error: evaluation.error?.message ?? null,
    occurredAt: input.occurredAt,
  });
}

/**
 * Dispatches custom SDK evaluations to the event-sourcing evaluation pipeline. The REST
 * collector receives evaluations as a separate field (not as span events), so they are
 * dispatched independently from the spans.
 */
export async function dispatchEvaluations(
  evaluations: CollectorEvaluation[],
  input: Readonly<{
    projectId: string;
    traceId: string;
    deriveEvaluatorId: (name: string) => string;
    reportEvaluation?: CollectorEvaluationReportPort | undefined;
  }>,
): Promise<EvaluationDispatchOutcome> {
  const { projectId, traceId, reportEvaluation } = input;
  if (!reportEvaluation) {
    logger.warn(
      { projectId, traceId, count: evaluations.length },
      "no evaluation pipeline on this process; collector evaluations rejected by name",
    );

    return {
      rejectedEvaluations: evaluations.length,
      evaluationErrors: [
        "This deployment records no evaluations, so the evaluations on this trace were not stored.",
      ],
    };
  }

  const occurredAt = nowInstant().epochMilliseconds;
  let rejectedEvaluations = 0;
  const evaluationErrors: string[] = [];
  for (const evaluation of evaluations) {
    // try/catch per evaluation so one failing dispatch does not silently
    // drop the remaining evaluations; failures are surfaced to the client
    // via partialSuccess.rejectedEvaluations below.
    try {
      await reportOneEvaluation(evaluation, { ...input, occurredAt, reportEvaluation });
    } catch (error) {
      rejectedEvaluations++;
      evaluationErrors.push(EVALUATION_INGESTION_FAILED);
      logger.error(
        { error, projectId, traceId, evaluationName: evaluation.name },
        "Error dispatching REST evaluation to event sourcing",
      );
    }
  }

  return { rejectedEvaluations, evaluationErrors };
}
