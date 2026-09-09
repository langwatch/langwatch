/**
 * The REST collector: `POST /api/collector`. Was `platform/app/src/server/routes/collector.ts`.
 */
import { bodyLimit, type AppRestSecurity, type SecuredApp } from "@langwatch/api/rest";
import { handlerManagedAuth } from "@langwatch/api";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  collectorRESTParamsValidatorSchema,
  DEFAULT_PII_REDACTION_LEVEL,
  type CollectorRESTParamsValidator,
  type Span,
} from "@langwatch/trace-contract";

import type { TraceCollectorSpanService } from "#services/trace-collector-span.service";

import {
  applyLegacyMetadataFields,
  applyLegacySpanFields,
  COLLECTOR_MAX_BODY_BYTES,
  findEvaluationRejection,
  findEvaluationsCapRejection,
  findSpanRejection,
  findSpansShapeRejection,
  isCollectorRejection,
  parseCollectorMetadata,
  resolveTraceId,
  type CollectorMetadata,
  type CollectorRejection,
} from "./collector-body.api.ts";
import { dispatchEvaluations, dispatchSpans, partitionFreshSpans } from "./collector-dispatch.api.ts";

const logger = createLogger("langwatch.collector");

/** The project a collector body is recorded against. */
export type CollectorProject = Readonly<{
  id: string;
  teamId: string;
  organizationId: string;
}>;

/**
 * A resolved credential, or why it was refused. The two refusals are told apart rather than
 * passed through as one body, because their copy comes from two different places.
 */
export type CollectorCredential =
  | Readonly<{ ok: true; project: CollectorProject; markUsed: () => void }>
  | Readonly<{ ok: false; kind: "credential" }>
  | Readonly<{ ok: false; kind: "ceiling"; status: ContentfulStatusCode; body: object }>;

/** How this process turns a request into a project credential. */
export type CollectorCredentialPort = (input: { request: Request }) => Promise<CollectorCredential>;

/**
 * The plan allowance, enforced before the body is reshaped.
 */
export type CollectorUsageLimitPort = (input: { project: CollectorProject }) => Promise<void>;

/** One already-normalized span, handed to the ingestion pipeline. */
export type CollectorSpanIngestPort = (input: {
  tenantId: string;
  span: ReturnType<typeof TraceCollectorSpanService.convertSpanToOtlp>;
  resource: ReturnType<typeof TraceCollectorSpanService.buildResource>;
  instrumentationScope: Readonly<{ name: string }>;
  piiRedactionLevel: typeof DEFAULT_PII_REDACTION_LEVEL;
}) => Promise<Readonly<{ status: string; error?: string | undefined }>>;

/** One custom SDK evaluation, reported to the evaluation pipeline. */
export type CollectorEvaluationReportPort = (input: {
  tenantId: string;
  evaluationId: string;
  evaluatorId: string;
  evaluatorType: string;
  evaluatorName: string;
  traceId: string;
  isGuardrail?: boolean | undefined;
  status: string;
  score: number | null;
  passed: boolean | null;
  label: string | null;
  details: string | null;
  error: string | null;
  occurredAt: number;
}) => Promise<unknown>;

/** Reports a failure the collector answered but did not raise. */
export type CollectorErrorReportPort = (
  error: Error,
  context: Readonly<{ projectId: string; traceId?: string | undefined }>,
) => void;

export type CollectorRestPorts = Readonly<{
  credential: CollectorCredentialPort;
  /**
   * The plan allowance, or none. None where the process composed no usage meter, and then no
   * monthly allowance is enforced.
   */
  usageLimit?: CollectorUsageLimitPort | undefined;
  /** Where a normalized span goes. Required: it is the whole of this door. */
  ingestSpan: CollectorSpanIngestPort;
  /**
   * Where a custom SDK evaluation goes, or none. None where the process registered no
   * evaluation pipeline.
   */
  reportEvaluation?: CollectorEvaluationReportPort | undefined;
  /**
   * The evaluator-id slug rule, for an evaluation that names no evaluator. A port because the
   * rule is EVALUATION's — the same one its own `custom-evaluation-sync` subscriber applies —
   * and a feature server package may not reach into another feature's server package.
   */
  deriveEvaluatorId: (name: string) => string;
  reportError?: CollectorErrorReportPort | undefined;
}>;

/** The request body as a JSON object, or the refusal reading it earned. */
async function readCollectorBody(
  request: Readonly<{ header: (name: string) => string | undefined; json: () => Promise<unknown> }>,
): Promise<Record<string, any> | CollectorRejection> {
  // warn, not error: a malformed body is the caller's mistake and we answer
  // it with a 400. These three sites return rather than throw, so they never
  // reach the boundary that would classify them as customer fault, and at
  // error level they were about a fifth of this service's error stream.
  const contentType = request.header("content-type");
  if (!contentType?.includes("application/json")) {
    logger.warn("collector request body is not json");

    return { rejected: true, body: { message: "Invalid body, expecting json" }, status: 400 };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn("collector request body is not valid json");

    return { rejected: true, body: { message: "Invalid body, expecting json" }, status: 400 };
  }

  // `typeof null` is "object" and an array is one too, so both walk past a
  // bare typeof check and reach `"metadata" in body` below — which throws on
  // null. That is the same customer mistake as the two guards above, so it
  // belongs on the same 400 rather than in the error stream as a 500.
  if (body === null || Array.isArray(body) || typeof body !== "object") {
    logger.warn("collector request body is not a json object");

    return { rejected: true, body: { message: "Invalid body, expecting json" }, status: 400 };
  }

  return body as Record<string, any>;
}

/** The legacy rewrites, the evaluation refusals, and the schema the whole body must satisfy. */
function parseCollectorParams(
  body: Record<string, any>,
  input: Readonly<{ projectId: string; reportError?: CollectorErrorReportPort | undefined }>,
): CollectorRESTParamsValidator | CollectorRejection {
  applyLegacyMetadataFields(body);

  const refusedEvaluation = findEvaluationRejection(body, input.projectId);
  if (refusedEvaluation) return refusedEvaluation;

  try {
    return collectorRESTParamsValidatorSchema.parse(body);
  } catch (error) {
    const validation = validationMeta(error);

    input.reportError?.(new Error("ZodError on parsing body"), { projectId: input.projectId });

    const validationError = fromZodError(error as ZodError);

    // Shape, never the body. The rendered `validationError.message` quotes
    // the offending values, so it answers the sender and stays out of the
    // log; `validation` is the schema's own vocabulary and is what tells us
    // whether the rule, rather than the payload, is the thing that is wrong.
    logger.warn({ projectId: input.projectId, ...validation }, "invalid trace received");

    return { rejected: true, body: { error: validationError.message }, status: 400 };
  }
}

/** A validated body's spans, the one trace they belong to, and the metadata they carry. */
type PreparedCollectorBody = Readonly<{
  spans: Span[];
  traceId: string;
  metadata: CollectorMetadata;
}>;

function prepareCollectorBody(
  body: Record<string, any>,
  params: CollectorRESTParamsValidator,
  input: Readonly<{ projectId: string; reportError?: CollectorErrorReportPort | undefined }>,
): PreparedCollectorBody | CollectorRejection {
  const { projectId } = input;
  const nullableTraceId = params.trace_id;

  const refusedShape = findSpansShapeRejection(body, { projectId, traceId: nullableTraceId });
  if (refusedShape) return refusedShape;

  const refusedCap = findEvaluationsCapRejection(params, { projectId, traceId: nullableTraceId });
  if (refusedCap) return refusedCap;

  const metadata = parseCollectorMetadata(params, input);
  if (isCollectorRejection(metadata)) return metadata;

  const spans = (body.spans ?? []) as Span[];
  applyLegacySpanFields(spans, nullableTraceId);

  const traceId = resolveTraceId(spans, { projectId, nullableTraceId });
  if (isCollectorRejection(traceId)) return traceId;

  const refusedSpan = findSpanRejection(spans, { ...input, traceId });
  if (refusedSpan) return refusedSpan;

  return { spans, traceId, metadata };
}

/**
 * Total ingestion failure: every dispatched span failed (e.g. Redis / group-queue outage). There
 * is no fallback stack, so a 200 here would tell the SDK the trace landed and it would never
 * retry — permanent trace loss. Return 500 so clients retry; the dedup gate releases failed spans
 * via releaseOnFailure, so a retry is safe. Partial success stays 2xx for SDK back-compat.
 */
async function ingestCollectorBody(
  context: Readonly<{ json: (body: object, status?: ContentfulStatusCode) => Response }>,
  input: Readonly<{
    project: CollectorProject;
    ports: CollectorRestPorts;
    params: CollectorRESTParamsValidator;
    prepared: PreparedCollectorBody;
  }>,
): Promise<Response> {
  const { project, ports, params, prepared } = input;
  const { spans, traceId, metadata } = prepared;

  const { freshSpans, droppedOldSpans } = partitionFreshSpans(spans, {
    projectId: project.id,
    traceId,
  });

  const spanOutcome = await dispatchSpans(freshSpans, {
    projectId: project.id,
    traceId,
    droppedOldSpans,
    metadata,
    expectedOutput: params.expected_output,
    ingestSpan: ports.ingestSpan,
  });

  if (freshSpans.length > 0 && spanOutcome.dispatchFailures === freshSpans.length) {
    return context.json(
      {
        message: `Failed to ingest all ${spanOutcome.dispatchFailures} spans, please retry`,
        partialSuccess: {
          rejectedSpans: spanOutcome.rejectedSpans,
          errorMessage: spanOutcome.rejectionErrors.join("; "),
        },
      },
      500,
    );
  }

  const evaluations = params.evaluations ?? [];
  const evaluationOutcome =
    evaluations.length > 0
      ? await dispatchEvaluations(evaluations, {
          projectId: project.id,
          traceId,
          deriveEvaluatorId: ports.deriveEvaluatorId,
          reportEvaluation: ports.reportEvaluation,
        })
      : { rejectedEvaluations: 0, evaluationErrors: [] };

  return context.json({
    message: "Trace received successfully.",
    partialSuccess: {
      rejectedSpans: spanOutcome.rejectedSpans,
      rejectedEvaluations: evaluationOutcome.rejectedEvaluations,
      errorMessage: [...spanOutcome.rejectionErrors, ...evaluationOutcome.evaluationErrors].join(
        "; ",
      ),
    },
  });
}

/**
 * The REST collector, built against one process's security. `/api/collector` is a literal path
 * nothing else claims, but it MUST be registered before the OTLP path-alias re-dispatcher,
 * which claims `/api/collector/*` with a wildcard.
 */
export function createCollectorRestApp(options: {
  security: AppRestSecurity;
  ports: CollectorRestPorts;
}): SecuredApp<Env> {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

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
    .post("/collector", bodyLimit({ maxSize: COLLECTOR_MAX_BODY_BYTES }), async (c) => {
      const auth = await ports.credential({ request: c.req.raw });
      if (!auth.ok) {
        if (auth.kind === "ceiling") {
          logger.warn("collector request denied by API key ceiling");
          // The full handled body — code, permission, tips — not just a sentence.
          return c.json(auth.body, auth.status);
        }
        logger.warn("collector request is not authenticated");
        return c.json({ error: "Unauthorized", message: "Invalid credentials" }, 401);
      }

      const body = await readCollectorBody(c.req);
      if (isCollectorRejection(body)) return c.json(body.body, body.status);

      const project = auth.project;

      logger.info({ projectId: project.id }, "collector request being processed");

      // The allowance refuses by throwing; every other outcome — including a
      // lookup that failed inside the port — lets the batch through.
      await ports.usageLimit?.({ project });

      const params = parseCollectorParams(body, {
        projectId: project.id,
        reportError: ports.reportError,
      });
      if (isCollectorRejection(params)) return c.json(params.body, params.status);

      // Body successfully validated — mark the API key as used if this request was
      // authenticated via API key
      auth.markUsed();

      const prepared = prepareCollectorBody(body, params, {
        projectId: project.id,
        reportError: ports.reportError,
      });
      if (isCollectorRejection(prepared)) return c.json(prepared.body, prepared.status);

      return await ingestCollectorBody(c, { project, ports, params, prepared });
    });

  return secured;
}
