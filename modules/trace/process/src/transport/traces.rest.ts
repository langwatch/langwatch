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
import type { PrincipalRef } from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { toEpochMs } from "@langwatch/time";
import {
  TraceApi,
  ProjectionValidationError,
  traceFacetsQuerySchema,
  traceFacetsResponseSchema,
  traceFacetsAnswerSchema,
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
import { formatTraceSummaryDigest } from "#rules/trace-formatting.rules";
import { findUnkeyedLegacyFilters } from "#rules/trace-legacy-filter-keys.rules";
import { tracePath } from "#rules/trace-platform-url.rules";
import { compileProjection } from "#rules/trace-projection-compile.rules";

const logger = createLogger("langwatch:api:traces");

/** The default facets window when a caller sends no startDate. */

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

/** A keyed filter sent without its key would match no trace; refuse it, naming the field. */
function refuseUnkeyedFilters(filters: unknown): void {
  const unkeyed = findUnkeyedLegacyFilters({ filters, offersFilterString: true });
  if (unkeyed.length === 0) return;
  throw new RequestValidationError({
    target: "json",
    violations: unkeyed.map((violation) => ({ ...violation, type: "filter_key_required" })),
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
  caller: { principal: PrincipalRef | null };
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
  refuseUnkeyedFilters(searchFields.filters);

  logger.info({ projectId: scope.id }, "Searching traces for project");

  const pageSize = rawPageSize ?? DEFAULT_TRACES_PAGE_SIZE;
  const protections = await app.resolveApiKeyProtections({
    projectId: scope.id,
    principal: caller.principal,
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

export function createTracesRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<TraceApi>;
}> {
  let router = defineRestRouter(TraceApi)
    .withNamespace("traces")
    .withVersion(MANAGEMENT_API_VERSION)

    .post("/search", "searchTraces")
    .withInput(traceSearchBodySchema)
    .withPermission("traces:view")
    .withResponse("bytes", { produces: "application/json" })
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({
      operationId: "postApiTracesSearch",
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
      operationId: "getApiTracesFacets",
      summary: "Discover what the trace filter fields hold",
      description:
        "Discover what the trace filter fields hold in this project. Without `field`, " +
        "every facet with its top values. With `field`, that field's values, paged.",
      tags: ["Traces"],
      responses: {
        200: {
          description:
            "Without `field`, every facet the project has with its top values and whether the " +
            "payload is still being computed. With `field`, that field's values and counts plus " +
            "the distinct total and whether more remain.",
          content: { "application/json": { schema: resolver(traceFacetsAnswerSchema) } },
        },
        ...FACETS_ERROR_ANSWERS,
      },
    })
    .handle(({ app, input, scope }, _project, caller) =>
      app.readTraceFacetsForApiKey({
        projectId: scope.id,
        query: input,
        principal: caller.principal,
      }),
    );

  router = router
    .get("/:traceId/transcript", "getTraceTranscript")
    .withParams(traceIdParamsSchema)
    .withPermission("traces:view")
    .withOutput(transcriptRestResponseSchema)
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({
      operationId: "getApiTracesByTraceIdTranscript",
      description:
        "Derived coding-agent transcript for a trace: what the agent did, in order, " +
        "with per-call token and cost economics. Empty entries for traces without " +
        "coding-agent content.",
      responses: {
        200: {
          description:
            "The transcript: ordered entries plus per-session totals and sub-agent tool counts",
          content: { "application/json": { schema: resolver(transcriptRestResponseSchema) } },
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
    .handle(async ({ app, input, scope }, _project, caller) =>
      transcriptRestResponseSchema.parse(
        await app.readTraceTranscript({
          projectId: scope.id,
          traceId: input.traceId,
          principal: caller.principal,
        }),
      ),
    );

  router = router
    .patch("/:traceId/metadata", "updateTraceMetadata")
    .withParams(traceIdParamsSchema)
    .withInput(traceMetadataBodySchema)
    .withPermission("traces:update")
    .withOutput(traceMetadataResponseSchema)
    .withDocs({
      operationId: "patchApiTracesByTraceIdMetadata",
      description:
        "Update metadata on a trace after creation. Inserts a synthetic span carrying the new " +
        "attributes through the standard ingestion pipeline. New keys are added, existing keys " +
        "are updated, missing keys are preserved. Labels replace entirely.",
    })
    .handle(async ({ app, input, scope }) => {
      await app.updateTraceMetadata({
        projectId: scope.id,
        traceId: input.traceId,
        metadata: input.metadata,
      });
      return { traceId: input.traceId };
    });

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
      operationId: "getApiTracesByTraceId",
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
    .handle(({ app, input, scope }, project, caller) => {
      logger.info({ projectId: scope.id, traceId: input.traceId }, "Getting trace by ID");
      return app.getTraceByIdForApiKey({
        projectId: scope.id,
        traceId: input.traceId,
        format: resolveTraceFormat({ format: input.format, llmMode: input.llmMode }),
        projectSlug: project.projectSlug,
        principal: caller.principal,
      });
    });

  return router.build();
}

/** The metadata amendment stays absent: no module member answers its command queue. */
export const tracesRest = createTracesRest();

export { traceSearchBodyExtensions };
export type { TraceSearchBody };
