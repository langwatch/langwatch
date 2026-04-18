/**
 * Hono routes for legacy trace endpoints.
 *
 * Replaces:
 * - src/pages/api/trace/[id].ts
 * - src/pages/api/trace/[id]/share.ts
 * - src/pages/api/trace/[id]/unshare.ts
 * - src/pages/api/trace/search.ts
 * - src/pages/api/thread/[id].ts
 */
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import { getProtectionsForProject } from "~/server/api/utils";
import { createShare } from "~/server/api/routers/share";
import { unshareItem } from "~/server/api/routers/share";
import { getAllForProjectInput } from "~/server/api/routers/traces.schemas";
import { prisma } from "~/server/db";
import { generateAsciiTree } from "~/server/traces/trace-formatting";
import {
  toLLMModeTrace,
  formatTraceSummaryDigest,
} from "~/server/traces/trace-formatting";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import { TraceService } from "~/server/traces/trace.service";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import type { Span, Trace } from "~/server/tracer/types";
import type { Permission } from "~/server/api/rbac";
import {
  enforcePatCeiling,
  extractCredentials,
} from "~/server/pat/auth-middleware";
import { TokenResolver } from "~/server/pat/token-resolver";

const tokenResolver = TokenResolver.create(prisma);

export const app = new Hono().basePath("/api");

/**
 * Authenticates via the unified PAT + legacy-key path and enforces the given
 * permission ceiling. Returns either `{ project, markUsed }` or
 * `{ error, status }`. `markUsed` is fire-and-forget and a no-op for legacy
 * keys — callers invoke it after a successful response.
 */
async function authenticateRequest(c: Context, permission: Permission) {
  const credentials = extractCredentials(c);
  if (!credentials) {
    return {
      error:
        "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).",
      status: 401 as const,
    };
  }

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    return { error: "Invalid auth token.", status: 401 as const };
  }

  const denial = await enforcePatCeiling({ prisma, resolved, permission });
  if (denial) {
    return { error: denial.error, status: denial.status };
  }

  const markUsed = () => {
    if (resolved.type === "pat") {
      tokenResolver.markUsed({ patId: resolved.patId });
    }
  };

  return { project: resolved.project, markUsed };
}

// ---------- GET /api/trace/:id ----------
app.get("/trace/:id", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json({ message: auth.error }, auth.status);
  }
  const { project } = auth;

  try {
    const traceId = c.req.param("id");
    const formatParam = c.req.query("format");
    const llmMode =
      c.req.query("llmMode") === "true" ||
      c.req.query("llmMode") === "1";
    const format = formatParam ?? (llmMode ? "digest" : "json");

    c.header("Deprecation", "true");
    c.header(
      "Link",
      `</api/traces/${traceId}?format=${format}>; rel="successor-version"`,
    );

    const protections = await getProtectionsForProject(prisma, {
      projectId: project.id,
    });
    const traceService = TraceService.create(prisma);
    const trace = await traceService.getById(
      project.id,
      traceId,
      protections,
    );
    if (!trace) {
      return c.json({ message: "Trace not found." }, 404);
    }

    const evaluationsMap = await traceService.getEvaluationsMultiple(
      project.id,
      [traceId],
      protections,
    );
    const evaluations = evaluationsMap[traceId] ?? [];

    if (format === "digest") {
      return c.json({
        trace_id: traceId,
        formatted_trace: formatSpansDigest(trace.spans ?? []),
        timestamps: trace.timestamps,
        metadata: trace.metadata,
        evaluations,
      });
    }

    const asciiTree = generateAsciiTree(trace.spans);

    return c.json({
      ...trace,
      evaluations,
      ascii_tree: asciiTree,
    });
  } catch (error) {
    console.error("[API /api/trace/:id] Error:", error);
    return c.json(
      {
        message: "Internal Server Error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      500,
    );
  }
});

// ---------- POST /api/trace/:id/share ----------
app.post("/trace/:id/share", async (c) => {
  const auth = await authenticateRequest(c, "traces:share");
  if ("error" in auth) {
    return c.json({ message: auth.error }, auth.status);
  }
  const { project } = auth;

  const traceId = c.req.param("id");

  const share = await createShare({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: traceId,
  });

  return c.json({ status: "success", path: `/share/${share.id}` });
});

// ---------- POST /api/trace/:id/unshare ----------
app.post("/trace/:id/unshare", async (c) => {
  const auth = await authenticateRequest(c, "traces:share");
  if ("error" in auth) {
    return c.json({ message: auth.error }, auth.status);
  }
  const { project } = auth;

  const traceId = c.req.param("id");

  await unshareItem({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: traceId,
  });

  return c.json({ status: "success" });
});

// ---------- POST /api/trace/search ----------
const paramsSchema = getAllForProjectInput
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
    format: z.enum(["digest", "json"]).optional(),
    llmMode: z.boolean().optional().default(false),
  });

app.post("/trace/search", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json({ message: auth.error }, auth.status);
  }
  const { project } = auth;

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid body" }, 400);
  }

  let params: z.infer<typeof paramsSchema>;
  try {
    params = paramsSchema.strict().parse(body);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return c.json({ error: validationError.message }, 400);
  }

  const format = params.format ?? (params.llmMode ? "digest" : "json");

  c.header("Deprecation", "true");
  c.header("Link", `</api/traces/search>; rel="successor-version"`);

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
      downloadMode: true,
      scrollId: params.scrollId ?? undefined,
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
    }));
  } else if (params.llmMode) {
    traces = enrichedTraces.map((trace) => ({
      ...toLLMModeTrace(trace as Trace & { spans: Span[] }),
      spans: [],
      evaluations: trace.evaluations,
    }));
  } else {
    traces = enrichedTraces;
  }

  return c.json({
    traces,
    pagination: {
      totalHits: results.totalHits,
      scrollId: results.scrollId,
    },
  });
});

// ---------- GET /api/thread/:id ----------
app.get("/thread/:id", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json({ message: auth.error }, auth.status);
  }
  const { project } = auth;

  const threadId = c.req.param("id");
  const protections = await getProtectionsForProject(prisma, {
    projectId: project.id,
  });
  const traceService = TraceService.create(prisma);
  const traces = await traceService.getTracesByThreadId(
    project.id,
    threadId,
    protections,
  );

  return c.json({ traces });
});
