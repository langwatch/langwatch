/**
 * REST for the v1 trace reads: `POST /api/traces/search`,
 * `GET /api/traces/:traceId`, `GET /api/traces/:traceId/transcript` and
 * `PATCH /api/traces/:traceId/metadata`.
 *
 * Was `platform/app/src/app/api/traces/[[...route]]/app.v1.ts`. Everything
 * the routes reached through the platform's global application container is a
 * port now: the legacy read itself, the API key caller's read-time
 * redactions, the deep-link builder, the reserved-metadata write and the
 * coding-agent transcript join. The projection compiler, the evaluation
 * enricher and the two formatters are this package's own, so they are called
 * directly.
 *
 * The search BODY arrives as a port for the same reason the analytics
 * timeseries body does: it is built on the deployment's shared analytics
 * filter vocabulary, which the trace feature does not own. What the family
 * owns is the additive half — the projection DSL, the output format, the date
 * axis — published here as {@link traceSearchBodyExtensions} so one
 * definition documents the public wire.
 */
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  coerceToEpoch,
  type PlatformUrlBuilder,
  RequestValidationError,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { Evaluation, Trace, TracesForProjectResult } from "@langwatch/trace-contract";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { enrichTracesWithEvaluations } from "#services/trace-evaluation-enrichment.rules";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
} from "#services/trace-formatting.service";
import { AmbiguousTraceIdPrefixError } from "#services/trace-legacy-read.service";
import { compileProjection } from "#services/trace-projection-compile.service";
import {
  type CompiledProjection,
  type ProjectableTrace,
  type ProjectionRequest,
  ProjectionValidationError,
  projectionRequestSchema,
} from "#services/trace-projection.types";
import { formatSpansDigest } from "#services/trace-readable-span.service";
import type { TraceDateField } from "#services/trace-legacy-read.types";
import {
  traceMetadataUpdateSchema,
  type TraceMetadataUpdate,
} from "#services/trace-metadata-write.service";

const logger = createLogger("langwatch:api:traces");

/**
 * The additive half of the search body, published by the family that answers
 * it.
 *
 * The other half is the deployment's shared analytics filter vocabulary, which
 * arrives as {@link TracesRestPorts}' `searchBodySchema`; a mount merges the
 * two. The describe() text here is the public API documentation for these
 * fields, so it belongs beside the handler that honours them rather than in
 * whichever process happens to mount it.
 */
export const traceSearchBodyExtensions = {
  scrollId: z.string().optional().nullable(),
  format: z
    .enum(["digest", "json"])
    .optional()
    .describe(
      "Output format: 'digest' (AI-readable trace digest) or 'json' (full raw data)",
    ),
  includeSpans: z
    .boolean()
    .optional()
    .describe(
      "When true, fetches full span data for each trace. Useful for bulk export. Default false.",
    ),
  llmMode: z.boolean().optional(),
  dateField: z
    .enum(["occurred", "updated"])
    .default("occurred")
    .describe(
      "Which timestamp the startDate/endDate window filters on. 'occurred' (default) " +
        "selects traces by when they happened. 'updated' selects traces by when they were " +
        "last modified — use this for incremental ETL ('give me everything changed since my " +
        "last pull'), since a trace can occur long before it gains a later evaluation or " +
        "annotation.",
    ),
  ...projectionRequestSchema.shape,
} as const;

/**
 * What a caller may send to `POST /search`, as this family reads it.
 *
 * Everything beyond the named fields is the deployment's filter vocabulary and
 * travels to the read untouched — the same pass-through the route has always
 * made.
 */
export type TraceSearchBody = ProjectionRequest &
  Readonly<{
    startDate: string | number;
    endDate: string | number;
    pageSize?: number | undefined;
    scrollId?: string | null | undefined;
    format?: "digest" | "json" | undefined;
    includeSpans?: boolean | undefined;
    llmMode?: boolean | undefined;
    dateField: TraceDateField;
  }>;

/**
 * The legacy trace read, as the three read routes here use it.
 *
 * Declared narrowly rather than as the whole `TraceLegacyReadPort`: a REST
 * door that could reach eleven readers invites a handler to answer a question
 * this surface does not publish.
 */
export interface TracesRestReadPort {
  getAllTracesForProject(
    input: Readonly<{ projectId: string }> & Record<string, unknown>,
    protections: unknown,
    options: Readonly<{
      downloadMode?: boolean;
      includeSpans?: boolean;
      scrollId?: string | undefined;
      dateField?: TraceDateField;
      projection?: CompiledProjection["plan"];
    }>,
  ): Promise<TracesForProjectResult>;
  getById(
    projectId: string,
    traceId: string,
    protections: unknown,
    opts?: Readonly<{ full?: boolean }>,
  ): Promise<Trace | undefined>;
  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: unknown,
  ): Promise<Record<string, Evaluation[]>>;
}

/** What the v1 trace family needs from the process. */
export interface TracesRestPorts<TBody extends TraceSearchBody, TBodyRaw> {
  /**
   * The search body a caller may send: the deployment's shared analytics
   * filter vocabulary merged with {@link traceSearchBodyExtensions}. Both the
   * parsed shape and the shape a caller SENDS are carried, because they
   * differ — `dateField` and `from` both carry defaults — and the validator
   * types the 400 body off the sent shape.
   */
  searchBodySchema: z.ZodType<TBody, TBodyRaw>;
  /** The read itself. Resolved per request, never constructed at mount. */
  traces(): TracesRestReadPort;
  /**
   * The API KEY caller's read-time redactions for one project: cost
   * visibility, the data-privacy policy's content categories, the
   * restricted-attribute rules and the plan's visibility cutoff.
   *
   * A key is not a person, so the categories resolve as they do for a caller
   * with no session; costs are visible, because every project role grants
   * `cost:view` and a project key carries full project access.
   */
  getProtections(input: Readonly<{ projectId: string }>): Promise<unknown>;
  /** Deep links back into the product, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * The reserved-metadata amendment, or none.
   *
   * None where the process registered no command queue: the amendment is a
   * synthetic span on the ingestion pipeline, and a PATCH that answered 200
   * while recording nothing is a change a caller cannot tell did not happen.
   * Absent, the route is not registered at all.
   */
  updateTraceMetadata?:
    | ((
        input: Readonly<{
          projectId: string;
          traceId: string;
          metadata: TraceMetadataUpdate;
        }>,
      ) => Promise<void>)
    | undefined;
  /**
   * The coding-agent transcript join, or none.
   *
   * None where the process composed no coding-agent session store and no log
   * canonicaliser: the transcript would come back empty, which reads as "this
   * agent did nothing" rather than "this deployment cannot tell you". Absent,
   * the route is not registered at all.
   */
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
}

/**
 * The v1 trace family, built against one process's security.
 *
 * ORDERING inside the family is load-bearing: `/:traceId/transcript` and
 * `/:traceId/metadata` are registered before the bare `/:traceId`, so the
 * literal sub-resources are not swallowed by the parameter.
 */
export function createTracesRestApp<TBody extends TraceSearchBody, TBodyRaw>(options: {
  security: AppRestSecurity;
  ports: TracesRestPorts<TBody, TBodyRaw>;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, ports } = options;
  const secured = security.createProjectApp({ basePath: "/api/traces" });

  // POST /search - Search traces for a project
  secured.access(requires("traces:view")).post(
    "/search",
    describeRoute({
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
    zValidator("json", ports.searchBodySchema),
    async (c) => {
      const project = c.get("project");
      const params = c.req.valid("json") as TraceSearchBody & Record<string, unknown>;
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
      const protections = await ports.getProtections({ projectId: project.id });

      // When `select` is present, compile the projection up front. The compiled
      // plan drives column pruning + child-collection joins in the ENGINE; the
      // resolved schema goes into the response envelope; the projector replaces
      // formatTrace per row.
      //
      // An unknown select path is a validation failure like any other — the body
      // parsed, and a field in it names something that does not exist — so it
      // travels the same channel as a schema failure rather than as an anonymous
      // 400: same code, same 422, one reason per offending path.
      let projection: CompiledProjection | undefined;
      if (select && select.length > 0) {
        try {
          projection = compileProjection({
            from,
            select,
            protections: protections as Parameters<typeof compileProjection>[0]["protections"],
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

      const rawTraces = results.groups.flat() as Trace[];
      const enrichedTraces = enrichTracesWithEvaluations({
        traces: rawTraces,
        traceChecks: results.traceChecks,
      });

      const formatTrace = (trace: Trace) => {
        if (format === "digest") {
          return {
            trace_id: trace.trace_id,
            formatted_trace: formatTraceSummaryDigest(trace),
            input: trace.input,
            output: trace.output,
            timestamps: trace.timestamps,
            metadata: trace.metadata,
            error: trace.error,
            evaluations: trace.evaluations,
            platformUrl: ports.platformUrl({
              projectSlug: project.slug,
              path: `/traces/${trace.trace_id}`,
            }),
          };
        }
        return {
          ...trace,
          platformUrl: ports.platformUrl({
            projectSlug: project.slug,
            path: `/traces/${trace.trace_id}`,
          }),
        };
      };

      // A projection (when active) replaces the default formatTrace, shaping each
      // row to mirror the caller's `select`. The ENGINE has already attached the
      // Postgres-sourced annotations the projector reads.
      const serializeTrace = projection
        ? (trace: Trace) => projection.project(trace as unknown as ProjectableTrace)
        : formatTrace;

      const serializedTraces: string[] = [];
      let skippedCount = 0;
      for (const trace of enrichedTraces) {
        try {
          serializedTraces.push(JSON.stringify(serializeTrace(trace)));
        } catch (err) {
          skippedCount++;
          logger.error(
            {
              traceId: trace.trace_id,
              error: err instanceof Error ? err.message : err,
            },
            "Failed to serialize trace, skipping",
          );
        }
      }

      // Surface dropped traces so a caller never silently sees fewer rows than
      // totalHits with no signal. Emitted only when non-zero, so the common-case
      // envelope stays byte-identical to before.
      const pagination = JSON.stringify({
        totalHits: results.totalHits,
        scrollId: results.scrollId,
        ...(skippedCount > 0 ? { skipped: skippedCount } : {}),
        // Updated axis only, and the value a CDC client should resume from.
        ...(results.updatedThrough !== undefined
          ? { updatedThrough: results.updatedThrough }
          : {}),
      });

      // When a projection is active the envelope gains a `schema` field describing
      // the resolved columns so callers can pre-allocate a typed reader.
      const schemaSuffix = projection
        ? `,"schema":${JSON.stringify(projection.schema)}`
        : "";

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"traces":['));

          for (let i = 0; i < serializedTraces.length; i++) {
            const prefix = i > 0 ? "," : "";
            controller.enqueue(encoder.encode(prefix + serializedTraces[i]!));
          }

          controller.enqueue(
            encoder.encode(`],"pagination":${pagination}${schemaSuffix}}`),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  // GET /:traceId/transcript - the coding-agent transcript for one trace.
  // Registered only where the process composed the join it reads; see the port.
  const readCodingAgentTranscript = ports.readCodingAgentTranscript;
  if (readCodingAgentTranscript) {
    secured.access(requires("traces:view")).get(
      "/:traceId/transcript",
      describeRoute({
        description:
          "Derived coding-agent transcript for a trace: what the agent did, in order, " +
          "with per-call token and cost economics. Empty entries for traces without " +
          "coding-agent content.",
        parameters: [
          {
            name: "traceId",
            in: "path",
            description:
              "The trace ID — either the full 32-char ID or a unique prefix (≥ 8 chars). Prefix lookup is scoped to the authenticated project.",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          ...baseResponses,
          200: {
            description:
              "The transcript: ordered entries plus per-session totals and sub-agent tool counts",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    agent: z.string(),
                    sessionId: z.string().nullable(),
                    entries: z.array(z.object({}).passthrough()),
                    totals: z.object({
                      modelCalls: z.number(),
                      toolCalls: z.number(),
                      tokens: z.number(),
                      costUsd: z.number(),
                    }),
                    subAgents: z.array(z.object({}).passthrough()),
                  }),
                ),
              },
            },
          },
          404: {
            description: "Trace not found",
            content: {
              "application/json": {
                schema: resolver(z.object({ message: z.string() })),
              },
            },
          },
          409: {
            description:
              "Ambiguous trace ID prefix — the prefix matches more than one trace",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    message: z.string(),
                    candidateTraceIds: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const project = c.get("project");
        const { traceId } = c.req.param();

        logger.info({ projectId: project.id, traceId }, "Getting trace transcript");

        const protections = await ports.getProtections({ projectId: project.id });

        let trace: Trace | undefined;
        try {
          trace = await ports.traces().getById(project.id, traceId, protections);
        } catch (err) {
          if (err instanceof AmbiguousTraceIdPrefixError) {
            return c.json(
              {
                message: err.message,
                candidateTraceIds: err.candidateTraceIds,
              },
              409,
            );
          }
          throw err;
        }

        if (!trace) {
          throw new HTTPException(404, {
            message: "Trace not found.",
          });
        }

        const transcript = await readCodingAgentTranscript({
          projectId: project.id,
          traceId: trace.trace_id,
          occurredAtMs: trace.timestamps.started_at,
          protections,
        });

        return c.json(transcript as Record<string, unknown>);
      },
    );
  }

  // PATCH /:traceId/metadata - Update trace metadata via synthetic span.
  // Registered only where the process composed the ingestion the amendment
  // rides on; see the port.
  const updateTraceMetadata = ports.updateTraceMetadata;
  if (updateTraceMetadata) {
    secured.access(requires("traces:update")).patch(
      "/:traceId/metadata",
      describeRoute({
        tags: ["Traces"],
        summary: "Update trace metadata",
        description:
          "Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys are preserved. Labels replace entirely.",
        responses: {
          200: {
            description: "Metadata updated successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ traceId: z.string() })),
              },
            },
          },
          ...baseResponses,
        },
      }),
      zValidator(
        "json",
        z.object({
          metadata: traceMetadataUpdateSchema,
        }),
      ),
      async (c) => {
        const project = c.get("project");
        const traceId = c.req.param("traceId");
        const body = c.req.valid("json");

        await updateTraceMetadata({
          projectId: project.id,
          traceId,
          metadata: body.metadata,
        });

        return c.json({ traceId });
      },
    );
  }

  // GET /:traceId - Get a single trace by ID. LAST of the three, so the two
  // literal sub-resources above are not swallowed by the parameter.
  secured.access(requires("traces:view")).get(
    "/:traceId",
    describeRoute({
      description: "Get a single trace by ID.",
      parameters: [
        {
          name: "traceId",
          in: "path",
          description:
            "The trace ID — either the full 32-char ID or a unique prefix (≥ 8 chars). Prefix lookup is scoped to the authenticated project.",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "format",
          in: "query",
          description:
            "Output format: 'digest' (AI-readable) or 'json' (full raw data, default)",
          required: false,
          schema: { type: "string", enum: ["digest", "json"] },
        },
        {
          name: "llmMode",
          in: "query",
          description: "Deprecated: use format=digest instead",
          required: false,
          schema: { type: "string", enum: ["true", "false", "1", "0"] },
        },
      ],
      responses: {
        ...baseResponses,
        200: {
          description: "Trace detail with spans, evaluations, and ASCII tree",
          content: {
            "application/json": {
              schema: resolver(z.object({}).passthrough()),
            },
          },
        },
        404: {
          description: "Trace not found",
          content: {
            "application/json": {
              schema: resolver(z.object({ message: z.string() })),
            },
          },
        },
        409: {
          description:
            "Ambiguous trace ID prefix — the prefix matches more than one trace",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  message: z.string(),
                  candidateTraceIds: z.array(z.string()),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { traceId } = c.req.param();
      const formatParam = c.req.query("format");
      const llmModeParam = c.req.query("llmMode");
      const format =
        formatParam ??
        (llmModeParam === "true" || llmModeParam === "1" ? "digest" : "json");

      logger.info({ projectId: project.id, traceId }, "Getting trace by ID");

      const protections = await ports.getProtections({ projectId: project.id });
      const traceService = ports.traces();

      let trace: Trace | undefined;
      try {
        trace = await traceService.getById(project.id, traceId, protections, {
          full: true,
        });
      } catch (err) {
        if (err instanceof AmbiguousTraceIdPrefixError) {
          return c.json(
            {
              message: err.message,
              candidateTraceIds: err.candidateTraceIds,
            },
            409,
          );
        }
        throw err;
      }

      if (!trace) {
        throw new HTTPException(404, {
          message: "Trace not found.",
        });
      }

      // If the caller passed a prefix, the resolved trace has the full ID.
      // Use that everywhere downstream so the response, links, and evaluation
      // lookup all key off the real trace ID.
      const resolvedTraceId = trace.trace_id;

      const evaluationsMap = await traceService.getEvaluationsMultiple(
        project.id,
        [resolvedTraceId],
        protections,
      );
      const evaluations = evaluationsMap[resolvedTraceId] ?? [];

      if (format === "digest") {
        return c.json({
          trace_id: resolvedTraceId,
          formatted_trace: await formatSpansDigest(trace.spans ?? []),
          timestamps: trace.timestamps,
          metadata: trace.metadata,
          evaluations,
          platformUrl: ports.platformUrl({
            projectSlug: project.slug,
            path: `/traces/${resolvedTraceId}`,
          }),
        });
      }

      const asciiTree = generateAsciiTree(trace.spans);
      return c.json({
        ...trace,
        evaluations,
        ascii_tree: asciiTree,
        platformUrl: ports.platformUrl({
          projectSlug: project.slug,
          path: `/traces/${resolvedTraceId}`,
        }),
      });
    },
  );

  return secured;
}
