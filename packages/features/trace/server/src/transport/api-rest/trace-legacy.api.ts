/**
 * REST for the deprecated trace endpoints: `GET /api/trace/:id`,
 * `POST /api/trace/:id/share`, `POST /api/trace/:id/unshare`,
 * `POST /api/trace/search` and `GET /api/thread/:id`.
 *
 * Was `platform/app/src/server/routes/traces-legacy.ts`, which itself replaced
 * five `pages/api` handlers. Every route carries `Deprecation: true` and a
 * successor `Link` where it has one; the bodies and the sentences are
 * transcribed rather than rewritten, because a deployed SDK parses them.
 *
 * The family resolves its own credential (`handlerManagedAuth`) because its
 * refusals predate the framework envelope: a bare `{ message }` for an
 * unauthenticated call and the full handled payload for a ceiling denial.
 * That resolution arrives as {@link TraceLegacyCredentialPort} so this door
 * and the framework chain decide the same thing about the same caller.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, SecuredApp } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type {
  Evaluation,
  Span,
  Trace,
  TraceLegacyListInput,
  TracesForProjectResult,
} from "@langwatch/trace-contract";
import type { Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import { enrichTracesWithEvaluations } from "#services/trace-evaluation-enrichment.rules";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
  toLLMModeTrace,
} from "#services/trace-formatting.service";
import { formatSpansDigest } from "#services/trace-readable-span.service";

const logger = createLogger("langwatch:api:trace-legacy");

const AUTH_REASON = "project API key / public share resolved in-handler";

/** A resolved project credential, or the refusal this family publishes. */
export type TraceLegacyCredential =
  | Readonly<{ ok: true; project: Readonly<{ id: string }>; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/**
 * How this process turns a request plus one permission ceiling into a project
 * credential.
 *
 * The permission travels with the request because the family is split by
 * grain: the reads ask for `traces:view`, and the share pair asks for
 * `traces:share`, which mints a PUBLIC link.
 */
export type TraceLegacyCredentialPort = (input: {
  request: Request;
  permission: "traces:view" | "traces:share";
}) => Promise<TraceLegacyCredential>;

/** The trace reads these five routes answer from. */
export interface TraceLegacyReadsPort {
  readTrace(
    input: Readonly<{ projectId: string; traceId: string; protections: unknown }>,
  ): Promise<Trace | undefined>;
  readEvaluations(
    input: Readonly<{ projectId: string; traceIds: string[]; protections: unknown }>,
  ): Promise<Record<string, Evaluation[]>>;
  listTraces(
    input: Readonly<{
      query: TraceLegacyListInput;
      protections: unknown;
      options?: Readonly<{ downloadMode?: boolean; scrollId?: string | undefined }>;
    }>,
  ): Promise<TracesForProjectResult>;
  readThreadTraces(
    input: Readonly<{ projectId: string; threadId: string; protections: unknown }>,
  ): Promise<Trace[]>;
}

/** The public-link ledger the share pair writes to. */
export interface TraceLegacySharePort {
  createShare(
    input: Readonly<{ projectId: string; resourceType: "TRACE"; resourceId: string }>,
  ): Promise<Readonly<{ id: string }>>;
  unshare(
    input: Readonly<{ projectId: string; resourceType: "TRACE"; resourceId: string }>,
  ): Promise<void>;
}

/** What the legacy trace family needs from the process. */
export interface TraceLegacyRestPorts<TSearchBody, TSearchBodyRaw> {
  credential: TraceLegacyCredentialPort;
  /** The reads. Resolved per request, never constructed at mount. */
  traces(): TraceLegacyReadsPort;
  /** The share ledger, resolved the same way. */
  shares(): TraceLegacySharePort;
  /**
   * The API KEY caller's read-time redactions for one project. Same
   * resolution the v1 family uses — a key is not a person, so the content
   * categories resolve as they do for a caller with no session, and costs
   * are visible because a project key carries full project access.
   */
  getProtections(input: Readonly<{ projectId: string }>): Promise<unknown>;
  /**
   * The search body a caller may send: the deployment's shared analytics
   * filter vocabulary plus this family's own four additive fields. Parsed
   * STRICTLY here, unlike the v1 family — that is the behaviour this
   * deprecated endpoint has always had, and loosening it would silently
   * accept a typo the caller currently gets told about.
   */
  searchBodySchema: z.ZodType<TSearchBody, TSearchBodyRaw>;
  /** Renders a schema failure as the one sentence this family answers with. */
  describeValidationError(error: unknown): string;
}

/** The four fields the legacy search body adds to the shared filter input. */
export type TraceLegacySearchFields = Readonly<{
  startDate: string | number;
  endDate: string | number;
  pageSize?: number | undefined;
  scrollId?: string | null | undefined;
  format?: "digest" | "json" | undefined;
  llmMode: boolean;
}>;

/**
 * The deprecated trace family, built against one process's security.
 *
 * Split by grain in the ACCESS declaration rather than by handler: the reads
 * and the share pair are different powers, and `traces:share` creates PUBLIC
 * links — exactly the sort of thing that must be legible in the route-policy
 * registry rather than buried in a handler.
 */
export function createTraceLegacyRestApp<
  TSearchBody extends TraceLegacySearchFields,
  TSearchBodyRaw,
>(options: {
  security: AppRestSecurity;
  ports: TraceLegacyRestPorts<TSearchBody, TSearchBodyRaw>;
}): SecuredApp<Env> {
  const { security, ports } = options;

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

  const secured = security.createServiceApp({ basePath: "/api" });

  // ---------- GET /api/trace/:id ----------
  secured.access(tracesViewAuth).get("/trace/:id", async (c) => {
    const auth = await ports.credential({ request: c.req.raw, permission: "traces:view" });
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    try {
      const traceId = c.req.param("id");
      const formatParam = c.req.query("format");
      const llmMode = c.req.query("llmMode") === "true" || c.req.query("llmMode") === "1";
      const format = formatParam ?? (llmMode ? "digest" : "json");

      c.header("Deprecation", "true");
      c.header("Link", `</api/traces/${traceId}?format=${format}>; rel="successor-version"`);

      const protections = await ports.getProtections({ projectId: project.id });
      // `readTrace` resolves offloaded values in full (#4991) — the same
      // `{ full: true }` this handler used to pass for itself.
      const trace = await ports.traces().readTrace({
        projectId: project.id,
        traceId,
        protections,
      });
      if (!trace) {
        return c.json({ message: "Trace not found." }, 404);
      }

      const evaluationsMap = await ports.traces().readEvaluations({
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
      logger.error({ error, path: "/api/trace/:id" }, "legacy trace read failed");
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
    const auth = await ports.credential({ request: c.req.raw, permission: "traces:share" });
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    const traceId = c.req.param("id");

    const share = await ports.shares().createShare({
      projectId: project.id,
      resourceType: "TRACE",
      resourceId: traceId,
    });

    markUsed();
    return c.json({ status: "success", path: `/share/${share.id}` });
  });

  // ---------- POST /api/trace/:id/unshare ----------
  secured.access(tracesShareAuth).post("/trace/:id/unshare", async (c) => {
    const auth = await ports.credential({ request: c.req.raw, permission: "traces:share" });
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    const traceId = c.req.param("id");

    await ports.shares().unshare({
      projectId: project.id,
      resourceType: "TRACE",
      resourceId: traceId,
    });

    markUsed();
    return c.json({ status: "success" });
  });

  // ---------- POST /api/trace/search ----------
  secured.access(tracesViewAuth).post("/trace/search", async (c) => {
    const auth = await ports.credential({ request: c.req.raw, permission: "traces:view" });
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body" }, 400);
    }

    const parsed = ports.searchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: ports.describeValidationError(parsed.error) }, 400);
    }
    const params = parsed.data as TraceLegacySearchFields & Record<string, unknown>;

    const format = params.format ?? (params.llmMode ? "digest" : "json");

    c.header("Deprecation", "true");
    c.header("Link", `</api/traces/search>; rel="successor-version"`);

    const pageSize = Math.min(params.pageSize ?? 1000, 1000);
    const protections = await ports.getProtections({ projectId: project.id });
    const results = await ports.traces().listTraces({
      // The body carried the deployment's own filter vocabulary through the
      // schema port, so it already IS a list input once the two date spellings
      // are collapsed; the cast names that rather than restating the shape.
      query: {
        ...params,
        projectId: project.id,
        startDate:
          typeof params.startDate === "string" ? Date.parse(params.startDate) : params.startDate,
        endDate: typeof params.endDate === "string" ? Date.parse(params.endDate) : params.endDate,
        pageSize,
      } as unknown as TraceLegacyListInput,
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
    const auth = await ports.credential({ request: c.req.raw, permission: "traces:view" });
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    const threadId = c.req.param("id");
    const protections = await ports.getProtections({ projectId: project.id });
    // Thread-detail read consumes conversation content — `readThreadTraces`
    // resolves full IO (#4991), which is what this handler asked for itself.
    const traces = await ports.traces().readThreadTraces({
      projectId: project.id,
      threadId,
      protections,
    });

    markUsed();
    return c.json({ traces });
  });

  return secured;
}
