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
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import type { Permission } from "~/server/api/rbac";
import { getAllForProjectInput } from "~/server/api/ports/traces.schemas";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth } from "@langwatch/platform-api/app-rest";
import { getProtectionsForProject } from "~/server/api/utils";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { prisma } from "~/server/db";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import type { Span, Trace } from "@langwatch/trace-contract";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
  toLLMModeTrace,
} from "~/server/traces/trace-formatting";

const AUTH_REASON = "project API key / public share resolved in-handler";

// Split by grain: the reads and the share/unshare pair are different powers,
// and `traces:share` creates PUBLIC links — exactly the sort of thing that must
// be legible in the registry rather than buried in a handler.
const tracesViewAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["traces:view"],
  credential: "apiKey",
});
const tracesShareAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["traces:share"],
  credential: "apiKey",
});

const secured = createServiceApp({ basePath: "/api" });

/**
 * Authenticates via the unified API-key + legacy-key path and enforces the given
 * permission ceiling. Returns either `{ project, markUsed }` or
 * `{ error, status, body }`, where `body` is what the route answers with —
 * a bare sentence for an unauthenticated call, and the full handled payload
 * (code, permission, tips) for a permission denial. `markUsed` is
 * fire-and-forget and a no-op for legacy keys — callers invoke it after a
 * successful response.
 */
async function authenticateRequest(c: Context, permission: Permission) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    const message =
      "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";
    return { error: message, status: 401 as const, body: { message } };
  }

  const apiKeys = c.app.apiKeys.apiKeyService;
  const resolved = await apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    const message = "Invalid auth token.";
    return { error: message, status: 401 as const, body: { message } };
  }

  try {
    await enforceApiKeyCeiling({ resolved, permission });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    return {
      error: denial.message,
      status: denial.status,
      body: denial.body,
    };
  }

  const markUsed = () => {
    if (resolved.type === "apiKey") {
      apiKeys.markUsed({ id: resolved.apiKeyId });
    }
  };

  return { project: resolved.project, markUsed };
}

// ---------- GET /api/trace/:id ----------
secured.access(tracesViewAuth).get("/trace/:id", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  try {
    const traceId = c.req.param("id");
    const formatParam = c.req.query("format");
    const llmMode = c.req.query("llmMode") === "true" || c.req.query("llmMode") === "1";
    const format = formatParam ?? (llmMode ? "digest" : "json");

    c.header("Deprecation", "true");
    c.header(
      "Link",
      `</api/traces/${traceId}?format=${format}>; rel="successor-version"`,
    );

    const protections = await getProtectionsForProject(prisma, {
      projectId: project.id,
    });
    // `readTrace` resolves offloaded values in full (#4991) — the same
    // `{ full: true }` this handler used to pass for itself.
    const trace = await c.app.traces.readTrace({
      projectId: project.id,
      traceId,
      protections,
    });
    if (!trace) {
      return c.json({ message: "Trace not found." }, 404);
    }

    const evaluationsMap = await c.app.traces.readEvaluations({
      projectId: project.id,
      traceIds: [traceId],
      protections,
    });
    const evaluations = evaluationsMap[traceId] ?? [];

    markUsed();

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
secured.access(tracesShareAuth).post("/trace/:id/share", async (c) => {
  const auth = await authenticateRequest(c, "traces:share");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  const traceId = c.req.param("id");

  const share = await c.app.share.createShare({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: traceId,
  });

  markUsed();
  return c.json({ status: "success", path: `/share/${share.id}` });
});

// ---------- POST /api/trace/:id/unshare ----------
secured.access(tracesShareAuth).post("/trace/:id/unshare", async (c) => {
  const auth = await authenticateRequest(c, "traces:share");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  const traceId = c.req.param("id");

  await c.app.share.unshare({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: traceId,
  });

  markUsed();
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

secured.access(tracesViewAuth).post("/trace/search", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

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
  const results = await c.app.traces.listTraces({
    query: {
      ...params,
      projectId: project.id,
      startDate:
        typeof params.startDate === "string"
          ? Date.parse(params.startDate)
          : params.startDate,
      endDate:
        typeof params.endDate === "string" ? Date.parse(params.endDate) : params.endDate,
      pageSize,
    },
    protections,
    options: {
      downloadMode: true,
      scrollId: params.scrollId ?? undefined,
    },
  });

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

  markUsed();
  return c.json({
    traces,
    pagination: {
      totalHits: results.totalHits,
      scrollId: results.scrollId,
    },
  });
});

// ---------- GET /api/thread/:id ----------
secured.access(tracesViewAuth).get("/thread/:id", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  const threadId = c.req.param("id");
  const protections = await getProtectionsForProject(prisma, {
    projectId: project.id,
  });
  // Thread-detail read consumes conversation content — `readThreadTraces`
  // resolves full IO (#4991), which is what this handler asked for itself.
  const traces = await c.app.traces.readThreadTraces({
    projectId: project.id,
    threadId,
    protections,
  });

  markUsed();
  return c.json({ traces });
});

export const app = secured.hono;
