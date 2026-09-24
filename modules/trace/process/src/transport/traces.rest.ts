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
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { nowInstant, toEpochMs } from "@langwatch/time";
import {
  TraceApi,
  TraceIdAmbiguousError,
  TraceNotFoundError,
  ProjectionValidationError,
  discoverResultSchema,
  traceFacetsQuerySchema,
  traceFacetsResponseSchema,
  traceFacetValuesResponseSchema,
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
  transcriptRestResponseSchema,
  type CompiledProjection,
  type Protections,
  type Trace,
  type TraceFacetsQuery,
  type TraceSearchBody,
  type TraceSharedFiltersInput,
} from "@langwatch/trace-contract";
import type { z } from "zod";

import { enrichTracesWithEvaluations } from "#rules/trace-evaluation-enrichment.rules";
/**
 * /api/traces: v1 trace reads (search, facets, get-by-id, transcript, metadata
 * PATCH). Route order load-bearing: register :traceId sub-resources, and the
 * literal /facets, before the bare :traceId.
 */
import { formatTraceSummaryDigest, generateAsciiTree } from "#rules/trace-formatting.rules";
import { tracePath } from "#rules/trace-platform-url.rules";
import { compileProjection } from "#rules/trace-projection-compile.rules";
import { TraceFacetValuesService } from "#services/trace-facet-values.service";
import { AmbiguousTraceIdPrefixError } from "#services/trace-legacy-read.service";

const logger = createLogger("langwatch:api:traces");

/** The default facets window when a caller sends no startDate. */
const FACETS_DAY_MS = 24 * 60 * 60 * 1000;

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
/** Facets adds a 403: an attribute field withheld from a caller who cannot read its content. */
const FACETS_ERROR_ANSWERS = documentedResponses({
  400: badRequestSchema,
  401: badRequestSchema,
  403: badRequestSchema,
  422: badRequestSchema,
  500: badRequestSchema,
});

/** One facets window bound as epoch milliseconds, whichever way it was written. */
function facetWindowBound(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : toEpochMs(value);
}

/** `GET /facets`: the discovery payload, or one field's paged values. */
async function answerTraceFacets({
  app,
  input,
  scope,
  caller,
}: {
  app: TraceApi;
  input: TraceFacetsQuery;
  scope: { id: string };
  caller: { apiKeyId: string | null; userId: string | null };
}): Promise<Record<string, unknown>> {
  const { field, prefix, limit, offset, startDate, endDate } = input;
  // One clock read for both ends: two calls landing in different
  // milliseconds would run the default window over a day.
  const now = nowInstant().epochMilliseconds;
  const timeRange = {
    from: startDate === undefined ? now - FACETS_DAY_MS : facetWindowBound(startDate),
    to: endDate === undefined ? now : facetWindowBound(endDate),
  };

  if (field === undefined) {
    return discoverResultSchema.parse(await app.readDiscover({ tenantId: scope.id, timeRange }));
  }

  const protections = await app.resolveApiKeyProtections({
    projectId: scope.id,
    apiKeyId: caller.apiKeyId,
    userId: caller.userId,
  });
  const facetKey = TraceFacetValuesService.resolveFacetKey({ field, protections });
  const result = await app.readFacetValues({
    tenantId: scope.id,
    timeRange: TraceFacetValuesService.visibleWindow({ timeRange, facetKey, protections }),
    facetKey,
    limit,
    offset,
    ...(prefix === undefined ? {} : { prefix }),
  });

  return traceFacetValuesResponseSchema.parse({
    values: result.values,
    total: result.totalDistinct,
    hasMore: offset + result.values.length < result.totalDistinct,
  });
}

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
    path: tracePath({ traceId: trace.trace_id, occurredAtMs: trace.timestamps?.started_at }),
  });
  if (input.format === "digest") {
    return {
      trace_id: trace.trace_id,
      formatted_trace: formatTraceSummaryDigest(trace),
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
      projection: compileProjection({
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

/** Whether the legacy `filters["traces.origin"]` map already names an origin. */
function namesOriginFilter(filters: TraceSharedFiltersInput["filters"]): boolean {
  const originFilter = filters?.["traces.origin"];
  if (originFilter === undefined) return false;
  return Array.isArray(originFilter)
    ? originFilter.length > 0
    : Object.keys(originFilter).length > 0;
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
/** One `POST /search` answer: the envelope, serialised once with its rows already JSON. */
async function searchTraces({
  app,
  input,
  scope,
  project,
  caller,
}: {
  app: TraceApi;
  input: z.infer<typeof traceSearchBodySchema>;
  scope: { id: string };
  project: { projectSlug: string };
  caller: { apiKeyId: string | null; userId: string | null };
}): Promise<string> {
  const params = input;
  const {
    from,
    select,
    dateField,
    filter,
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

  const startEpoch = coerceToEpochOrThrow(startDate, "startDate");
  const endEpoch = coerceToEpochOrThrow(endDate, "endDate");
  const filterWhere = app.compileExplorerTraceFilter({
    query: filter ?? "",
    tenantId: scope.id,
    timeRange: { from: startEpoch, to: endEpoch },
    originNamed: namesOriginFilter(searchFields.filters),
    dateField,
  });

  const results = await app.listTraces({
    query: {
      ...searchFields,
      projectId: scope.id,
      startDate: startEpoch,
      endDate: endEpoch,
      pageSize,
    } as never,
    protections,
    options: {
      downloadMode: true,
      includeSpans: includeSpans ?? false,
      scrollId: scrollId ?? undefined,
      dateField,
      filterWhere,
      ...(projection ? { projection: projection.plan } : {}),
    },
  });

  const enrichedTraces = enrichTracesWithEvaluations({
    traces: results.groups.flat() as Trace[],
    traceChecks: results.traceChecks,
  });

  const serializeTrace = projection
    ? (trace: Trace) => projection!.project(trace)
    : (trace: Trace) => formatTraceRow(trace, { app, format, projectSlug: project.projectSlug });

  const { serializedTraces, skippedCount } = serializeTraceRows(enrichedTraces, serializeTrace);

  const pagination = JSON.stringify({
    totalHits: results.totalHits,
    scrollId: results.scrollId,
    ...(skippedCount > 0 ? { skipped: skippedCount } : {}),
    ...(results.updatedThrough !== undefined ? { updatedThrough: results.updatedThrough } : {}),
  });
  const schemaSuffix = projection ? `,"schema":${JSON.stringify(projection.schema)}` : "";

  return streamSearchEnvelope(serializedTraces, pagination, schemaSuffix);
}

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
    .withResponse("bytes", { produces: "application/json" })
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
    .handle(async ({ app, input, scope, response }, project, caller) =>
      response.buffer(await searchTraces({ app, input, scope, project, caller }), {
        mediaType: "application/json",
      }),
    );

  // GET /facets - what the trace filter fields hold. Registered BEFORE
  // :traceId so "facets" is never read as a trace id.
  router = router
    .get("/facets", "getTraceFacets")
    .withQuery(traceFacetsQuerySchema)
    .withPermission("traces:view")
    .withOutput(traceFacetsResponseSchema)
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({
      description:
        "Discover what the trace filter fields hold in this project. Without `field`, " +
        "every facet with its top values. With `field`, that field's values, paged.",
      responses: FACETS_ERROR_ANSWERS,
    })
    .handle(async ({ app, input, scope }, _project, caller) =>
      answerTraceFacets({ app, input, scope, caller }),
    );

  // GET /:traceId/transcript - registered only where the process composed the
  // coding-agent join it reads.
  if (readCodingAgentTranscript) {
    router = router
      .get("/:traceId/transcript", "getTraceTranscript")
      .withParams(traceIdParamsSchema)
      .withPermission("traces:view")
      .withOutput(transcriptRestResponseSchema)
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
        path: tracePath({
          traceId: resolvedTraceId,
          occurredAtMs: trace.timestamps?.started_at,
        }),
      });

      if (format === "digest") {
        return {
          trace_id: resolvedTraceId,
          formatted_trace: await app.formatSpansDigest({ spans: trace.spans ?? [] }),
          timestamps: trace.timestamps,
          metadata: trace.metadata,
          evaluations,
          platformUrl: url,
        };
      }

      return {
        ...trace,
        evaluations,
        ascii_tree: generateAsciiTree(trace.spans),
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
