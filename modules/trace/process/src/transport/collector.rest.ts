/**
 * SDK collector: POST /api/collector, one span at a time. Resolves its own
 * project credential. MUST mount before `/api/collector/*` wildcard dispatcher.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import type { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/kernel/module-api";
import { createLogger, validationMeta } from "@langwatch/observability";
import {
  ingestDoorRefusalBody,
  ingestDoorRefusalStatus,
  isIngestDoorRefusal,
  isUnknownCredentialRefusal,
} from "@langwatch/otlp";
import {
  collectorRESTParamsValidatorSchema,
  type CollectorRESTParamsValidator,
  type Span,
} from "@langwatch/trace-contract";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

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
  type CollectorErrorReport,
  type CollectorMetadata,
  type CollectorRejection,
} from "#rules/trace-collector-body.rules";
import {
  TraceCollectorDispatchService,
  type CollectorEvaluationReport,
  type CollectorSpanIngest,
} from "#services/trace-collector-dispatch.service";

const logger = createLogger("langwatch.collector");

const PRODUCES_JSON = "application/json";

const COLLECTOR_PROTOCOL_REASON =
  "Released SDKs parse this door's own statuses and bodies, credential refusals included";

/** The project a collector body is recorded against. */
export type CollectorProject = Readonly<{
  id: string;
  teamId: string;
  organizationId: string;
}>;

/** A resolved credential; a refusal is thrown, and this door renders it. */
export type CollectorCredential = Readonly<{ project: CollectorProject; markUsed: () => void }>;

/** How this process turns a request into a project credential. */
export type CollectorCredentialResolver = (input: {
  request: Request;
}) => Promise<CollectorCredential>;

/**
 * The plan allowance, enforced before the body is reshaped.
 */
export type CollectorUsageLimit = (input: { project: CollectorProject }) => Promise<void>;

/**
 * The whole of what `POST /api/collector` asks the process for. Every
 * member carries the `collector` prefix since one class also answers the
 * legacy `/api/trace/*` and OTLP doors, each with its own credential.
 */
export type CollectorApp = Readonly<{
  collectorCredential: CollectorCredentialResolver;
  /**
   * The plan allowance. Resolves without refusing where no usage meter was
   * composed (no monthly allowance enforced) — a required member because
   * the operations-only proxy throws on a name it doesn't serve.
   */
  collectorUsageLimit: CollectorUsageLimit;
  /** Where a normalized span goes. Required: it is the whole of this door. */
  ingestSpan: CollectorSpanIngest;
  /**
   * Where a custom SDK evaluation goes. Answers that the evaluation was refused
   * where the process registered no evaluation pipeline.
   */
  reportEvaluation: CollectorEvaluationReport;
  /**
   * The evaluator-id slug rule, for an evaluation naming none. Supplied by
   * the process because the rule is EVALUATION's — a feature server package
   * may not reach into another feature's server package.
   */
  deriveEvaluatorId: (name: string) => string;
  collectorReportError: CollectorErrorReport;
}>;

export const CollectorApi = moduleApi<CollectorApp>()("trace");

/** One protocol answer, in the shape `c.json(body, status)` used to write. */
type CollectorAnswer = Readonly<{
  status: ContentfulStatusCode;
  mediaType: typeof PRODUCES_JSON;
  body: string;
}>;

function answer(body: unknown, status: ContentfulStatusCode): CollectorAnswer {
  return { status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) };
}

/**
 * An unknown credential earns the sentence this door has always written; a key we know
 * and refused earns the full handled body — code, permission, tips — not just a sentence.
 */
function refusalAnswer(refusal: HandledError): CollectorAnswer {
  if (isUnknownCredentialRefusal(refusal)) {
    logger.warn("collector request is not authenticated");
    return answer({ error: "Unauthorized", message: "Invalid credentials" }, 401);
  }

  logger.warn("collector request denied by API key ceiling");
  return answer(ingestDoorRefusalBody(refusal), ingestDoorRefusalStatus(refusal));
}

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** The request body as a JSON object, or the refusal reading it earned. */
function readCollectorBody(
  request: Request,
  raw: string,
): Record<string, any> | CollectorRejection {
  // warn, not error: a malformed body is the caller's mistake and we answer
  // it with a 400. These three sites return rather than throw, so they never
  // reach the boundary that would classify them as customer fault, and at
  // error level they were about a fifth of this service's error stream.
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes(PRODUCES_JSON)) {
    logger.warn("collector request body is not json");

    return { rejected: true, body: { message: "Invalid body, expecting json" }, status: 400 };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
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
  input: Readonly<{ projectId: string; reportError?: CollectorErrorReport | undefined }>,
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
  input: Readonly<{ projectId: string; reportError?: CollectorErrorReport | undefined }>,
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
 * Total ingestion failure (e.g. Redis/group-queue outage): no fallback
 * stack, so a 200 would mean permanent trace loss. Return 500 so clients
 * retry; releaseOnFailure makes that safe. Partial success stays 2xx.
 */
async function ingestCollectorBody(input: {
  project: CollectorProject;
  app: CollectorApp;
  params: CollectorRESTParamsValidator;
  prepared: PreparedCollectorBody;
}): Promise<CollectorAnswer> {
  const { project, app, params, prepared } = input;
  const { spans, traceId, metadata } = prepared;

  const dispatch = TraceCollectorDispatchService.create({
    ingestSpan: app.ingestSpan,
    deriveEvaluatorId: app.deriveEvaluatorId,
    reportEvaluation: app.reportEvaluation,
  });

  const { freshSpans, droppedOldSpans, droppedUnstorableSpans } = dispatch.partitionFreshSpans(
    spans,
    {
      projectId: project.id,
      traceId,
    },
  );

  const spanOutcome = await dispatch.dispatchSpans(freshSpans, {
    projectId: project.id,
    traceId,
    droppedOldSpans,
    droppedUnstorableSpans,
    metadata,
    expectedOutput: params.expected_output,
  });

  if (freshSpans.length > 0 && spanOutcome.dispatchFailures === freshSpans.length) {
    return answer(
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
      ? await dispatch.dispatchEvaluations(evaluations, { projectId: project.id, traceId })
      : { rejectedEvaluations: 0, evaluationErrors: [] };

  return answer(
    {
      message: "Trace received successfully.",
      partialSuccess: {
        rejectedSpans: spanOutcome.rejectedSpans,
        rejectedEvaluations: evaluationOutcome.rejectedEvaluations,
        errorMessage: [...spanOutcome.rejectionErrors, ...evaluationOutcome.evaluationErrors].join(
          "; ",
        ),
      },
    },
    200,
  );
}

/** The whole of one `POST /api/collector` request, from the credential to the answer. */
async function collect({
  app,
  request,
  raw,
}: {
  app: CollectorApp;
  request: Request;
  raw: string;
}): Promise<CollectorAnswer> {
  let auth: CollectorCredential;
  try {
    auth = await app.collectorCredential({ request });
  } catch (error) {
    if (!isIngestDoorRefusal(error)) throw error;
    return refusalAnswer(error);
  }

  const body = readCollectorBody(request, raw);
  if (isCollectorRejection(body)) return answer(body.body, body.status);

  const project = auth.project;

  logger.info({ projectId: project.id }, "collector request being processed");

  // The allowance refuses by throwing; every other outcome — including a
  // lookup that failed inside the port — lets the batch through.
  await app.collectorUsageLimit({ project });

  const params = parseCollectorParams(body, {
    projectId: project.id,
    reportError: app.collectorReportError,
  });
  if (isCollectorRejection(params)) return answer(params.body, params.status);

  // Body successfully validated — mark the API key as used if this request was
  // authenticated via API key
  auth.markUsed();

  const prepared = prepareCollectorBody(body, params, {
    projectId: project.id,
    reportError: app.collectorReportError,
  });
  if (isCollectorRejection(prepared)) return answer(prepared.body, prepared.status);

  return ingestCollectorBody({ project, app, params, prepared });
}

export const collectorRest = defineRestRouter(CollectorApi)
  .withNamespace("collector")
  .withVersion(MANAGEMENT_API_VERSION)
  // The one address a released SDK posts to, with no `/api/v1` twin beside it.
  .withAddressing("literal", { v1Twin: false })

  .post("/api/collector", "collectTrace")
  // The body is the evidence: it is read once, checked against the content type
  // this family has always demanded, and parsed by the family's own rules so a
  // malformed payload earns the sentence a deployed SDK already parses.
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(
    publicRoute({
      reason:
        "Trace collection API key resolved in-handler, so the refusal carries the credential chain's own body; the route itself is gated on traces:create",
    }),
  )
  .withBodyLimit({ maxBytes: COLLECTOR_MAX_BODY_BYTES, onExceeded: payloadTooLarge })
  .withResponse("protocol", { produces: PRODUCES_JSON, because: COLLECTOR_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) =>
    response.write(await collect({ app, request, raw })),
  )

  .build();
