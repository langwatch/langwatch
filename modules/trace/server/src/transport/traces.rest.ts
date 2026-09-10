/**
 * `/api/traces`: the v1 trace reads — search, get-by-id, transcript, metadata
 * PATCH. Route order is load-bearing: the two `:traceId` sub-resources
 * register before the bare `:traceId`, so the literal segments are not
 * swallowed by the parameter.
 *
 * `getProtections` and `platformUrl` stay factory parameters rather than
 * `TraceApi` methods: the first asks a question of the CALLER's credential
 * (an API key's own `cost:view`, a legacy key's blanket access) that only the
 * process's authz wiring can answer, and the second needs the deployment's own
 * origin. Both are deployment shape, not module behaviour — the same reason
 * `createEvaluatorRest`/`createDatasetRest` take `platformUrl` this way.
 */
import { TraceFormattingService } from "#services/support/trace-formatting.service";
import { TraceReadableSpanService } from "#services/read/trace-readable-span.service";
import { TraceProjectionCompileService } from "#services/projection/trace-projection-compile.service";
import { AmbiguousTraceIdPrefixError } from "#services/read/trace-legacy-read.service";
import { traceMetadataUpdateSchema } from "#services/support/trace-metadata-write.service";
import { enrichTracesWithEvaluations } from "#rules/trace-evaluation-enrichment.rules";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  RequestValidationError,
  type PlatformUrlBuilder,
  type RestRawResult,
} from "@langwatch/api/rest";
import {
  TraceApi,
  TraceIdAmbiguousError,
  TraceNotFoundError,
  ProjectionValidationError,
  traceFormatQuerySchema,
  traceIdParamsSchema,
  traceSearchBodyExtensions,
  tracesRestCredentialSchema,
  transcriptResponseSchema,
  type CompiledProjection,
  type ProjectableTrace,
  type Trace,
  type TraceDateField,
  type TraceSearchBody,
} from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:api:traces");

/** The credential a route reads: an API key's own id, and the member it acts as. */
export const tracesRestCredential = defineRestMiddleware(
  "tracesRestCredential",
  tracesRestCredentialSchema,
);
type TracesRestCaller = z.infer<(typeof tracesRestCredential)["schema"]>;

const traceMetadataBodySchema = z.object({ metadata: traceMetadataUpdateSchema });

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
    trace = await input.app.readTrace({
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
  input: { format: string; platformUrl: PlatformUrlBuilder; projectSlug: string },
): unknown {
  const platformUrl = input.platformUrl({
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

function streamSearchEnvelope(serializedTraces: string[], pagination: string, schemaSuffix: string): string {
  return `{"traces":[${serializedTraces.join(",")}],"pagination":${pagination}${schemaSuffix}}`;
}

function coerceToEpochOrThrow(value: unknown, field: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new RequestValidationError({
    target: "json",
    violations: [{ field, type: "invalid_type", message: "Invalid date", received: value }],
  });
}

/** What this process supplies beyond `TraceApi` itself. */
export type TracesRestOptions<Schema extends z.ZodObject<z.ZodRawShape>> = Readonly<{
  /** The deployment's shared analytics filter vocabulary, merged with `traceSearchBodyExtensions`. */
  searchBodySchema: Schema;
  platformUrl: PlatformUrlBuilder;
  /** The caller's read-time redactions for one project, keyed by their credential. */
  getProtections(input: Readonly<{ projectId: string; caller: TracesRestCaller }>): Promise<unknown>;
  /** Absent where the process registered no command queue; the route is not registered at all. */
  updateTraceMetadata?:
    | ((input: Readonly<{ projectId: string; traceId: string; metadata: unknown }>) => Promise<void>)
    | undefined;
  /** Absent where the process composed no coding-agent session store; the route is not registered. */
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
export function createTracesRest<Schema extends z.ZodObject<z.ZodRawShape>>(
  options: TracesRestOptions<Schema>,
) {
  const { searchBodySchema, platformUrl, getProtections, updateTraceMetadata, readCodingAgentTranscript } =
    options;

  let router = defineRestRouter(TraceApi)
    .withNamespace("traces")
    .withVersion(MANAGEMENT_API_VERSION)

    .post("/search", "searchTraces")
    .withInput(searchBodySchema)
    .withPermission("traces:view")
    .withRawResponse({ produces: "application/json" })
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({ description: "Search traces for a project" })
    .handle(async ({ app, input, scope }, project, caller): Promise<Response> => {
      const params = input as unknown as Record<string, unknown>;
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
      } = params as Record<string, unknown> & {
        from?: unknown;
        select?: unknown;
        dateField: TraceDateField;
        format?: "digest" | "json";
        includeSpans?: boolean;
        llmMode?: boolean;
        scrollId?: string | null;
        startDate: unknown;
        endDate: unknown;
        pageSize?: number;
      };
      const format = formatParam ?? (llmMode ? "digest" : "json");

      logger.info({ projectId: scope.id }, "Searching traces for project");

      const pageSize = Math.min(rawPageSize ?? 1000, 1000);
      const protections = await getProtections({ projectId: scope.id, caller });

      let projection: CompiledProjection | undefined;
      if (Array.isArray(select) && select.length > 0) {
        try {
          projection = TraceProjectionCompileService.compileProjection({
            from: from as never,
            select: select as never,
            protections: protections as never,
          });
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
            formatTraceRow(trace, { format, platformUrl, projectSlug: project.projectSlug });

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

        const protections = await getProtections({ projectId: scope.id, caller });
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
      .withOutput(z.object({ traceId: z.string() }))
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
    .withOutput(z.object({}).passthrough())
    .withMiddleware(projectRestFacts, tracesRestCredential)
    .withDocs({ description: "Get a single trace by ID." })
    .handle(async ({ app, input, scope }, project, caller) => {
      const { traceId } = input;
      const format = input.format ?? (input.llmMode === "true" || input.llmMode === "1" ? "digest" : "json");

      logger.info({ projectId: scope.id, traceId }, "Getting trace by ID");

      const protections = await getProtections({ projectId: scope.id, caller });
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
      const url = platformUrl({ projectSlug: project.projectSlug, path: `/traces/${resolvedTraceId}` });

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

export { traceSearchBodyExtensions };
export type { TraceSearchBody };
