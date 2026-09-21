import { createLogger } from "@langwatch/observability";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { getAllForProjectInput } from "~/server/api/routers/traces.schemas";
import { readCodingAgentTranscriptWithProtections } from "~/server/api/routers/tracesV2";
import { requires, type SecuredApp } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import {
  RequestValidationError,
  validator as zValidator,
} from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import {
  explorerHiddenOrigins,
  withHiddenOrigins,
} from "~/server/app-layer/traces/hidden-origins";
import {
  traceMetadataUpdateSchema,
  updateTraceMetadata,
} from "~/server/app-layer/traces/trace-metadata.service";
import { prisma } from "~/server/db";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import type { Trace } from "~/server/tracer/types";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import {
  type CompiledProjection,
  compileProjection,
  type ProjectableTrace,
  type ProjectionFrom,
  ProjectionValidationError,
  projectionRequestSchema,
} from "~/server/traces/projection";
import type { Protections } from "~/server/traces/protections";
import {
  AmbiguousTraceIdPrefixError,
  TraceService,
} from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
} from "~/server/traces/trace-formatting";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { coerceToEpoch, flexibleDateSchema } from "../../shared/schemas";
import { isAttributeFacetKey, resolveFacetKey } from "./trace-facets";
import { compileTraceFilter, MAX_TRACE_FILTER_LENGTH } from "./trace-filter";

const logger = createLogger("langwatch:api:traces");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Values per page when the caller names a field and no limit. */
const DEFAULT_FACET_VALUE_LIMIT = 50;

const FACETS_DESCRIPTION =
  "What the trace filter fields actually hold in THIS project, which the filter language's own reference deliberately does not carry: values are tenant data, they move under you, and reading them all costs about thirty aggregate queries.\n\n" +
  "Two answers from one door. Without `field` you get the discovery payload: every facet this project has, each with its top values and counts, plus the range bounds for the numeric ones. With `field` you get one field's values, paged, filtered by `prefix`.\n\n" +
  "The values are cached and refreshed in the background, so a cold project answers `pending: true` with the payload it has; call again shortly for the computed one.\n\n" +
  "Use it whenever you are unsure how a value is spelled. `GET /api/v1/query/reference` lists the fields and their fixed vocabularies; only this endpoint knows the open ones.";

/** Digits only, which is how epoch milliseconds arrive on a query string. */
const EPOCH_MILLIS = /^\d+$/;

/**
 * A window bound arriving as a query string.
 *
 * Declared as a string rather than a string-or-number union, because a query
 * string has no numbers in it: everything arrives as text. The union was also
 * what the generated clients choked on, since a `number` arm becomes a float in
 * Go and an epoch millisecond does not survive one — float32 spacing up there
 * is about two minutes.
 *
 * Both documented spellings are accepted: digits are epoch milliseconds, and
 * anything else has to parse as a date. `flexibleDateSchema`, which the body
 * routes use, cannot do this job here: it hands the digits straight to
 * `Date.parse`, which answers NaN.
 */
const facetWindowBoundSchema = z
  .string()
  .refine(
    (value) =>
      EPOCH_MILLIS.test(value) ||
      (namesARealDay(value) && !Number.isNaN(Date.parse(value))),
    { message: "Expected epoch milliseconds or a date string" },
  );

/** The calendar date at the front of an ISO string, if it starts with one. */
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Whether an ISO-shaped bound names a day that exists.
 *
 * `Date.parse` rolls an impossible date forward instead of refusing it, so
 * `2026-02-30` becomes March 2 and a window ending there quietly covers two
 * days nobody asked for. The digits are checked against the month's real
 * length rather than against a re-parse, because a bound carrying a timezone
 * offset has a different UTC date by design and a round-trip would reject it.
 */
function namesARealDay(value: string): boolean {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/** One window bound as epoch milliseconds, whichever way it was written. */
function facetWindowBound(value: string): number {
  return EPOCH_MILLIS.test(value) ? Number(value) : coerceToEpoch(value);
}

/**
 * The 422 this route really sends.
 *
 * `baseResponses` documents the flat `{ error, message }` the traces family
 * published before validation gained structure, and a caller reading only that
 * cannot find which parameter it got wrong. The refusal carries `target`,
 * `fields` and one reason per issue, so this route documents what it sends
 * rather than the family's floor.
 */
const traceFacetsValidationErrorSchema = z.object({
  error: z.literal("validation_error"),
  message: z.string(),
  target: z.literal("query"),
  fields: z.array(z.string()),
  reasons: z.array(
    z.object({
      code: z.string(),
      meta: z
        .object({
          field: z.string().optional(),
          type: z.string().optional(),
          message: z.string().optional(),
          received: z.string().optional(),
          expected: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
  trace: z.string().optional(),
});

/** The 403 an attribute-key field gets in a project that hides captures. */
const traceFacetsWithheldErrorSchema = z.object({
  error: z.literal("trace_attribute_values_withheld"),
  message: z.string(),
  trace: z.string().optional(),
});

/**
 * The facets query, and where the two answers diverge.
 *
 * `limit` and `offset` carry defaults so the value branch never has to decide
 * them twice, and they are harmlessly present on the discovery branch, which
 * pages nothing.
 */
const traceFacetsQuerySchema = z.object({
  field: z.string().min(1).max(512).optional(),
  prefix: z.string().max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(DEFAULT_FACET_VALUE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  startDate: facetWindowBoundSchema.optional(),
  endDate: facetWindowBoundSchema.optional(),
});

/**
 * The discovery payload, loosely.
 *
 * Three facet kinds with three different bodies, and the union is the facet
 * registry's business rather than this route's: describing it exactly here
 * would be a second definition of it, and the one thing a consumer branches on
 * — `kind` — is enumerated.
 */
const traceDiscoverSchema = z.object({
  facets: z.array(
    z
      .object({
        key: z.string(),
        kind: z.enum(["categorical", "range", "dynamic_keys"]),
        label: z.string(),
        group: z.string(),
      })
      .passthrough(),
  ),
  pending: z
    .boolean()
    .describe(
      "True when the payload is still being computed and what you have is the last committed one, possibly empty. Call again shortly.",
    ),
});

const traceFacetValuesSchema = z.object({
  values: z.array(
    z.object({
      value: z.string(),
      label: z.string().optional(),
      count: z.number(),
    }),
  ),
  total: z
    .number()
    .describe("Distinct values the field holds in the window, before paging."),
  hasMore: z.boolean(),
});

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
    filter: z
      .string()
      .max(MAX_TRACE_FILTER_LENGTH)
      .optional()
      .describe(
        "A trace filter string in the same language the Trace Explorer's search bar speaks — `status:error AND model:gpt-*`, " +
          "`trace.attribute.langwatch.user_id:alice`, `evaluatorVerdict:fail`, a quoted phrase for free text. " +
          "It is combined with `filters`, `query` and `traceIds` rather than replacing any of them, so every condition you send must hold. " +
          "`GET /api/v1/query/reference` lists every field and the syntax; `GET /api/traces/facets` says what values a field actually holds. " +
          "A malformed filter, or one naming a field the language does not have, is a 422 that names the field.",
      ),
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
    zValidator("json", traceSearchBodySchema),
    async (c) => {
      const project = c.get("project");
      const params = c.req.valid("json");
      const {
        from,
        select,
        dateField,
        filter,
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

      const projection = compileSelectProjection({
        from,
        select,
        protections,
      });

      const startDate = coerceToEpoch(params.startDate);
      const endDate = coerceToEpoch(params.endDate);
      // The same default the Trace Explorer applies: Langy's own turns trace
      // into the project but are not its traffic, so a search that names no
      // origin leaves them out and its count is the count the Explorer shows.
      // Naming an origin, in the filter string or the legacy filter map, is
      // the caller choosing origins, and the default steps aside.
      const originFilter = searchFields.filters?.["traces.origin"];
      const namesOriginFilter =
        originFilter !== undefined &&
        (Array.isArray(originFilter)
          ? originFilter.length > 0
          : Object.keys(originFilter).length > 0);
      const filterWhere = withHiddenOrigins(
        compileTraceFilter({
          filter,
          tenantId: project.id,
          timeRange: { from: startDate, to: endDate },
          dateField,
        }),
        namesOriginFilter ? [] : explorerHiddenOrigins(filter),
      );

      const traceService = TraceService.create(prisma);
      const results = await traceService.getAllTracesForProject(
        {
          ...searchFields,
          projectId: project.id,
          startDate,
          endDate,
          pageSize,
        },
        protections,
        {
          downloadMode: true,
          includeSpans: includeSpans ?? false,
          scrollId: scrollId ?? undefined,
          dateField,
          projection: projection?.plan,
          ...(filterWhere ? { filterWhere } : {}),
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
              path: `/traces/${trace.trace_id}`,
            }),
          };
        }
        return {
          ...trace,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/traces/${trace.trace_id}`,
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

  registerFacetsRoute(secured);

  // GET /:traceId/transcript - the coding-agent transcript for one trace
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

      logger.info(
        { projectId: project.id, traceId },
        "Getting trace transcript",
      );

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

      const transcript = await readCodingAgentTranscriptWithProtections({
        projectId: project.id,
        traceId: trace.trace_id,
        occurredAtMs: trace.timestamps.started_at,
        protections,
      });

      return c.json(transcript);
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

      const protections = await getProtectionsForProject(prisma, {
        projectId: project.id,
      });
      const traceService = TraceService.create(
        prisma,
        buildTraceBlobResolutionDeps(),
      );

      let trace;
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
          platformUrl: platformUrl({
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
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/traces/${resolvedTraceId}`,
        }),
      });
    },
  );

  // PATCH /:traceId/metadata - Update trace metadata via synthetic span
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

/** The OpenAPI description of `GET /facets`. */
const FACETS_ROUTE_DOC: Parameters<typeof describeRoute>[0] = {
  tags: ["Traces"],
  summary: "Discover what the trace filter fields hold",
  description: FACETS_DESCRIPTION,
  parameters: [
    {
      name: "field",
      in: "query",
      description:
        "The field to list values for — a filter field name (`model`, `status`, `evaluator`) or an attribute key under one of the namespace prefixes (`trace.attribute.<key>`, `span.attribute.<key>`, `event.attribute.<key>`). Omit it to get every facet with its top values instead.",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "prefix",
      in: "query",
      description:
        "Only values starting with this. Needs `field`; ignored without it.",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "limit",
      in: "query",
      description: "Values per page, 1 to 1000. Default 50. Needs `field`.",
      required: false,
      schema: { type: "integer" },
    },
    {
      name: "offset",
      in: "query",
      description: "Values to skip. Default 0. Needs `field`.",
      required: false,
      schema: { type: "integer" },
    },
    {
      name: "startDate",
      in: "query",
      description:
        "Window start, ISO string or epoch milliseconds. Default 24 hours ago.",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "endDate",
      in: "query",
      description: "Window end, ISO string or epoch milliseconds. Default now.",
      required: false,
      schema: { type: "string" },
    },
  ],
  responses: {
    ...baseResponses,
    403: {
      description:
        "The field is an attribute key and this project hides captured input or output, so its values are not listed.",
      content: {
        "application/json": {
          schema: resolver(traceFacetsWithheldErrorSchema),
        },
      },
    },
    422: {
      description:
        "The query did not name a facet with values to list. `fields` names the offending parameter and each reason carries what was received and what exists.",
      content: {
        "application/json": {
          schema: resolver(traceFacetsValidationErrorSchema),
        },
      },
    },
    200: {
      description:
        "Without `field`, every facet the project has with its top values and whether the payload is still being computed. With `field`, that field's values and counts plus the distinct total and whether more remain.",
      content: {
        "application/json": {
          schema: resolver(
            z.union([traceDiscoverSchema, traceFacetValuesSchema]),
          ),
        },
      },
    },
  },
};

/**
 * The window a facet may actually read, given the caller's retention cutoff.
 *
 * A plan's retention limit hides content older than `visibilityCutoffMs` from
 * the read path. An attribute value IS that content, so listing distinct values
 * over an unbounded window would hand back, one value at a time, what a trace
 * read of the same rows redacts. Raising the window's floor is what applies the
 * cutoff here: the facet cache keys on the range, so a clamped window is its
 * own cache slot rather than a poisoned copy of the unclamped one.
 *
 * Only for the open-ended attribute namespaces. A registry facet is a known
 * dimension (a model name, a status, an evaluator id) that the read path does
 * not redact, and clamping those would shrink a window the Trace Explorer reads
 * in full.
 */
function visibleWindow({
  timeRange,
  facetKey,
  protections,
}: {
  timeRange: { from: number; to: number };
  facetKey: string;
  protections: Protections;
}): { from: number; to: number } {
  const cutoff = protections.visibilityCutoffMs;
  if (cutoff === null || cutoff === undefined) return timeRange;
  if (!isAttributeFacetKey(facetKey)) return timeRange;
  return { from: Math.max(timeRange.from, cutoff), to: timeRange.to };
}

/**
 * `GET /facets`: what the filter fields actually hold.
 *
 * Registered BEFORE `/:traceId`: hono matches in registration order, so the
 * trace-by-id route would otherwise take `facets` for a trace id and answer
 * not found. Its own function because the registration is long enough to
 * bury the two routes around it.
 */
function registerFacetsRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured
    .access(requires("traces:view"))
    .get(
      "/facets",
      describeRoute(FACETS_ROUTE_DOC),
      zValidator("query", traceFacetsQuerySchema),
      async (c) => {
        const project = c.get("project");
        const { field, prefix, limit, offset, startDate, endDate } =
          c.req.valid("query");

        // One clock read for both ends: two calls can land in different
        // milliseconds, and the default window would then run over a day.
        const now = Date.now();
        const timeRange = {
          from:
            startDate === undefined
              ? now - DAY_MS
              : facetWindowBound(startDate),
          to: endDate === undefined ? now : facetWindowBound(endDate),
        };

        const list = getApp().traces.list;

        if (field === undefined) {
          const discover = await list.getDiscover({
            tenantId: project.id,
            timeRange,
          });
          return c.json(discover);
        }

        const protections = await getProtectionsForProject(prisma, {
          projectId: project.id,
        });
        const facetKey = resolveFacetKey({ field, protections });
        const result = await list.getFacetValues({
          tenantId: project.id,
          timeRange: visibleWindow({ timeRange, facetKey, protections }),
          facetKey,
          limit,
          offset,
          ...(prefix === undefined ? {} : { prefix }),
        });
        return c.json({
          values: result.values,
          total: result.totalDistinct,
          hasMore: offset + result.values.length < result.totalDistinct,
        });
      },
    );
}

/**
 * The compiled projection for a `select`, or undefined when there is none.
 *
 * The compiled plan drives column pruning and child-collection joins in the
 * engine; the resolved schema goes into the response envelope; the projector
 * replaces `formatTrace` per row.
 *
 * An unknown select path is a validation failure like any other: the body
 * parsed, and a field in it names something that does not exist. So it travels
 * the same channel as a schema failure rather than as an anonymous 400, with
 * the same code, the same 422 and one reason per offending path.
 */
function compileSelectProjection({
  from,
  select,
  protections,
}: {
  from: ProjectionFrom | undefined;
  select: string[] | undefined;
  protections: Protections;
}): CompiledProjection | undefined {
  if (!select || select.length === 0) return undefined;
  try {
    return compileProjection({ from, select, protections });
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
