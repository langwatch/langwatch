/**
 * The collector body's own stages: the retrocompatibility rewrites the door has always applied,
 * and the refusals it answers with a 4xx. Each stage keeps the log line and the body it had
 * inside the single handler this was split out of.
 */
import { createLogger, validationMeta } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  customMetadataSchema,
  langWatchSpanSchema,
  maybeAddIdsToContextList,
  reservedTraceMetadataSchema,
  spanMetricsSchema,
  spanValidatorSchema,
  type CollectorRESTParamsValidator,
  type CustomMetadata,
  type ReservedTraceMetadata,
  type Span,
} from "@langwatch/trace-contract";

import type { CollectorErrorReportPort } from "./collector.api";

const logger = createLogger("langwatch.collector");

/** One refused body: the JSON the sender receives, and the status it arrives with. */
export type CollectorRejection = Readonly<{
  rejected: true;
  body: object;
  status: ContentfulStatusCode;
}>;

/** The largest body this door reads before refusing it unread. */
export const COLLECTOR_MAX_BODY_BYTES = 10 * 1024 * 1024;

/** The most spans, and the most evaluations, one trace may carry. */
const COLLECTOR_MAX_PER_TRACE = 200;

/**
 * The thread/user/customer/label keys moved inside `metadata`, and the door still accepts them
 * at the top level. Labels arrive as a string, a list, or an object of key/value pairs.
 */
export function applyLegacyMetadataFields(body: Record<string, any>): void {
  if (!("metadata" in body) || !body.metadata) {
    body.metadata = {};
    if ("thread_id" in body) {
      body.metadata.thread_id = body.thread_id;
    }
    if ("user_id" in body) {
      body.metadata.user_id = body.user_id;
    }
    if ("customer_id" in body) {
      body.metadata.customer_id = body.customer_id;
    }
    if ("labels" in body && body.labels) {
      body.metadata.labels = body.labels;
    }
  }

  const labels = body.metadata?.labels;
  if (!labels) return;
  if (typeof labels === "string") {
    body.metadata.labels = [labels];
    return;
  }
  if (Array.isArray(labels)) {
    body.metadata.labels = labels;
    return;
  }
  body.metadata.labels = Object.entries(labels).map(([key, value]) => `${key}: ${value as string}`);
}

function hasNoVerdict(evaluation: Record<string, any>): boolean {
  if (evaluation.status === "error" || evaluation.status === "skipped") return false;

  return (
    (evaluation.passed === undefined || evaluation.passed === null) &&
    (evaluation.score === undefined || evaluation.score === null) &&
    (evaluation.label === undefined || evaluation.label === null)
  );
}

function isNotMilliseconds(timestamp: unknown): boolean {
  return Boolean(timestamp) && String(timestamp).length !== 13;
}

function evaluationTimestampsNotMilliseconds(evaluation: Record<string, any>): boolean {
  return (
    isNotMilliseconds(evaluation.timestamps?.started_at) ||
    isNotMilliseconds(evaluation.timestamps?.finished_at)
  );
}

/**
 * Flags every evaluation that carries an error, and refuses the first one with no verdict or
 * with second-resolution timestamps.
 */
export function findEvaluationRejection(
  body: Record<string, any>,
  projectId: string,
): CollectorRejection | null {
  for (const evaluation of body.evaluations ?? []) {
    if (hasNoVerdict(evaluation)) {
      logger.error(
        { projectId, evaluationId: evaluation.id },
        "evaluation has no passed, score or label",
      );

      return {
        rejected: true,
        body: {
          error: "Either `passed`, `score` or `label` field must be defined for evaluations",
        },
        status: 400,
      };
    }

    if (evaluation.error) {
      evaluation.error.has_error = true;
    }

    if (evaluationTimestampsNotMilliseconds(evaluation)) {
      logger.error(
        { projectId, evaluationId: evaluation.id },
        "evaluation timestamps not in milliseconds",
      );

      return {
        rejected: true,
        body: {
          error:
            "Evaluation timestamps should be in milliseconds not in seconds, please multiply it by 1000",
        },
        status: 400,
      };
    }
  }

  return null;
}

/** Refuses a `spans` field that is not an array, or one over the per-trace cap. */
export function findSpansShapeRejection(
  body: Record<string, any>,
  input: Readonly<{ projectId: string; traceId: string | null | undefined }>,
): CollectorRejection | null {
  const { projectId, traceId } = input;
  if (body.spans && !Array.isArray(body.spans)) {
    // The type, not the value: whatever arrived in place of the array is
    // still the sender's content, and the type is the whole diagnosis.
    logger.warn(
      { projectId, receivedType: typeof body.spans, traceId },
      "invalid spans field, expecting array",
    );

    return {
      rejected: true,
      body: { message: "Invalid 'spans' field, expecting array" },
      status: 400,
    };
  }

  if (body.spans?.length > COLLECTOR_MAX_PER_TRACE) {
    logger.info({ projectId, spansCount: body.spans?.length, traceId }, "[429] Too many spans");

    return {
      rejected: true,
      body: { message: `Too many spans, maximum of ${COLLECTOR_MAX_PER_TRACE} per trace` },
      status: 429,
    };
  }

  return null;
}

/**
 * Mirrors the span cap for evaluations: without it, a 10MB body of minimal evaluation objects
 * yields tens of thousands of sequential event-sourcing dispatches per request (evaluations have
 * no dedup gate, unlike spans).
 */
export function findEvaluationsCapRejection(
  params: CollectorRESTParamsValidator,
  input: Readonly<{ projectId: string; traceId: string | null | undefined }>,
): CollectorRejection | null {
  const count = params.evaluations?.length ?? 0;
  if (count <= COLLECTOR_MAX_PER_TRACE) return null;

  logger.info(
    { projectId: input.projectId, evaluationsCount: count, traceId: input.traceId },
    "[429] Too many evaluations",
  );

  return {
    rejected: true,
    body: { message: `Too many evaluations, maximum of ${COLLECTOR_MAX_PER_TRACE} per trace` },
    status: 429,
  };
}

/** The reserved and the custom halves of a body's metadata, or the refusal parsing it earned. */
export type CollectorMetadata = Readonly<{
  reservedTraceMetadata: ReservedTraceMetadata;
  customMetadata: CustomMetadata;
}>;

function splitMetadata(metadata: Record<string, unknown>): CollectorMetadata {
  const reservedTraceMetadata = Object.fromEntries(
    Object.entries(reservedTraceMetadataSchema.parse(metadata)).filter(
      ([_key, value]) => value !== null && value !== undefined,
    ),
  );
  const remainingMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !(key in reservedTraceMetadataSchema.shape)),
  );

  return { reservedTraceMetadata, customMetadata: customMetadataSchema.parse(remainingMetadata) };
}

export function parseCollectorMetadata(
  params: CollectorRESTParamsValidator,
  input: Readonly<{ projectId: string; reportError?: CollectorErrorReportPort | undefined }>,
): CollectorMetadata | CollectorRejection {
  if (!params.metadata) return { reservedTraceMetadata: {}, customMetadata: {} };

  try {
    return splitMetadata(params.metadata);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    const validation = validationMeta(error);

    input.reportError?.(new Error("ZodError on parsing metadata"), { projectId: input.projectId });

    // Metadata is customer-authored key/value content, so the values stay
    // out. The rejected KEY names do not: a key refused across many
    // projects is how we learn our reserved-metadata list is too narrow.
    logger.warn({ projectId: input.projectId, ...validation }, "invalid metadata received");

    return { rejected: true, body: { error: validationError.message }, status: 400 };
  }
}

/** Whether a stage refused the body rather than producing its result. */
export function isCollectorRejection<T>(
  result: T | CollectorRejection,
): result is CollectorRejection {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { rejected?: unknown }).rejected === true
  );
}

function applyLegacySpanOutputs(span: Span): void {
  if (typeof span.output !== "undefined") return;
  if (!("outputs" in span)) return;
  if (typeof span.outputs === "undefined") return;

  //@ts-expect-error: `outputs` is the retired field, absent from the current span type
  if (span.outputs.length === 0) {
    span.output = null;
    return;
  }
  //@ts-expect-error: `outputs` is the retired field, absent from the current span type
  if (span.outputs.length === 1) {
    //@ts-expect-error: `outputs` is the retired field, absent from the current span type
    span.output = span.outputs[0];
    return;
  }
  //@ts-expect-error: `outputs` is the retired field, absent from the current span type
  span.output = { type: "list", value: span.outputs };
}

function normaliseContext<T extends Record<string, any>>(context: T): T {
  return {
    ...context,
    ...(typeof context.document_id === "number"
      ? { document_id: `${context.document_id as number}` }
      : {}),
    ...(typeof context.chunk_id === "number" ? { chunk_id: `${context.chunk_id as number}` } : {}),
    content:
      typeof context.content === "string" ? context.content : JSON.stringify(context.content),
  };
}

/**
 * The per-span retrocompatibility rewrites: `id` is still accepted for `span_id`, the trace id
 * falls back to the body's, `outputs` still stands in for `output`, RAG contexts still accept a
 * plain string list and number ids, and every unknown field is dropped.
 */
export function applyLegacySpanFields(
  spans: Span[],
  nullableTraceId: string | null | undefined,
): void {
  const spanFields = langWatchSpanSchema.options.flatMap((option) => Object.keys(option.shape));

  spans.forEach((span) => {
    // We changed "id" to "span_id", but we still support "id" for retrocompatibility for a while
    if ("id" in span) {
      span.span_id = span.id as string;
    }
    if (nullableTraceId && !span.trace_id) {
      span.trace_id = nullableTraceId;
    }
    applyLegacySpanOutputs(span);
    if ("contexts" in span) {
      // Keep retrocompatibility of RAG as a simple string list
      span.contexts = maybeAddIdsToContextList(span.contexts);
      span.contexts = span.contexts.map(normaliseContext);
    }
    if (span.error) {
      span.error.has_error = true;
    }

    for (const key of Object.keys(span)) {
      if (!spanFields.includes(key)) {
        delete (span as any)[key];
      }
    }
  });
}

/** The one trace id every span in the body belongs to, or the refusal it earned. */
export function resolveTraceId(
  spans: Span[],
  input: Readonly<{ projectId: string; nullableTraceId: string | null | undefined }>,
): string | CollectorRejection {
  const { projectId, nullableTraceId } = input;
  const traceId = nullableTraceId ?? spans[0]?.trace_id;
  if (!traceId) {
    logger.error(
      {
        projectId,
        traceId: nullableTraceId,
        spanCount: spans.length,
        spanIds: spans.map((span) => span.span_id),
      },
      "trace id not defined",
    );

    return { rejected: true, body: { message: "Trace ID not defined" }, status: 400 };
  }

  const traceIds = Array.from(
    new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id)),
  );
  if (traceIds[0] && (traceIds.length > 1 || traceIds[0] !== traceId)) {
    logger.error({ projectId, traceId, traceIds }, "trace ids are not the same");

    return {
      rejected: true,
      body: { message: "All spans must have the same trace id" },
      status: 400,
    };
  }

  return traceId;
}

function moveExtraneousMetricsToParams(span: Span): void {
  if (!span.metrics) return;
  const validMetrics = spanMetricsSchema.safeParse(span.metrics);
  if (!validMetrics.success) return;

  const extrataneousMetrics = Object.fromEntries(
    Object.entries(span.metrics).filter(([key]) => !(key in validMetrics.data)),
  );
  span.params = { ...span.params, ...extrataneousMetrics };
  span.metrics = validMetrics.data;
}

function spanTimestampsNotMilliseconds(span: Span): boolean {
  return (
    isNotMilliseconds(span.timestamps.started_at) ||
    isNotMilliseconds(span.timestamps.finished_at) ||
    isNotMilliseconds(span.timestamps.first_token_at)
  );
}

function findSpanValidationRejection(
  spans: Span[],
  index: number,
  input: Readonly<{
    projectId: string;
    traceId: string;
    reportError?: CollectorErrorReportPort | undefined;
  }>,
): CollectorRejection | null {
  const { projectId, traceId } = input;
  try {
    spans[index] = spanValidatorSchema.parse(spans[index]);
  } catch (error) {
    const validation = validationMeta(error);

    input.reportError?.(new Error("ZodError on parsing spans"), { projectId, traceId });

    const validationError = fromZodError(error as ZodError);

    logger.warn({ projectId, index, ...validation }, "invalid span received");

    return {
      rejected: true,
      body: { error: `${validationError.message} at "spans[${index}]"` },
      status: 400,
    };
  }

  return null;
}

/**
 * Validates every span in place, moving its extraneous metrics into params first, and refuses
 * the body at the first span that fails the schema or carries second-resolution timestamps.
 */
export function findSpanRejection(
  spans: Span[],
  input: Readonly<{
    projectId: string;
    traceId: string;
    reportError?: CollectorErrorReportPort | undefined;
  }>,
): CollectorRejection | null {
  for (const [index, span] of spans.entries()) {
    moveExtraneousMetricsToParams(span);

    const invalid = findSpanValidationRejection(spans, index, input);
    if (invalid) return invalid;

    if (spanTimestampsNotMilliseconds(span)) {
      logger.error(
        { traceId: input.traceId, projectId: input.projectId },
        "timestamps not in milliseconds for span",
      );

      return {
        rejected: true,
        body: {
          error: "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
        },
        status: 400,
      };
    }
  }

  return null;
}
