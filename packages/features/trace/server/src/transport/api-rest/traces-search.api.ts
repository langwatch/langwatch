/**
 * `POST /api/traces/search`: the streamed, optionally projected trace search.
 */
import { TraceProjectionCompileService } from "#services/trace-projection-compile.service";
import { TraceFormattingService } from "#services/trace-formatting.service";
import { requires } from "@langwatch/api";
import {
  baseResponses,
  coerceToEpoch,
  credentialPrincipalOf,
  MANAGEMENT_API_VERSION,
  projectOf,
  RequestValidationError,
  resolver,
  type PlatformUrlBuilder,
  type RestApiVersionedFamily,
} from "@langwatch/api/rest";
import type { Trace } from "@langwatch/trace-contract";
import {
  type CompiledProjection,
  type ProjectableTrace,
  ProjectionValidationError,
} from "@langwatch/trace-contract";
import { z } from "zod";

import { enrichTracesWithEvaluations } from "#rules/trace-evaluation-enrichment.rules";

import type { TraceSearchBody, TracesRestPorts } from "./traces.api";
import { logger, TRACE_ANSWER_REASON, type TraceContext } from "./traces-shared.api";

/**
 * When `select` is present the projection is compiled up front: the compiled plan drives column
 * pruning + child-collection joins in the ENGINE, the resolved schema goes into the response
 * envelope, and the projector replaces formatTrace per row. An unknown select path is a
 * validation failure like any other — the body parsed, so it travels the 422 channel, not 400.
 */
function compileSearchProjection(input: {
  from: TraceSearchBody["from"];
  select: TraceSearchBody["select"];
  protections: unknown;
}): CompiledProjection | undefined {
  const { from, select, protections } = input;
  if (!select || select.length === 0) return undefined;

  try {
    return TraceProjectionCompileService.compileProjection({
      from,
      select,
      protections: protections as Parameters<
        typeof TraceProjectionCompileService.compileProjection
      >[0]["protections"],
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

/** One row of the default (unprojected) envelope, in whichever of the two formats was asked for. */
function formatTrace(
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

/**
 * Serializes each row, dropping — and counting — the ones that cannot be serialized, so a caller
 * never silently sees fewer rows than totalHits with no signal.
 */
function serializeTraces(
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

/** The envelope, streamed row by row so a large page is never buffered whole. */
function streamSearchEnvelope(
  serializedTraces: string[],
  pagination: string,
  schemaSuffix: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"traces":['));

      for (let i = 0; i < serializedTraces.length; i++) {
        const prefix = i > 0 ? "," : "";
        controller.enqueue(encoder.encode(prefix + serializedTraces[i]!));
      }

      controller.enqueue(encoder.encode(`],"pagination":${pagination}${schemaSuffix}}`));
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/json" } });
}

export function registerTracesSearchRoute<TBody extends TraceSearchBody, TBodyRaw>(
  family: RestApiVersionedFamily,
  ports: TracesRestPorts<TBody, TBodyRaw>,
): void {
  const { service, policy } = family;

  // POST /search - Search traces for a project
  const searchHandler = async (c: TraceContext, input: TraceSearchBody) => {
    const project = projectOf(c);
    const params = input as TraceSearchBody & Record<string, unknown>;
    const {
      from,
      select,
      dateField,
      format: formatParam,
      includeSpans,
      llmMode,
      scrollId,
      ...searchFields
    } = params;
    const format = formatParam ?? (llmMode ? "digest" : "json");

    logger.info({ projectId: project.id }, "Searching traces for project");

    const pageSize = Math.min(params.pageSize ?? 1000, 1000);
    const protections = await ports.getProtections({
      projectId: project.id,
      credential: credentialPrincipalOf(c),
    });

    const projection = compileSearchProjection({ from, select, protections });

    const results = await ports.traces().getAllTracesForProject(
      {
        ...searchFields,
        projectId: project.id,
        startDate: coerceToEpoch(params.startDate),
        endDate: coerceToEpoch(params.endDate),
        pageSize,
      },
      protections,
      {
        downloadMode: true,
        includeSpans: includeSpans ?? false,
        scrollId: scrollId ?? undefined,
        dateField,
        ...(projection ? { projection: projection.plan } : {}),
      },
    );

    const enrichedTraces = enrichTracesWithEvaluations({
      traces: results.groups.flat() as Trace[],
      traceChecks: results.traceChecks,
    });

    // A projection (when active) replaces the default formatTrace, shaping each
    // row to mirror the caller's `select`. The ENGINE has already attached the
    // Postgres-sourced annotations the projector reads.
    const serializeTrace = projection
      ? (trace: Trace) => projection.project(trace as unknown as ProjectableTrace)
      : (trace: Trace) =>
          formatTrace(trace, {
            format,
            platformUrl: ports.platformUrl,
            projectSlug: project.slug,
          });

    const { serializedTraces, skippedCount } = serializeTraces(enrichedTraces, serializeTrace);

    const pagination = JSON.stringify({
      totalHits: results.totalHits,
      scrollId: results.scrollId,
      ...(skippedCount > 0 ? { skipped: skippedCount } : {}),
      // Updated axis only, and the value a CDC client should resume from.
      ...(results.updatedThrough !== undefined ? { updatedThrough: results.updatedThrough } : {}),
    });

    // When a projection is active the envelope gains a `schema` field describing
    // the resolved columns so callers can pre-allocate a typed reader.
    const schemaSuffix = projection ? `,"schema":${JSON.stringify(projection.schema)}` : "";

    return streamSearchEnvelope(serializedTraces, pagination, schemaSuffix);
  };

  service.registerRoute("post", "/search", MANAGEMENT_API_VERSION, searchHandler, (b) =>
    policy(requires("traces:view"))(b)
      .withInput(ports.searchBodySchema)
      .withRawResponse(TRACE_ANSWER_REASON, { contentType: "application/json" })
      .withDocs({
        description: "Search traces for a project",
        responses: {
          ...baseResponses,
          200: {
            description: "Matching traces with pagination",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    traces: z.array(z.any()),
                    pagination: z.object({
                      totalHits: z.number(),
                      scrollId: z.string().optional(),
                      skipped: z
                        .number()
                        .optional()
                        .describe(
                          "Number of traces dropped from this page because they failed to serialize. Present only when non-zero, so a caller can tell that traces.length is below the page size for a reason other than reaching the end of the result set.",
                        ),
                      updatedThrough: z
                        .number()
                        .optional()
                        .describe(
                          "Only when dateField is 'updated'. Epoch milliseconds: the upper bound this scroll actually covered, which is at or before the endDate you asked for. The scroll reads every trace as of the moment it started, so anything written after that instant belongs to the next pull. Start your next incremental pull from this value — resuming from the endDate you requested would step over the difference and lose those traces. The bound is inclusive on both sides, so a trace last written at exactly this millisecond arrives in this pull and again in the next one: pulls are at-least-once, and applying them idempotently is what keeps that from becoming a duplicate.",
                        ),
                    }),
                    schema: z
                      .object({
                        from: z.string(),
                        columns: z.array(
                          z.object({
                            path: z.string(),
                            type: z.string(),
                            collection: z.boolean(),
                          }),
                        ),
                      })
                      .optional()
                      .describe(
                        "Present only when 'select' is provided. Describes the resolved columns — " +
                          "the dotted path, its value type, and whether it belongs to a nested child " +
                          "collection — so callers can pre-allocate a typed reader.",
                      ),
                  }),
                ),
              },
            },
          },
        },
      }),
  );
}
