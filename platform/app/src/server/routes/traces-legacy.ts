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
import { getAllForProjectInput } from "~/server/api/routers/traces.schemas";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import type { Span, Trace } from "~/server/tracer/types";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import { TraceService } from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
  toLLMModeTrace,
} from "~/server/traces/trace-formatting";

const tokenResolver = TokenResolver.create(prisma);

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

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    const message = "Invalid auth token.";
    return { error: message, status: 401 as const, body: { message } };
  }

  try {
    await enforceApiKeyCeiling({ prisma, resolved, permission });
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
      tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
    }
  };

  return { project: resolved.project, markUsed };
}

/** The trace id + response format (`digest`/`json`) named by the request. */
function resolveTraceIdFormat(c: Context): { traceId: string; format: string } {
  const traceId = c.req.param("id");
  const formatParam = c.req.query("format");
  const llmMode =
    c.req.query("llmMode") === "true" || c.req.query("llmMode") === "1";
  const format = formatParam ?? (llmMode ? "digest" : "json");
  return { traceId, format };
}

/** Loads the trace + its evaluations, or null when the trace does not exist. */
async function loadTraceById({
  project,
  traceId,
}: {
  project: { id: string };
  traceId: string;
}): Promise<{ trace: Trace; evaluations: unknown[] } | null> {
  const protections = await getProtectionsForProject(prisma, {
    projectId: project.id,
  });
  const traceService = TraceService.create(
    prisma,
    buildTraceBlobResolutionDeps(),
  );
  const trace = await traceService.getById({
    projectId: project.id,
    traceId,
    protections,
    opts: { full: true },
  });
  if (!trace) return null;

  const evaluationsMap = await traceService.getEvaluationsMultiple(
    project.id,
    [traceId],
    protections,
  );
  const evaluations = evaluationsMap[traceId] ?? [];
  return { trace, evaluations };
}

/** Shapes the loaded trace into the digest or full wire response. */
function formatTraceByIdResponse({
  traceId,
  format,
  trace,
  evaluations,
}: {
  traceId: string;
  format: string;
  trace: Trace;
  evaluations: unknown[];
}) {
  if (format === "digest") {
    return {
      trace_id: traceId,
      formatted_trace: formatSpansDigest(trace.spans ?? []),
      timestamps: trace.timestamps,
      metadata: trace.metadata,
      evaluations,
    };
  }

  const asciiTree = generateAsciiTree(trace.spans);
  return {
    ...trace,
    evaluations,
    ascii_tree: asciiTree,
  };
}

// ---------- GET /api/trace/:id ----------
secured.access(tracesViewAuth).get("/trace/:id", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  try {
    const { traceId, format } = resolveTraceIdFormat(c);

    c.header("Deprecation", "true");
    c.header(
      "Link",
      `</api/traces/${traceId}?format=${format}>; rel="successor-version"`,
    );

    const loaded = await loadTraceById({ project, traceId });
    if (!loaded) {
      return c.json({ message: "Trace not found." }, 404);
    }

    markUsed();

    return c.json(
      formatTraceByIdResponse({
        traceId,
        format,
        trace: loaded.trace,
        evaluations: loaded.evaluations,
      }),
    );
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

  const share = await getApp().share.createShare({
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

  await getApp().share.unshare({
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

/** Parses + validates the search request body, or the 400 response to
 *  return when it fails either step. */
async function parseTraceSearchRequest(
  c: Context,
): Promise<
  | { ok: true; params: z.infer<typeof paramsSchema> }
  | { ok: false; response: Response }
> {
  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "Invalid body" }, 400) };
  }

  try {
    const params = paramsSchema.strict().parse(body);
    return { ok: true, params };
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return {
      ok: false,
      response: c.json({ error: validationError.message }, 400),
    };
  }
}

/** Fetches the raw project trace search results for the validated params. */
async function fetchTraceSearchResults({
  project,
  params,
  pageSize,
}: {
  project: { id: string };
  params: z.infer<typeof paramsSchema>;
  pageSize: number;
}) {
  const protections = await getProtectionsForProject(prisma, {
    projectId: project.id,
  });
  const traceService = TraceService.create(prisma);
  return traceService.getAllTracesForProject(
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
}

/** Shapes the enriched traces per the requested format: digest summaries,
 *  LLM-mode traces (spans stripped), or the raw enriched traces. */
function shapeSearchTraces({
  format,
  llmMode,
  enrichedTraces,
}: {
  format: string;
  llmMode: boolean;
  enrichedTraces: ReturnType<typeof enrichTracesWithEvaluations>;
}): unknown[] {
  if (format === "digest") {
    return enrichedTraces.map((trace) => ({
      trace_id: trace.trace_id,
      formatted_trace: formatTraceSummaryDigest(trace),
      input: trace.input,
      output: trace.output,
      timestamps: trace.timestamps,
      metadata: trace.metadata,
      error: trace.error,
      evaluations: trace.evaluations,
    }));
  }
  if (llmMode) {
    return enrichedTraces.map((trace) => ({
      ...toLLMModeTrace(trace as Trace & { spans: Span[] }),
      spans: [],
      evaluations: trace.evaluations,
    }));
  }
  return enrichedTraces;
}

secured.access(tracesViewAuth).post("/trace/search", async (c) => {
  const auth = await authenticateRequest(c, "traces:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  const parsed = await parseTraceSearchRequest(c);
  if (!parsed.ok) return parsed.response;
  const { params } = parsed;

  const format = params.format ?? (params.llmMode ? "digest" : "json");

  c.header("Deprecation", "true");
  c.header("Link", `</api/traces/search>; rel="successor-version"`);

  const pageSize = Math.min(params.pageSize ?? 1000, 1000);
  const results = await fetchTraceSearchResults({ project, params, pageSize });

  const rawTraces = results.groups.flat() as Trace[];
  const enrichedTraces = enrichTracesWithEvaluations({
    traces: rawTraces,
    traceChecks: results.traceChecks,
  });

  const traces = shapeSearchTraces({
    format,
    llmMode: params.llmMode,
    enrichedTraces,
  });

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
  // Thread-detail read consumes conversation content — resolve full IO (#4991).
  const traceService = TraceService.create(
    prisma,
    buildTraceBlobResolutionDeps(),
  );
  const traces = await traceService.getTracesByThreadId({
    projectId: project.id,
    threadId,
    protections,
    opts: { full: true },
  });

  markUsed();
  return c.json({ traces });
});

export const app = secured.hono;
