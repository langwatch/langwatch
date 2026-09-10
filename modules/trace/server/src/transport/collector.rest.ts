/**
 * The SDK collector: `POST /api/collector`, one already-normalized span at a
 * time. Declared public because the door resolves its own project-scoped
 * credential through `app.credential` (the process's
 * `ApiHandlerManagedCredentials`, composed in `api-trace-ingest.composition.ts`)
 * rather than the framework's project-key door: the refusal an SDK's own copy
 * quotes is this family's sentence, which a declared `project` door does not
 * let a route choose.
 *
 * `/api/collector` is a literal path nothing else claims, but it MUST be
 * mounted before the OTLP path-alias re-dispatcher, which claims
 * `/api/collector/*` with a wildcard.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { createLogger, validationMeta } from "@langwatch/observability";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { moduleApi } from "@langwatch/runtime-composition";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  collectorRESTParamsValidatorSchema,
  type CollectorRESTParamsValidator,
  type Span,
} from "@langwatch/trace-contract";

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
export type CollectorCredentialResolver = (input: {
  request: Request;
}) => Promise<CollectorCredential>;

/**
 * The plan allowance, enforced before the body is reshaped.
 */
export type CollectorUsageLimit = (input: { project: CollectorProject }) => Promise<void>;

/** The whole of what `POST /api/collector` asks the process for. */
export type CollectorApp = Readonly<{
  credential: CollectorCredentialResolver;
  /**
   * The plan allowance, or none. None where the process composed no usage meter, and then no
   * monthly allowance is enforced.
   */
  usageLimit?: CollectorUsageLimit | undefined;
  /** Where a normalized span goes. Required: it is the whole of this door. */
  ingestSpan: CollectorSpanIngest;
  /**
   * Where a custom SDK evaluation goes, or none. None where the process registered no
   * evaluation pipeline.
   */
  reportEvaluation?: CollectorEvaluationReport | undefined;
  /**
   * The evaluator-id slug rule, for an evaluation that names no evaluator. Supplied by the
   * process because the rule is EVALUATION's — the same one its own `custom-evaluation-sync`
   * subscriber applies — and a feature server package may not reach into another feature's
   * server package.
   */
  deriveEvaluatorId: (name: string) => string;
  reportError?: CollectorErrorReport | undefined;
}>;

export const CollectorApi = moduleApi<CollectorApp>("trace");

/** One answer, in the shape `c.json(body, status)` used to write. */
function answer(body: unknown, status: ContentfulStatusCode): RestRawResult {
  return {
    status,
    headers: { "content-type": PRODUCES_JSON },
    body: JSON.stringify(body),
  };
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
 * Total ingestion failure: every dispatched span failed (e.g. Redis / group-queue outage). There
 * is no fallback stack, so a 200 here would tell the SDK the trace landed and it would never
 * retry — permanent trace loss. Return 500 so clients retry; the dedup gate releases failed spans
 * via releaseOnFailure, so a retry is safe. Partial success stays 2xx for SDK back-compat.
 */
async function ingestCollectorBody(input: {
  project: CollectorProject;
  app: CollectorApp;
  params: CollectorRESTParamsValidator;
  prepared: PreparedCollectorBody;
}): Promise<RestRawResult> {
  const { project, app, params, prepared } = input;
  const { spans, traceId, metadata } = prepared;

  const dispatch = TraceCollectorDispatchService.create({
    ingestSpan: app.ingestSpan,
    deriveEvaluatorId: app.deriveEvaluatorId,
    ...(app.reportEvaluation ? { reportEvaluation: app.reportEvaluation } : {}),
  });

  const { freshSpans, droppedOldSpans } = dispatch.partitionFreshSpans(spans, {
    projectId: project.id,
    traceId,
  });

  const spanOutcome = await dispatch.dispatchSpans(freshSpans, {
    projectId: project.id,
    traceId,
    droppedOldSpans,
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
}): Promise<RestRawResult> {
  const auth = await app.credential({ request });
  if (!auth.ok) {
    if (auth.kind === "ceiling") {
      logger.warn("collector request denied by API key ceiling");
      // The full handled body — code, permission, tips — not just a sentence.
      return answer(auth.body, auth.status);
    }
    logger.warn("collector request is not authenticated");

    return answer({ error: "Unauthorized", message: "Invalid credentials" }, 401);
  }

  const body = readCollectorBody(request, raw);
  if (isCollectorRejection(body)) return answer(body.body, body.status);

  const project = auth.project;

  logger.info({ projectId: project.id }, "collector request being processed");

  // The allowance refuses by throwing; every other outcome — including a
  // lookup that failed inside the port — lets the batch through.
  await app.usageLimit?.({ project });

  const params = parseCollectorParams(body, {
    projectId: project.id,
    ...(app.reportError ? { reportError: app.reportError } : {}),
  });
  if (isCollectorRejection(params)) return answer(params.body, params.status);

  // Body successfully validated — mark the API key as used if this request was
  // authenticated via API key
  auth.markUsed();

  const prepared = prepareCollectorBody(body, params, {
    projectId: project.id,
    ...(app.reportError ? { reportError: app.reportError } : {}),
  });
  if (isCollectorRejection(prepared)) return answer(prepared.body, prepared.status);

  return await ingestCollectorBody({ project, app, params, prepared });
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
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(({ app, raw, request }) => collect({ app, request, raw }))

  .build();
