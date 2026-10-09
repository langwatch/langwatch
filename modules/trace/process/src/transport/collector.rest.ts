/**
 * SDK collector: POST /api/collector, one span at a time. Resolves its own
 * project credential. MUST mount before `/api/collector/*` wildcard dispatcher.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
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
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z, type ZodError } from "zod";
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
  type CollectorBody,
  type CollectorErrorReport,
  type CollectorIngestInput,
  type CollectorIngestOutcome,
  type CollectorMetadata,
  type CollectorRejection,
} from "#features/ingestion/rules/trace-collector-body.rules";

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
  /** Dispatches a validated body's spans and evaluations; the whole of this door. */
  collectorIngest: (input: CollectorIngestInput) => Promise<CollectorIngestOutcome>;
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

/**
 * The plan limit in main's flat body at both ingest doors: a terminal 402 an SDK stops on.
 * Every other failure stays on the family's boundary.
 */
export const ingestPlanLimitRefusal: RestProtocolRefusal = ({ failure, response }) =>
  HandledError.isHandled(failure) && failure.code === "ERR_PLAN_LIMIT"
    ? response.write({
        status: failure.httpStatus ?? 402,
        mediaType: PRODUCES_JSON,
        body: JSON.stringify(ingestDoorRefusalBody(failure)),
      })
    : response.decline();

/** The legacy rewrites, the evaluation refusals, and the schema the whole body must satisfy. */
function parseCollectorParams(
  body: CollectorBody,
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
  body: CollectorBody,
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

async function ingestCollectorBody(input: {
  project: CollectorProject;
  app: CollectorApp;
  params: CollectorRESTParamsValidator;
  prepared: PreparedCollectorBody;
}): Promise<CollectorAnswer> {
  const { project, app, params, prepared } = input;

  const outcome = await app.collectorIngest({
    projectId: project.id,
    traceId: prepared.traceId,
    spans: prepared.spans,
    metadata: prepared.metadata,
    expectedOutput: params.expected_output,
    evaluations: params.evaluations ?? [],
  });

  if (outcome.kind === "failed") {
    return answer(
      {
        message: `Failed to ingest all ${outcome.spans.dispatchFailures} spans, please retry`,
        partialSuccess: {
          rejectedSpans: outcome.spans.rejectedSpans,
          errorMessage: outcome.spans.rejectionErrors.join("; "),
        },
      },
      500,
    );
  }

  return answer(
    {
      message: "Trace received successfully.",
      partialSuccess: {
        rejectedSpans: outcome.spans.rejectedSpans,
        rejectedEvaluations: outcome.evaluations.rejectedEvaluations,
        errorMessage: [
          ...outcome.spans.rejectionErrors,
          ...outcome.evaluations.evaluationErrors,
        ].join("; "),
      },
    },
    200,
  );
}

/** The whole of one `POST /api/collector` request, from the credential to the answer. */
async function collect({
  app,
  request,
  body,
}: {
  app: CollectorApp;
  request: Request;
  body: CollectorBody;
}): Promise<CollectorAnswer> {
  let auth: CollectorCredential;
  try {
    auth = await app.collectorCredential({ request });
  } catch (error) {
    if (!isIngestDoorRefusal(error)) throw error;
    return refusalAnswer(error);
  }

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
  .servesWhileUpgrading()
  .withInput(z.looseObject({}), { mediaType: PRODUCES_JSON, mismatch: "malformed_request" })
  .withAccess(
    publicRoute({
      reason:
        "Trace collection API key resolved in-handler, so the refusal carries the credential chain's own body; the route itself is gated on traces:create",
    }),
  )
  .withBodyLimit({ maxBytes: COLLECTOR_MAX_BODY_BYTES })
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: COLLECTOR_PROTOCOL_REASON,
    refusal: ingestPlanLimitRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request, response }) =>
    response.write(await collect({ app, request, body: input })),
  )

  .build();
