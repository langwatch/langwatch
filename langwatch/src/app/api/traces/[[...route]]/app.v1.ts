import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { getProtectionsForProject } from "~/server/api/utils";
import { prisma } from "~/server/db";
import { getTraceById } from "~/server/elasticsearch/traces";
import type { LLMModeTrace, Span, Trace } from "~/server/tracer/types";
import {
  generateAsciiTree,
  toLLMModeTrace,
} from "~/server/traces/trace-formatting";
import { TraceService } from "~/server/traces/trace.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { getAllForProjectInput } from "~/server/api/routers/traces";

const logger = createLogger("langwatch:api:traces");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = AuthMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Body schema for the search endpoint: reuses getAllForProjectInput but adjusts
// startDate/endDate to accept ISO strings alongside epoch numbers, and adds
// scrollId and llmMode fields.
const traceSearchBodySchema = getAllForProjectInput
  .omit({
    projectId: true,
    startDate: true,
    endDate: true,
  })
  .extend({
    startDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for startDate",
      }),
    ]),
    endDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for endDate",
      }),
    ]),
    scrollId: z.string().optional().nullable(),
    llmMode: z.boolean().optional().default(false),
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

    logger.info({ projectId: project.id }, "Searching traces for project");

    const pageSize = Math.min(params.pageSize ?? 1000, 1000);
    const protections = await getProtectionsForProject(prisma, {
      projectId: project.id,
    });
    const traceService = TraceService.create(prisma);
    const results = await traceService.getAllTracesForProject(
      {
        ...params,
        projectId: project.id,
        startDate:
          typeof params.startDate === "string"
            ? Date.parse(params.startDate)
            : params.startDate,
        endDate:
          typeof params.endDate === "string"
            ? Date.parse(params.endDate)
            : params.endDate,
        pageSize,
      },
      protections,
      {
        downloadMode: !params.llmMode,
        scrollId: params.scrollId ?? undefined,
      },
    );

    let traces: (Trace | LLMModeTrace)[] = results.groups.flat();

    if (params.llmMode) {
      const llmModeTraces: LLMModeTrace[] = (traces as Trace[]).map(
        (trace) => ({
          ...toLLMModeTrace(trace as Trace & { spans: Span[] }),
          spans: [],
          evaluations: undefined,
        }),
      );
      traces = llmModeTraces;
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
    description: "Get a single trace by ID with spans, evaluations, and ASCII tree",
    parameters: [
      {
        name: "traceId",
        in: "path",
        description: "The trace ID",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "llmMode",
        in: "query",
        description:
          "When true, returns human-readable timestamps and ASCII tree in the root object",
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
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { traceId } = c.req.param();
    const llmModeParam = c.req.query("llmMode");
    const llmMode = llmModeParam === "true" || llmModeParam === "1";

    logger.info(
      { projectId: project.id, traceId },
      "Getting trace by ID",
    );

    const protections = await getProtectionsForProject(prisma, {
      projectId: project.id,
    });
    const trace = await getTraceById({
      connConfig: { projectId: project.id },
      traceId,
      protections,
      includeSpans: true,
      includeEvaluations: true,
    });

    if (!trace) {
      throw new HTTPException(404, {
        message: "Trace not found.",
      });
    }

    // Generate ASCII tree representation
    const asciiTree = generateAsciiTree(trace.spans);

    return c.json({
      ...(llmMode ? toLLMModeTrace(trace, asciiTree) : {}),
      spans: trace.spans,
      evaluations: trace.evaluations,
      ascii_tree: asciiTree,
      metadata: trace.metadata,
    });
  },
);
