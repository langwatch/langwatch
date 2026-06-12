import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { getAllForProjectInput } from "~/server/api/routers/traces.schemas";
import { requires, type SecuredApp } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import type {
  CustomMetadata,
  ReservedTraceMetadata,
  Trace,
} from "~/server/tracer/types";
import { CollectorSpanUtils } from "~/server/traces/collectorSpan.utils";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import {
  type CompiledProjection,
  compileProjection,
  type ProjectableTrace,
  ProjectionValidationError,
  projectionRequestSchema,
} from "~/server/traces/projection";
import {
  AmbiguousTraceIdPrefixError,
  TraceService,
} from "~/server/traces/trace.service";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
} from "~/server/traces/trace-formatting";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { coerceToEpoch, flexibleDateSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:traces");

// Body schema for the search endpoint: reuses getAllForProjectInput but adjusts
// startDate/endDate to accept ISO strings alongside epoch numbers, and adds
// scrollId and format fields. llmMode is kept for backward compatibility.
//
// The projection DSL (`from` + `select`) and the date axis (`dateField`) are
// additive: absent → the endpoint behaves exactly as before. `from`/`select`
// come from the shared projection contract so the compiler and this surface
// agree on one schema.
const traceSearchBodySchema = getAllForProjectInput
  .omit({
    projectId: true,
    startDate: true,
    endDate: true,
  })
  .extend({
    startDate: flexibleDateSchema,
    endDate: flexibleDateSchema,
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
  })
  .merge(projectionRequestSchema);

export function registerTracesRoutes(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
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
    zValidator("json", traceSearchBodySchema),
    async (c) => {
      const project = c.get("project");
      const params = c.req.valid("json");
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

      const pageSize = Math.min(searchFields.pageSize ?? 1000, 1000);
      const protections = await getProtectionsForProject(prisma, {
        projectId: project.id,
      });

      // When `select` is present, compile the projection up front. The compiled
      // plan drives column pruning + child-collection joins in the ENGINE; the
      // resolved schema goes into the response envelope; the projector replaces
      // formatTrace per row. Invalid paths surface as a 400 with every offender.
      let projection: CompiledProjection | undefined;
      if (select && select.length > 0) {
        try {
          projection = compileProjection({ from, select, protections });
        } catch (err) {
          if (err instanceof ProjectionValidationError) {
            throw new HTTPException(400, { message: err.message });
          }
          throw err;
        }
      }

      const traceService = TraceService.create(prisma);
      const results = await traceService.getAllTracesForProject(
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
          projection: projection?.plan,
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
            platformUrl: platformUrl({
              projectSlug: project.slug,
              path: `/messages/${trace.trace_id}`,
            }),
          };
        }
        return {
          ...trace,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/messages/${trace.trace_id}`,
          }),
        };
      };

      // A projection (when active) replaces the default formatTrace, shaping each
      // row to mirror the caller's `select`. The ENGINE has already attached the
      // Postgres-sourced annotations the projector reads.
      const serializeTrace = projection
        ? (trace: Trace) => projection.project(trace as ProjectableTrace)
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

  // GET /:traceId - Get a single trace by ID
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
            "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)",
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

      const protections = await getProtectionsForProject(prisma, {
        projectId: project.id,
      });
      const traceService = TraceService.create(prisma);

      let trace;
      try {
        trace = await traceService.getById(project.id, traceId, protections);
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
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/messages/${resolvedTraceId}`,
          }),
        });
      }

      const asciiTree = generateAsciiTree(trace.spans);
      return c.json({
        ...trace,
        evaluations,
        ascii_tree: asciiTree,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/messages/${resolvedTraceId}`,
        }),
      });
    },
  );

  // PATCH /:traceId/metadata - Update trace metadata via synthetic span
  const metadataValueSchema = z.union([
    z.string().max(4096),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.unknown()),
  ]);

  const metadataInputSchema = z
    .record(metadataValueSchema)
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "metadata must contain at least one key",
    })
    .refine((obj) => JSON.stringify(obj).length <= 32768, {
      message: "total metadata payload must not exceed 32KB",
    });

  const RESERVED_METADATA_KEYS = new Set([
    "user_id",
    "customer_id",
    "thread_id",
    "labels",
  ]);

  function splitMetadata(metadata: Record<string, unknown>): {
    reserved: ReservedTraceMetadata;
    custom: CustomMetadata;
  } {
    const reserved: ReservedTraceMetadata = {};
    const custom: CustomMetadata = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (RESERVED_METADATA_KEYS.has(key)) {
        (reserved as Record<string, unknown>)[key] = value;
      } else {
        custom[key] = value as CustomMetadata[string];
      }
    }

    return { reserved, custom };
  }

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
        metadata: metadataInputSchema,
      }),
    ),
    async (c) => {
      const project = c.get("project");
      const traceId = c.req.param("traceId");
      const body = c.req.valid("json");

      const { reserved, custom } = splitMetadata(body.metadata);
      const resource = CollectorSpanUtils.buildResource({
        reservedTraceMetadata: reserved,
        customMetadata: custom,
      });

      const now = Date.now();
      const nowNano = String(now * 1_000_000);
      const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      await getApp().traces.recordSpan({
        tenantId: project.id,
        span: {
          traceId,
          spanId,
          traceState: null,
          parentSpanId: null,
          name: "langwatch.metadata_update",
          kind: 1,
          startTimeUnixNano: nowNano,
          endTimeUnixNano: nowNano,
          attributes: [
            {
              key: "langwatch.span.type",
              value: { stringValue: "span" },
            },
          ],
          events: [],
          links: [],
          status: { code: 1 },
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        },
        resource,
        instrumentationScope: { name: "langwatch.api.metadata_update" },
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
        occurredAt: now,
      });

      return c.json({ traceId });
    },
  );
}
