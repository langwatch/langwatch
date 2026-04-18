import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { getProtectionsForProject } from "~/server/api/utils";
import { prisma } from "~/server/db";
import type { Span, Trace } from "~/server/tracer/types";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import { generateAsciiTree, formatTraceSummaryDigest } from "~/server/traces/trace-formatting";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import {
  AmbiguousTraceIdPrefixError,
  TraceService,
} from "~/server/traces/trace.service";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { coerceToEpoch, flexibleDateSchema } from "../../shared/schemas";
import { getAllForProjectInput } from "~/server/api/routers/traces.schemas";

const logger = createLogger("langwatch:api:traces");

// Define types for our Hono context variables
type Variables = AuthMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Body schema for the search endpoint: reuses getAllForProjectInput but adjusts
// startDate/endDate to accept ISO strings alongside epoch numbers, and adds
// scrollId and format fields. llmMode is kept for backward compatibility.
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
        "Output format: 'digest' (AI-readable trace digest) or 'json' (full raw data)"
      ),
    includeSpans: z
      .boolean()
      .optional()
      .describe(
        "When true, fetches full span data for each trace. Useful for bulk export. Default false."
      ),
    llmMode: z.boolean().optional(),
  });

// POST /search - Search traces for a project
app.post(
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
                }),
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
      },
    );

    const rawTraces = results.groups.flat() as Trace[];
    const enrichedTraces = enrichTracesWithEvaluations({
      traces: rawTraces,
      traceChecks: results.traceChecks,
    });

    let traces: unknown[];
    if (format === "digest") {
      traces = enrichedTraces.map((trace) => ({
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
      }));
    } else {
      traces = enrichedTraces.map((trace) => ({
        ...trace,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/messages/${trace.trace_id}`,
        }),
      }));
    }

    return c.json({
      traces,
      pagination: {
        totalHits: results.totalHits,
        scrollId: results.scrollId,
      },
    });
  },
);

// GET /:traceId - Get a single trace by ID
app.get(
  "/:traceId",
  describeRoute({
    description:
      "Get a single trace by ID. Defaults to JSON format (pass `format=digest` for an AI-readable summary). Accepts either the full 32-character trace ID or a unique prefix of at least 8 characters (git-style shortcut). Returns 404 if no trace matches and 409 if a prefix matches more than one trace.",
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
            schema: resolver(
              z.object({ message: z.string() }),
            ),
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

    logger.info(
      { projectId: project.id, traceId },
      "Getting trace by ID",
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
