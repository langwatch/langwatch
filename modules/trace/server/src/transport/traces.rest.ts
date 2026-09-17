/**
 * /api/traces: v1 trace reads (search, get-by-id, transcript, metadata PATCH).
 * Route order load-bearing: register :traceId sub-resources before bare :traceId.
 */
import { TraceFormattingService } from "#services/trace-formatting.service";
import { TraceReadableSpanService } from "#services/trace-readable-span.service";
import { TraceProjectionCompileService } from "#services/projection/trace-projection-compile.service";
import { AmbiguousTraceIdPrefixError } from "#services/trace-legacy-read.service";
import { enrichTracesWithEvaluations } from "#rules/trace-evaluation-enrichment.rules";
import {
  badRequestSchema,
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  RequestValidationError,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  TraceApi,
  TraceIdAmbiguousError,
  TraceNotFoundError,
  ProjectionValidationError,
  traceFormatQuerySchema,
  traceIdParamsSchema,
  traceAmbiguousPrefixBodySchema,
  traceDetailResponseSchema,
  traceMetadataBodySchema,
  traceMetadataResponseSchema,
  traceNotFoundBodySchema,
  traceSearchBodyExtensions,
  traceSearchBodySchema,
  traceSearchResponseSchema,
  tracesRestCredentialSchema,
  transcriptResponseSchema,
  type CompiledProjection,
  type Protections,
  type ProjectableTrace,
  type Trace,
  type TraceSearchBody,
} from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { toEpochMs } from "@langwatch/time";

const logger = createLogger("langwatch:api:traces");

/**
 * The page a search answers when the caller named no size: the registry's
 * free-tier bound, the same default this route always had. An explicit size
 * is clamped to the caller's tier by the application, not here.
 */
const DEFAULT_TRACES_PAGE_SIZE = resolveRequestBound("tracesPageSizeMax", "FREE");

/** The credential a route reads: an API key's own id, and the member it acts as. */
export const tracesRestCredential = defineRestMiddleware(
  "tracesRestCredential",
  tracesRestCredentialSchema,
);
/** Written out because the search route writes its own body, so no output schema speaks for it. */
const SHARED_ERROR_ANSWERS = documentedResponses({
  400: badRequestSchema,
  401: badRequestSchema,
  422: badRequestSchema,
  500: badRequestSchema,
});

/** The one trace a `:traceId` route names, or the two errors it maps to. */
async function readOneTraceOrThrow(input: {
  app: TraceApi;
  projectId: string;
  traceId: string;
  protections: unknown;
  withEditOverlay?: boolean;
}): Promise<Trace> {
  let trace: Trace | undefined;
  try {
    trace = await input.app.findTrace({
      projectId: input.projectId,
      traceId: input.traceId,
      protections: input.protections,
      ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
    });
  } catch (err) {
    if (err instanceof AmbiguousTraceIdPrefixError) {
      throw new TraceIdAmbiguousError(input.traceId, err.candidateTraceIds);
    }
    throw err;
  }
  if (!trace) throw new TraceNotFoundError(input.traceId);
  return trace;
}

function formatTraceRow(
  trace: Trace,
  input: { app: TraceApi; format: string; projectSlug: string },
): unknown {
  const platformUrl = input.app.platformUrl({
    projectSlug: input.projectSlug,
    path: `/traces/${trace.trace_id}`,
  });
  if (input.format === "digest") {
    return {
      trace_id: trace.trace_id,
      formatted_trace: TraceFormattingService.formatTraceSummaryDigest(trace),
      input: trace.input,
      output: trace.output,
      timestamps: trace.timestamps,
      metadata: trace.metadata,
      error: trace.error,
      evaluations: trace.evaluations,
      platformUrl,
    };
  }
  return { ...trace, platformUrl };
}

function serializeTraceRows(
  traces: Trace[],
  serializeTrace: (trace: Trace) => unknown,
): Readonly<{ serializedTraces: string[]; skippedCount: number }> {
  const serializedTraces: string[] = [];
  let skippedCount = 0;
  for (const trace of traces) {
    try {
      serializedTraces.push(JSON.stringify(serializeTrace(trace)));
    } catch (err) {
      skippedCount++;
      logger.error(
        { traceId: trace.trace_id, error: err instanceof Error ? err.message : err },
        "Failed to serialize trace, skipping",
      );
    }
  }
  return { serializedTraces, skippedCount };
}

function streamSearchEnvelope(
  serializedTraces: string[],
  pagination: string,
  schemaSuffix: string,
): string {
  return `{"traces":[${serializedTraces.join(",")}],"pagination":${pagination}${schemaSuffix}}`;
}

function coerceToEpochOrThrow(value: unknown, field: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = toEpochMs(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new RequestValidationError({
    target: "json",
    violations: [{ field, type: "invalid_type", message: "Invalid date", received: value }],
  });
}

function compileRequestedProjection({
  from,
  select,
  protections,
}: {
  from: TraceSearchBody["from"];
  select?: string[] | undefined;
  protections: Protections;
}): Readonly<{ projection?: CompiledProjection }> {
  if (!select) return {};

  try {
    return {
      projection: TraceProjectionCompileService.compileProjection({
        from,
        select,
        protections,
      }),
    };
  } catch (err) {
    if (err instanceof ProjectionValidationError) {
      throw new RequestValidationError({
        target: "json",
        violations: err.invalidPaths.map((path) => ({
          field: "select",
          type: "unknown_path",
          message: `Unknown or unsupported select path: ${path}`,
          received: path,
        })),
      });
    }
    throw err;
  }
}

function resolveTraceFormat({
  format,
  llmMode,
}: {
  format?: string | undefined;
  llmMode?: boolean | string | undefined;
}): "digest" | "json" {
  if (format === "digest") return "digest";
  if (format === "json") return "json";
  if (llmMode === true || llmMode === "true" || llmMode === "1") return "digest";
  return "json";
}

/** What a caller supplies beyond `TraceApi` itself; both members may be absent. */
export type TracesRestOptions = Readonly<{
  /** Absent where the process registered no command queue; the route is not registered at all. */
  updateTraceMetadata?:
    | ((
        input: Readonly<{ projectId: string; traceId: string; metadata: unknown }>,
      ) => Promise<void>)
    | undefined;
  /** Absent when coding-agent session store not composed; route unregistered. */
  readCodingAgentTranscript?:
    | ((
        input: Readonly<{
          projectId: string;
          traceId: string;
          occurredAtMs: number;
          protections: unknown;
        }>,
      ) => Promise<unknown>)
    | undefined;
}>;

/** The `/api/traces` and `/api/v1/traces` family. */
export function createTracesRest(options: TracesRestOptions = {}): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<TraceApi>;
}> {
  const { updateTraceMetadata, readCodingAgentTranscript } = options;

  let router = defineRestRouter(TraceApi)
    .withNamespace("traces")
    .withVersion(MANAGEMENT_API_VERSION)

    .post("/search", "searchTraces")
    .withInput(traceSearchBodySchema)
    .withPermission("traces:view")
    .withRawResponse({ produces: "application/json" })
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({
      description: "Search traces for a project",
      responses: {
        200: {
          description: "Matching traces with pagination",
          content: { "application/json": { schema: resolver(traceSearchResponseSchema) } },
        },
        ...SHARED_ERROR_ANSWERS,
      },
    })
    .handle(async ({ app, input, scope }, project, caller): Promise<Response> => {
      const params = traceSearchBodySchema.parse(input);
      const {
        from,
        select,
        dateField,
        format: formatParam,
        includeSpans,
        llmMode,
        scrollId,
        startDate,
        endDate,
        pageSize: rawPageSize,
        ...searchFields
      } = params;
      const format = resolveTraceFormat({ format: formatParam, llmMode });

      logger.info({ projectId: scope.id }, "Searching traces for project");

      const pageSize = rawPageSize ?? DEFAULT_TRACES_PAGE_SIZE;
      const protections = await app.resolveApiKeyProtections({
        projectId: scope.id,
        apiKeyId: caller.apiKeyId,
        userId: caller.userId,
      });

      const { projection } = compileRequestedProjection({ from, select, protections });

      const results = await app.listTraces({
        query: {
          ...searchFields,
          projectId: scope.id,
          startDate: coerceToEpochOrThrow(startDate, "startDate"),
          endDate: coerceToEpochOrThrow(endDate, "endDate"),
          pageSize,
        } as never,
        protections,
        options: {
          downloadMode: true,
          includeSpans: includeSpans ?? false,
          scrollId: scrollId ?? undefined,
          dateField,
          ...(projection ? { projection: projection.plan } : {}),
        },
      });

      const enrichedTraces = enrichTracesWithEvaluations({
        traces: results.groups.flat() as Trace[],
        traceChecks: results.traceChecks,
      });

      const serializeTrace = projection
        ? (trace: Trace) => projection!.project(trace as unknown as ProjectableTrace)
        : (trace: Trace) =>
            formatTraceRow(trace, { app, format, projectSlug: project.projectSlug });

      const { serializedTraces, skippedCount } = serializeTraceRows(enrichedTraces, serializeTrace);

      const pagination = JSON.stringify({
        totalHits: results.totalHits,
        scrollId: results.scrollId,
        ...(skippedCount > 0 ? { skipped: skippedCount } : {}),
        ...(results.updatedThrough !== undefined ? { updatedThrough: results.updatedThrough } : {}),
      });
      const schemaSuffix = projection ? `,"schema":${JSON.stringify(projection.schema)}` : "";

      return new Response(streamSearchEnvelope(serializedTraces, pagination, schemaSuffix), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

  // GET /:traceId/transcript - registered only where the process composed the
  // coding-agent join it reads.
  if (readCodingAgentTranscript) {
    router = router
      .get("/:traceId/transcript", "getTraceTranscript")
      .withParams(traceIdParamsSchema)
      .withPermission("traces:view")
      .withOutput(transcriptResponseSchema.passthrough())
      .withMiddleware(projectRestFacts, tracesRestCredential)
      .withDocs({
        description:
          "Derived coding-agent transcript for a trace: what the agent did, in order, " +
          "with per-call token and cost economics. Empty entries for traces without " +
          "coding-agent content.",
      })
      .handle(async ({ app, input, scope }, _project, caller) => {
        const { traceId } = input;
        logger.info({ projectId: scope.id, traceId }, "Getting trace transcript");

        const protections = await app.resolveApiKeyProtections({
          projectId: scope.id,
          apiKeyId: caller.apiKeyId,
          userId: caller.userId,
        });
        const trace = await readOneTraceOrThrow({ app, projectId: scope.id, traceId, protections });

        return readCodingAgentTranscript({
          projectId: scope.id,
          traceId: trace.trace_id,
          occurredAtMs: trace.timestamps.started_at,
          protections,
        }) as never;
      });
  }

  // PATCH /:traceId/metadata - registered only where the process registered a
  // command queue for the amendment.
  if (updateTraceMetadata) {
    router = router
      .patch("/:traceId/metadata", "updateTraceMetadata")
      .withParams(traceIdParamsSchema)
      .withInput(traceMetadataBodySchema)
      .withPermission("traces:update")
      .withOutput(traceMetadataResponseSchema)
      .withDocs({
        description:
          "Update metadata on a trace after creation. Inserts a synthetic span carrying the new " +
          "attributes through the standard ingestion pipeline. New keys are added, existing keys " +
          "are updated, missing keys are preserved. Labels replace entirely.",
      })
      .handle(async ({ input, scope }) => {
        const { traceId } = input;
        await updateTraceMetadata({ projectId: scope.id, traceId, metadata: input.metadata });
        return { traceId };
      });
  }

  // GET /:traceId - LAST of the three, so the two literal sub-resources above
  // are not swallowed by the parameter.
  router = router
    .get("/:traceId", "getTrace")
    .withParams(traceIdParamsSchema)
    .withQuery(traceFormatQuerySchema)
    .withPermission("traces:view")
    .withOutput(traceDetailResponseSchema)
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({
      description: "Get a single trace by ID.",
      responses: {
        200: {
          description: "Trace detail with spans, evaluations, and ASCII tree",
          content: { "application/json": { schema: resolver(traceDetailResponseSchema) } },
        },
        ...SHARED_ERROR_ANSWERS,
        404: {
          description: "Trace not found",
          content: { "application/json": { schema: resolver(traceNotFoundBodySchema) } },
        },
        409: {
          description: "Ambiguous trace ID prefix \u2014 the prefix matches more than one trace",
          content: { "application/json": { schema: resolver(traceAmbiguousPrefixBodySchema) } },
        },
      },
    })
    .handle(async ({ app, input, scope }, project, caller) => {
      const { traceId } = input;
      const format = resolveTraceFormat({ format: input.format, llmMode: input.llmMode });

      logger.info({ projectId: scope.id, traceId }, "Getting trace by ID");

      const protections = await app.resolveApiKeyProtections({
        projectId: scope.id,
        apiKeyId: caller.apiKeyId,
        userId: caller.userId,
      });
      const trace = await readOneTraceOrThrow({
        app,
        projectId: scope.id,
        traceId,
        protections,
        withEditOverlay: true,
      });

      const resolvedTraceId = trace.trace_id;
      const evaluationsMap = await app.readEvaluations({
        projectId: scope.id,
        traceIds: [resolvedTraceId],
        protections,
      });
      const evaluations = evaluationsMap[resolvedTraceId] ?? [];
      const url = app.platformUrl({
        projectSlug: project.projectSlug,
        path: `/traces/${resolvedTraceId}`,
      });

      if (format === "digest") {
        return {
          trace_id: resolvedTraceId,
          formatted_trace: await TraceReadableSpanService.formatSpansDigest(trace.spans ?? []),
          timestamps: trace.timestamps,
          metadata: trace.metadata,
          evaluations,
          platformUrl: url,
        };
      }

      return {
        ...trace,
        evaluations,
        ascii_tree: TraceFormattingService.generateAsciiTree(trace.spans),
        platformUrl: url,
      };
    });

  return router.build();
}

/**
 * `POST /search` and `GET /:traceId`. The metadata amendment and the
 * coding-agent transcript stay absent - no module member answers their
 * collaborators, and an unregistered route beats one that always 500s.
 */
export const tracesRest = createTracesRest();

export { traceSearchBodyExtensions };
export type { TraceSearchBody };
