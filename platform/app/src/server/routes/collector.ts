import crypto from "node:crypto";
import { createLogger } from "@langwatch/observability";
import type { Project } from "@prisma/client";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  captureException,
  getCurrentScope,
} from "../../utils/posthogErrorCapture";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "../api-key/auth-middleware";
import type { ResolvedToken } from "../api-key/token-resolver";
import { TokenResolver } from "../api-key/token-resolver";
import { getApp } from "../app-layer/app";
import { SPAN_MAX_PAST_MS } from "../app-layer/traces/trace-request-collection.service";
import { PlanLimitExceededError } from "../app-layer/usage/errors";
import type { UsageLimitResult } from "../app-layer/usage/usage.service";
import { prisma } from "../db";
import { evaluationNameAutoslug } from "../tracer/collector/evaluationNameAutoslug";
import { maybeAddIdsToContextList } from "../tracer/collector/rag";
import type {
  CollectorRESTParamsValidator,
  CustomMetadata,
  ReservedTraceMetadata,
  Span,
} from "../tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  customMetadataSchema,
  reservedTraceMetadataSchema,
  spanMetricsSchema,
  spanSchema,
  spanValidatorSchema,
} from "../tracer/types";
import { CollectorSpanUtils } from "../traces/collectorSpan.utils";

const logger = createLogger("langwatch.collector");
const tokenResolver = TokenResolver.create(prisma);

const secured = createServiceApp({ basePath: "/api" });

type CollectorProject = Project & {
  team: { id: string; organizationId: string };
};

// ── auth ─────────────────────────────────────────────────────────────

/** Resolves the token to a project + enforces the traces:create API-key
 *  ceiling. Assumes credentials were already extracted by the caller. */
async function resolveCollectorAuth(
  c: Context,
  credentials: { token: string; projectId: string | null },
): Promise<
  | { ok: true; project: CollectorProject; resolved: ResolvedToken }
  | { ok: false; response: Response }
> {
  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });

  if (!resolved) {
    logger.warn("collector request is not authenticated, invalid auth token");
    return {
      ok: false,
      response: c.json(
        { error: "Unauthorized", message: "Invalid credentials" },
        401,
      ),
    };
  }

  // Enforce API-key ceiling (legacy tokens bypass). `traces:create` gates write
  // access — ADMIN and MEMBER have it; VIEWER does not, preventing
  // read-only API keys from ingesting traces.
  try {
    await enforceApiKeyCeiling({
      prisma,
      resolved,
      permission: "traces:create",
    });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    logger.warn(
      {
        projectId: resolved.project.id,
        apiKeyId: resolved.type === "apiKey" ? resolved.apiKeyId : undefined,
      },
      "collector request denied by API key ceiling",
    );
    // The full handled body — code, permission, tips — not just a sentence.
    return { ok: false, response: c.json(denial.body, denial.status) };
  }

  return { ok: true, project: resolved.project, resolved };
}

// ── body parsing ─────────────────────────────────────────────────────

/** Validates the request carries a parseable JSON object body. */
async function parseCollectorRequestBody(
  c: Context,
): Promise<
  { ok: true; body: Record<string, any> } | { ok: false; response: Response }
> {
  // warn, not error: a malformed body is the caller's mistake and we answer
  // it with a 400. These three sites return rather than throw, so they never
  // reach the boundary that would classify them as customer fault, and at
  // error level they were about a fifth of this service's error stream.
  const contentType = c.req.header("content-type");
  if (!contentType?.includes("application/json")) {
    logger.warn("collector request body is not json");
    return {
      ok: false,
      response: c.json({ message: "Invalid body, expecting json" }, 400),
    };
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    logger.warn("collector request body is not valid json");
    return {
      ok: false,
      response: c.json({ message: "Invalid body, expecting json" }, 400),
    };
  }

  // `typeof null` is "object" and an array is one too, so both walk past a
  // bare typeof check and reach `"metadata" in body` below — which throws on
  // null. That is the same customer mistake as the two guards above, so it
  // belongs on the same 400 rather than in the error stream as a 500.
  if (body === null || Array.isArray(body) || typeof body !== "object") {
    logger.warn("collector request body is not a json object");
    return {
      ok: false,
      response: c.json({ message: "Invalid body, expecting json" }, 400),
    };
  }

  return { ok: true, body };
}

// ── usage limit ──────────────────────────────────────────────────────

/** Checks and enforces the org's usage limit, notifying on first breach.
 *  Throws `PlanLimitExceededError` when the limit is exceeded. */
async function enforceCollectorUsageLimit(
  project: CollectorProject,
): Promise<void> {
  // The lookup is wrapped in try/catch on its own — on failure we log and
  // let the request through (same behaviour as before). The thrown limit
  // error below lives outside that try block so it is never mistaken for
  // a lookup failure.
  let limitResult: UsageLimitResult;
  try {
    limitResult = await getApp().usage.checkLimit({
      teamId: project.teamId,
    });
  } catch (error) {
    logger.error(
      { error, projectId: project.id },
      "Error checking trace limit",
    );
    captureException(new Error("Error checking trace limit"), {
      extra: { projectId: project.id, error },
    });
    limitResult = { exceeded: false };
  }

  if (!limitResult.exceeded) return;

  try {
    const activePlan = await getApp().planProvider.getActivePlan({
      organizationId: project.team.organizationId,
    });
    await getApp().usageLimits.notifyPlanLimitReached({
      organizationId: project.team.organizationId,
      planName: activePlan.name ?? "free",
    });
  } catch (error) {
    logger.error(
      { error, projectId: project.id },
      "Error sending plan limit notification",
    );
  }
  logger.info(
    {
      projectId: project.id,
      currentMonthMessagesCount: limitResult.count,
      activePlanName: limitResult.planName,
      maxMessagesPerMonth: limitResult.maxMessagesPerMonth,
    },
    "Project has reached plan limit",
  );

  // 402, not 429: OTel SDKs and most HTTP clients retry a 429, and a
  // plan limit is terminal for that payload, so a retryable status
  // turns one rejection into an unbounded loop.
  throw new PlanLimitExceededError(limitResult.message, {
    currentMonthMessagesCount: limitResult.count,
    maxMessagesPerMonth: limitResult.maxMessagesPerMonth,
    activePlanName: limitResult.planName,
  });
}

// ── metadata migration ──────────────────────────────────────────────

// We migrated those keys to inside metadata, but we still want to support them for retrocompatibility for a while
function migrateLegacyTopLevelFields(body: Record<string, any>): void {
  if ("metadata" in body && body.metadata) return;

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

// Allow objects and simple strings to be sent as labels as well
function normalizeMetadataLabels(body: Record<string, any>): void {
  if (!body.metadata?.labels) return;

  body.metadata.labels =
    typeof body.metadata.labels === "string"
      ? [body.metadata.labels]
      : Array.isArray(body.metadata.labels)
        ? body.metadata.labels
        : Object.entries(body.metadata.labels).map(
            ([key, value]) => `${key}: ${value as string}`,
          );
}

/** Migrates the legacy top-level thread_id/user_id/customer_id/labels
 *  fields into `body.metadata`, and normalizes labels to a string list.
 *  Mutates `body` in place. */
function migrateLegacyMetadataFields(body: Record<string, any>): void {
  migrateLegacyTopLevelFields(body);
  normalizeMetadataLabels(body);
}

// ── inline evaluations pre-validation ───────────────────────────────

function evaluationMissingOutcome(evaluation: any): boolean {
  return (
    evaluation.status !== "error" &&
    evaluation.status !== "skipped" &&
    (evaluation.passed === undefined || evaluation.passed === null) &&
    (evaluation.score === undefined || evaluation.score === null) &&
    (evaluation.label === undefined || evaluation.label === null)
  );
}

function evaluationTimestampsNotInMs(evaluation: any): boolean {
  return Boolean(
    (evaluation.timestamps?.started_at &&
      evaluation.timestamps.started_at.toString().length !== 13) ||
      (evaluation.timestamps?.finished_at &&
        evaluation.timestamps.finished_at.toString().length !== 13),
  );
}

/** Validates the shape of one inline evaluation. Mutates `error.has_error`
 *  in place. Returns the wire error response when invalid, or null. */
function validateInlineEvaluation(
  c: Context,
  evaluation: any,
  projectId: string,
): Response | null {
  if (evaluationMissingOutcome(evaluation)) {
    logger.error(
      { projectId, evaluationId: evaluation.id },
      "evaluation has no passed, score or label",
    );
    return c.json(
      {
        error:
          "Either `passed`, `score` or `label` field must be defined for evaluations",
      },
      400,
    );
  }

  if (evaluation.error) {
    evaluation.error.has_error = true;
  }

  if (evaluationTimestampsNotInMs(evaluation)) {
    logger.error(
      { projectId, evaluationId: evaluation.id },
      "evaluation timestamps not in milliseconds",
    );
    return c.json(
      {
        error:
          "Evaluation timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      },
      400,
    );
  }

  return null;
}

/** Validates the shape of `body.evaluations` before the params schema runs.
 *  Mutates each evaluation's `error.has_error` in place. Returns the wire
 *  error response for the first invalid evaluation, or null when all pass. */
function validateInlineEvaluations(
  c: Context,
  body: Record<string, any>,
  projectId: string,
): Response | null {
  for (const evaluation of body.evaluations ?? []) {
    const error = validateInlineEvaluation(c, evaluation, projectId);
    if (error) return error;
  }
  return null;
}

// ── params parsing ───────────────────────────────────────────────────

/** Parses `body` against the collector REST params schema. */
function parseCollectorParams(
  c: Context,
  body: Record<string, any>,
  projectId: string,
):
  | { ok: true; params: CollectorRESTParamsValidator }
  | { ok: false; response: Response } {
  try {
    const params = collectorRESTParamsValidatorSchema.parse(body);
    return { ok: true, params };
  } catch (error) {
    captureException(new Error("ZodError on parsing body"), {
      extra: { projectId, body, zodError: error },
    });

    const validationError = fromZodError(error as ZodError);

    logger.error({ error, body, validationError }, "invalid trace received");

    return {
      ok: false,
      response: c.json({ error: validationError.message }, 400),
    };
  }
}

// ── spans / evaluations shape + count checks ────────────────────────

/** Validates `body.spans` is an array and neither spans nor evaluations
 *  exceed their per-trace caps. */
function validateSpansShape(
  c: Context,
  {
    body,
    params,
    projectId,
    traceId,
  }: {
    body: Record<string, any>;
    params: CollectorRESTParamsValidator;
    projectId: string;
    traceId: string | null | undefined;
  },
): Response | null {
  if (body.spans && !Array.isArray(body.spans)) {
    logger.error(
      { projectId, spans: body.spans, traceId },
      "invalid spans field, expecting array",
    );

    return c.json({ message: "Invalid 'spans' field, expecting array" }, 400);
  }

  if (body.spans?.length > 200) {
    logger.info(
      { projectId, spansCount: body.spans?.length, traceId },
      "[429] Too many spans",
    );
    return c.json({ message: "Too many spans, maximum of 200 per trace" }, 429);
  }

  // Mirror the span cap for evaluations: without it, a 10MB body of minimal
  // evaluation objects yields tens of thousands of sequential event-sourcing
  // dispatches per request (evaluations have no dedup gate, unlike spans).
  if ((params.evaluations?.length ?? 0) > 200) {
    logger.info(
      { projectId, evaluationsCount: params.evaluations?.length, traceId },
      "[429] Too many evaluations",
    );
    return c.json(
      { message: "Too many evaluations, maximum of 200 per trace" },
      429,
    );
  }

  return null;
}

// ── trace metadata parsing ──────────────────────────────────────────

/** Splits `params.metadata` into its reserved and custom slices. */
function parseTraceMetadata(
  c: Context,
  {
    params,
    projectId,
  }: { params: CollectorRESTParamsValidator; projectId: string },
):
  | {
      ok: true;
      reservedTraceMetadata: ReservedTraceMetadata;
      customMetadata: CustomMetadata;
    }
  | { ok: false; response: Response } {
  let reservedTraceMetadata: ReservedTraceMetadata = {};
  let customMetadata: CustomMetadata = {};
  try {
    if (params.metadata) {
      reservedTraceMetadata = Object.fromEntries(
        Object.entries(
          reservedTraceMetadataSchema.parse(params.metadata),
        ).filter(([_key, value]) => value !== null && value !== undefined),
      );
      const remainingMetadata = Object.fromEntries(
        Object.entries(params.metadata).filter(
          ([key]) => !(key in reservedTraceMetadataSchema.shape),
        ),
      );
      customMetadata = customMetadataSchema.parse(remainingMetadata);
    }
    return { ok: true, reservedTraceMetadata, customMetadata };
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    captureException(new Error("ZodError on parsing metadata"), {
      extra: {
        projectId,
        metadata: params.metadata,
        zodError: error,
      },
    });

    logger.error(
      {
        projectId,
        metadata: params.metadata,
        zodError: error,
      },
      "invalid metadata received",
    );

    return {
      ok: false,
      response: c.json({ error: validationError.message }, 400),
    };
  }
}

// ── span normalization (retrocompatibility fields) ──────────────────

/** `outputs` (list) -> `output` (single item) retrocompatibility. */
function normalizeSpanOutputsField(span: Span): void {
  // We changes "outputs" list to "output" single item, so here we keep supporting the old "outputs" for retrocompaibility
  if (
    typeof span.output === "undefined" &&
    "outputs" in span &&
    typeof (span as any).outputs !== "undefined"
  ) {
    //@ts-expect-error
    if (span.outputs.length == 0) {
      span.output = null;
      //@ts-expect-error
    } else if (span.outputs.length == 1) {
      //@ts-expect-error
      span.output = span.outputs[0];
      //@ts-expect-error
    } else if (span.outputs.length > 1) {
      span.output = {
        type: "list",
        //@ts-expect-error
        value: span.outputs,
      };
    }
  }
}

/** Keeps RAG contexts as a simple string list and stringifies numeric ids. */
function normalizeSpanContextsField(span: Span): void {
  if ("contexts" in span) {
    // Keep retrocompatibility of RAG as a simple string list
    span.contexts = maybeAddIdsToContextList(span.contexts);
    // Allow number ids
    span.contexts = span.contexts.map((context) => ({
      ...context,
      ...(typeof context.document_id === "number"
        ? { document_id: `${context.document_id as number}` }
        : {}),
      ...(typeof context.chunk_id === "number"
        ? { chunk_id: `${context.chunk_id as number}` }
        : {}),
      content:
        typeof context.content === "string"
          ? context.content
          : JSON.stringify(context.content),
    }));
  }
}

/** Drops any key not in the span schema's known field set. */
function pruneUnknownSpanFields(span: Span, spanFields: string[]): void {
  for (const key of Object.keys(span)) {
    if (!spanFields.includes(key)) {
      delete (span as any)[key];
    }
  }
}

/** Applies every retrocompatibility normalization to one span, in place. */
function normalizeCollectorSpan(
  span: Span,
  {
    spanFields,
    nullableTraceId,
  }: { spanFields: string[]; nullableTraceId: string | null | undefined },
): void {
  // We changed "id" to "span_id", but we still want to support "id" for retrocompatibility for a while
  if ("id" in span) {
    span.span_id = (span as any).id as string;
  }
  if (nullableTraceId && !span.trace_id) {
    span.trace_id = nullableTraceId;
  }
  normalizeSpanOutputsField(span);
  normalizeSpanContextsField(span);
  if (span.error) {
    span.error.has_error = true;
  }

  pruneUnknownSpanFields(span, spanFields);
}

// ── trace id resolution ─────────────────────────────────────────────

/** Resolves the trace id spans agree on, or the wire error when there is
 *  none or spans disagree. */
function resolveCollectorTraceId(
  c: Context,
  {
    spans,
    nullableTraceId,
    projectId,
  }: {
    spans: Span[];
    nullableTraceId: string | null | undefined;
    projectId: string;
  },
): { ok: true; traceId: string } | { ok: false; response: Response } {
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

    return {
      ok: false,
      response: c.json({ message: "Trace ID not defined" }, 400),
    };
  }

  getCurrentScope()?.setPropagationContext?.({
    traceId,
    sampleRand: 1,
    propagationSpanId: traceId,
  });

  const traceIds = Array.from(
    new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id)),
  );
  if (traceIds[0] && (traceIds.length > 1 || traceIds[0] != traceId)) {
    logger.error(
      { projectId, traceId, traceIds },
      "trace ids are not the same",
    );

    return {
      ok: false,
      response: c.json(
        { message: "All spans must have the same trace id" },
        400,
      ),
    };
  }

  return { ok: true, traceId };
}

// ── span validation (zod parse + timestamp check) ───────────────────

/** Moves any metric key the schema doesn't recognize onto `span.params`,
 *  in place — retrocompatibility for extraneous metric fields. */
function relocateExtraneousSpanMetrics(span: Span): void {
  if (span.metrics) {
    const validMetrics = spanMetricsSchema.safeParse(span.metrics);
    if (validMetrics.success) {
      const extrataneousMetrics = Object.fromEntries(
        Object.entries(span.metrics).filter(
          ([key]) => !(key in validMetrics.data),
        ),
      );
      span.params = {
        ...span.params,
        ...extrataneousMetrics,
      };
      span.metrics = validMetrics.data;
    }
  }
}

/** True when any of the span's timestamps is not in millisecond precision. */
function spanTimestampsNotInMs(span: Span): boolean {
  return Boolean(
    (span.timestamps.started_at &&
      span.timestamps.started_at.toString().length !== 13) ||
      (span.timestamps.finished_at &&
        span.timestamps.finished_at.toString().length !== 13) ||
      (span.timestamps.first_token_at &&
        span.timestamps.first_token_at.toString().length !== 13),
  );
}

/** Relocates extraneous metrics, zod-validates, and checks timestamp
 *  precision for every span, in order, stopping at the first failure. */
function validateAndNormalizeSpanBatch(
  c: Context,
  {
    spans,
    projectId,
    traceId,
  }: { spans: Span[]; projectId: string; traceId: string },
): { ok: true; spans: Span[] } | { ok: false; response: Response } {
  for (const [index, span] of spans.entries()) {
    // Move extrataneous metrics to params for retrocompatibility
    relocateExtraneousSpanMetrics(span);

    try {
      spans[index] = spanValidatorSchema.parse(span);
    } catch (error) {
      captureException(new Error("ZodError on parsing spans"), {
        extra: { projectId, span, zodError: error },
      });

      const validationError = fromZodError(error as ZodError);

      logger.error(
        { error, span, projectId, index, validationError },
        "invalid span received",
      );

      return {
        ok: false,
        response: c.json(
          { error: validationError.message + ` at "spans[${index}]"` },
          400,
        ),
      };
    }

    if (spanTimestampsNotInMs(span)) {
      logger.error(
        { traceId, projectId },
        "timestamps not in milliseconds for span",
      );
      return {
        ok: false,
        response: c.json(
          {
            error:
              "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
          },
          400,
        ),
      };
    }
  }
  return { ok: true, spans };
}

// ── fresh-span filtering ─────────────────────────────────────────────

/** Drops spans older than `SPAN_MAX_PAST_MS`, mirroring the OTLP path's age
 *  cutoff so the REST path can't write arbitrarily old cold-partition rows. */
function filterFreshCollectorSpans({
  spans,
  projectId,
  traceId,
}: {
  spans: Span[];
  projectId: string;
  traceId: string;
}): { freshSpans: Span[]; droppedOldSpans: number } {
  // OTLP parity: processSpan drops spans older than SPAN_MAX_PAST_MS before
  // the dedup gate, so apply the same age cutoff here — otherwise the REST
  // path alone would write arbitrarily old timestamps into cold ClickHouse
  // partitions, undermining partition pruning.
  const startedAtCutoff = Date.now() - SPAN_MAX_PAST_MS;
  const freshSpans: Span[] = [];
  let droppedOldSpans = 0;
  for (const span of spans) {
    if (
      span.timestamps.started_at &&
      span.timestamps.started_at < startedAtCutoff
    ) {
      droppedOldSpans++;
      continue;
    }
    freshSpans.push(span);
  }
  if (droppedOldSpans > 0) {
    logger.info(
      { projectId, traceId, droppedOldSpans },
      "dropped spans with start time more than 31 days in the past",
    );
  }
  return { freshSpans, droppedOldSpans };
}

// ── span dispatch ────────────────────────────────────────────────────

/** Dispatches every fresh span to event sourcing, aggregating per-span
 *  failures rather than failing the whole batch on one bad span. */
async function dispatchCollectorSpans({
  freshSpans,
  reservedTraceMetadata,
  customMetadata,
  expectedOutput,
  projectId,
  traceId,
}: {
  freshSpans: Span[];
  reservedTraceMetadata: ReservedTraceMetadata;
  customMetadata: CustomMetadata;
  expectedOutput: CollectorRESTParamsValidator["expected_output"];
  projectId: string;
  traceId: string;
}): Promise<{ dispatchFailures: number; rejectionErrors: string[] }> {
  let dispatchFailures = 0;
  let rejectionErrors: string[] = [];
  try {
    const resource = CollectorSpanUtils.buildResource({
      reservedTraceMetadata,
      customMetadata,
      expectedOutput,
    });

    const results = await Promise.allSettled(
      freshSpans.map((span) =>
        // Route through ingestNormalizedSpan (not recordSpan directly) so the
        // REST collector shares the (tenant, trace, span) dedup gate + ADR-022
        // spool hook with the OTLP path — a retry storm here must not bypass
        // dedup. occurredAt is stamped inside ingestNormalizedSpan.
        getApp().traces.collection.ingestNormalizedSpan({
          tenantId: projectId,
          span: CollectorSpanUtils.convertSpanToOtlp(span),
          resource,
          instrumentationScope: { name: "langwatch.rest.collector" },
          piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
        }),
      ),
    );

    // `ingestNormalizedSpan` catches its own errors and RESOLVES with
    // `{ status: "failed", error }` (it never rejects), so inspect the
    // resolved status — checking the allSettled "rejected" wrapper would
    // count every failure as a success. An unexpected rejection is still
    // treated as a failure defensively. "deduped" is a success, not an error.
    const failureErrors = results
      .map((r) => {
        if (r.status === "rejected") {
          return r.reason instanceof Error
            ? r.reason.message
            : String(r.reason);
        }
        return r.value.status === "failed"
          ? (r.value.error ?? "span ingestion failed")
          : null;
      })
      .filter((e): e is string => e !== null);
    dispatchFailures = failureErrors.length;
    rejectionErrors = failureErrors;
    if (failureErrors.length > 0) {
      logger.error(
        {
          projectId,
          traceId,
          failureCount: failureErrors.length,
          errors: failureErrors,
        },
        "Error dispatching collector spans to event sourcing",
      );
    }
  } catch (error) {
    // Catch synchronous errors (e.g., from buildResource)
    dispatchFailures = freshSpans.length;
    rejectionErrors.push(
      error instanceof Error ? error.message : String(error),
    );
    logger.error(
      { error, projectId, traceId },
      "Error initializing event sourcing dispatch",
    );
  }
  return { dispatchFailures, rejectionErrors };
}

// ── evaluations dispatch ─────────────────────────────────────────────

type CollectorEvaluation = NonNullable<
  CollectorRESTParamsValidator["evaluations"]
>[number];

/** The event-sourcing report payload for one inline evaluation, filling in
 *  the same defaults (id, evaluator id, status) the collector has always
 *  derived when the SDK omits them. */
function buildEvaluationReportPayload({
  evaluation,
  projectId,
  traceId,
  occurredAt,
}: {
  evaluation: CollectorEvaluation;
  projectId: string;
  traceId: string;
  occurredAt: number;
}) {
  const evaluationMD5 = crypto
    .createHash("md5")
    .update(JSON.stringify({ traceId, evaluation }))
    .digest("hex");
  const evaluationId = evaluation.evaluation_id ?? `eval_md5_${evaluationMD5}`;
  const evaluatorId =
    evaluation.evaluator_id ?? evaluationNameAutoslug(evaluation.name);
  const status =
    evaluation.status ?? (evaluation.error ? "error" : "processed");

  return {
    tenantId: projectId,
    evaluationId,
    evaluatorId,
    evaluatorType: "custom" as const,
    evaluatorName: evaluation.name,
    traceId,
    isGuardrail: evaluation.is_guardrail ?? undefined,
    status,
    score: evaluation.score ?? null,
    passed: evaluation.passed ?? null,
    label: evaluation.label ?? null,
    details: evaluation.details ?? null,
    error: evaluation.error?.message ?? null,
    occurredAt,
  };
}

/** Dispatches one evaluation, returning its rejection message on failure so
 *  the caller can tally it without a single evaluation aborting the batch. */
async function dispatchOneEvaluation({
  evaluation,
  projectId,
  traceId,
  occurredAt,
}: {
  evaluation: CollectorEvaluation;
  projectId: string;
  traceId: string;
  occurredAt: number;
}): Promise<string | null> {
  // try/catch per evaluation so one failing dispatch does not silently
  // drop the remaining evaluations; failures are surfaced to the client
  // via partialSuccess.rejectedEvaluations below.
  try {
    await getApp().evaluations.reportEvaluation(
      buildEvaluationReportPayload({
        evaluation,
        projectId,
        traceId,
        occurredAt,
      }),
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { error, projectId, traceId, evaluationName: evaluation.name },
      "Error dispatching REST evaluation to event sourcing",
    );
    return message;
  }
}

/** Dispatches custom SDK evaluations to the event-sourcing evaluation
 *  pipeline, one at a time so a single failure doesn't drop the rest. */
async function dispatchCollectorEvaluations({
  params,
  projectId,
  traceId,
}: {
  params: CollectorRESTParamsValidator;
  projectId: string;
  traceId: string;
}): Promise<{ rejectedEvaluations: number; evaluationErrors: string[] }> {
  let rejectedEvaluations = 0;
  const evaluationErrors: string[] = [];
  if (params.evaluations && params.evaluations.length > 0 && traceId) {
    const occurredAt = Date.now();

    for (const evaluation of params.evaluations) {
      const errorMessage = await dispatchOneEvaluation({
        evaluation,
        projectId,
        traceId,
        occurredAt,
      });
      if (errorMessage !== null) {
        rejectedEvaluations++;
        evaluationErrors.push(errorMessage);
      }
    }
  }
  return { rejectedEvaluations, evaluationErrors };
}

// ── request phase 1: auth + body/params validation ──────────────────

/** Authenticates the request and validates its body down to parsed params,
 *  covering everything before span-specific processing begins. */
async function authenticateAndParseCollectorRequest(c: Context): Promise<
  | {
      ok: true;
      project: CollectorProject;
      body: Record<string, any>;
      params: CollectorRESTParamsValidator;
    }
  | { ok: false; response: Response }
> {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    logger.warn(
      "collector request is not authenticated, no auth token provided",
    );
    return {
      ok: false,
      response: c.json(
        { error: "Unauthorized", message: "Invalid credentials" },
        401,
      ),
    };
  }

  const parsedBody = await parseCollectorRequestBody(c);
  if (!parsedBody.ok) return parsedBody;
  const { body } = parsedBody;

  const auth = await resolveCollectorAuth(c, credentials);
  if (!auth.ok) return auth;
  const { project, resolved } = auth;

  logger.info({ projectId: project.id }, "collector request being processed");

  await enforceCollectorUsageLimit(project);

  migrateLegacyMetadataFields(body);

  const inlineEvalError = validateInlineEvaluations(c, body, project.id);
  if (inlineEvalError) return { ok: false, response: inlineEvalError };

  const parsedParams = parseCollectorParams(c, body, project.id);
  if (!parsedParams.ok) return parsedParams;
  const { params } = parsedParams;

  // Body successfully validated — mark the API key as used if this request was
  // authenticated via API key
  if (resolved.type === "apiKey") {
    tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
  }

  return { ok: true, project, body, params };
}

// ── request phase 2: span shaping + validation ───────────────────────

/** Shapes and validates the request's spans, from the raw params down to
 *  the fresh (non-expired) span batch ready for dispatch. */
async function prepareCollectorSpans(
  c: Context,
  {
    body,
    params,
    projectId,
  }: {
    body: Record<string, any>;
    params: CollectorRESTParamsValidator;
    projectId: string;
  },
): Promise<
  | {
      ok: true;
      traceId: string;
      freshSpans: Span[];
      droppedOldSpans: number;
      reservedTraceMetadata: ReservedTraceMetadata;
      customMetadata: CustomMetadata;
      expectedOutput: CollectorRESTParamsValidator["expected_output"];
    }
  | { ok: false; response: Response }
> {
  const { trace_id: nullableTraceId, expected_output: expectedOutput } = params;

  const shapeError = validateSpansShape(c, {
    body,
    params,
    projectId,
    traceId: nullableTraceId,
  });
  if (shapeError) return { ok: false, response: shapeError };

  const metadataResult = parseTraceMetadata(c, { params, projectId });
  if (!metadataResult.ok) return metadataResult;
  const { reservedTraceMetadata, customMetadata } = metadataResult;

  const spanFields = spanSchema.options.flatMap((option) =>
    Object.keys(option.shape),
  );
  const spans = ((body as Record<string, any>).spans ?? []) as Span[];
  spans.forEach((span) =>
    normalizeCollectorSpan(span, { spanFields, nullableTraceId }),
  );

  const traceIdResult = resolveCollectorTraceId(c, {
    spans,
    nullableTraceId,
    projectId,
  });
  if (!traceIdResult.ok) return traceIdResult;
  const { traceId } = traceIdResult;

  const spanBatchResult = validateAndNormalizeSpanBatch(c, {
    spans,
    projectId,
    traceId,
  });
  if (!spanBatchResult.ok) return spanBatchResult;

  const { freshSpans, droppedOldSpans } = filterFreshCollectorSpans({
    spans,
    projectId,
    traceId,
  });

  return {
    ok: true,
    traceId,
    freshSpans,
    droppedOldSpans,
    reservedTraceMetadata,
    customMetadata,
    expectedOutput,
  };
}

// POST /api/collector
secured
  .access(
    handlerManagedAuth({
      reason: "ingestion API key resolved in-handler",
      // Declared because this is the route it took a colleague "ages" to work
      // out from the code: trace collection is gated by `traces:create`, which
      // was previously discoverable only by reading the handler.
      permissions: ["traces:create"],
      credential: "apiKey",
    }),
  )
  .post(
    "/collector",
    bodyLimit({ maxSize: 10 * 1024 * 1024 }), // 10MB
    async (c) => {
      const authResult = await authenticateAndParseCollectorRequest(c);
      if (!authResult.ok) return authResult.response;
      const { project, body, params } = authResult;

      const prep = await prepareCollectorSpans(c, {
        body,
        params,
        projectId: project.id,
      });
      if (!prep.ok) return prep.response;
      const {
        traceId,
        freshSpans,
        droppedOldSpans,
        reservedTraceMetadata,
        customMetadata,
        expectedOutput,
      } = prep;

      let rejectedSpans = droppedOldSpans;
      let rejectionErrors: string[] =
        droppedOldSpans > 0
          ? [
              `${droppedOldSpans} span(s) dropped: start time is more than 31 days in the past`,
            ]
          : [];

      const dispatchResult = await dispatchCollectorSpans({
        freshSpans,
        reservedTraceMetadata,
        customMetadata,
        expectedOutput,
        projectId: project.id,
        traceId,
      });
      rejectedSpans += dispatchResult.dispatchFailures;
      rejectionErrors = [...rejectionErrors, ...dispatchResult.rejectionErrors];

      // Total ingestion failure: every dispatched span failed (e.g. Redis /
      // group-queue outage). There is no fallback stack, so a 200 here
      // would tell the SDK the trace landed and it would never retry —
      // permanent trace loss. Return 500 so clients retry; the dedup gate
      // releases failed spans via tryReleaseOnFailure, so a retry is safe.
      // Partial success stays 2xx for SDK back-compat.
      if (
        freshSpans.length > 0 &&
        dispatchResult.dispatchFailures === freshSpans.length
      ) {
        return c.json(
          {
            message: `Failed to ingest all ${dispatchResult.dispatchFailures} spans, please retry`,
            partialSuccess: {
              rejectedSpans,
              errorMessage: rejectionErrors.join("; "),
            },
          },
          500,
        );
      }

      // Dispatch custom SDK evaluations to the event-sourcing evaluation pipeline.
      // The REST collector receives evaluations as a separate field (not as span events),
      // so they must be dispatched independently from the spans above.
      const { rejectedEvaluations, evaluationErrors } =
        await dispatchCollectorEvaluations({
          params,
          projectId: project.id,
          traceId,
        });

      return c.json({
        message: "Trace received successfully.",
        partialSuccess: {
          rejectedSpans,
          rejectedEvaluations,
          errorMessage: [...rejectionErrors, ...evaluationErrors].join("; "),
        },
      });
    },
  );

export const app = secured.hono;
