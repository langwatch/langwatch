/**
 * The deprecated trace family: `GET /api/trace/:id`, `POST /api/trace/:id/share`,
 * `POST /api/trace/:id/unshare`, `POST /api/trace/search` and `GET /api/thread/:id`.
 * Was `platform/app/src/server/routes/traces-legacy.ts`, itself a replacement for
 * five `pages/api` handlers. The two routes that have a successor carry
 * `Deprecation: true` and a `Link` naming it; the bodies are transcribed rather
 * than rewritten, because a released SDK parses them.
 *
 * Declared public because the family resolves its own project credential through
 * `app.credential` rather than the framework's project-key door: its refusals
 * predate the framework envelope (a bare `{ message }` for an unauthenticated
 * caller, the full handled payload for a ceiling denial), and a declared `project`
 * door does not let a route choose the sentence it refuses with.
 *
 * These five addresses ARE authenticated. The reads resolve `traces:view` and the
 * share pair resolves `traces:share` — in the handler, through the resolver the
 * process supplies, exactly where they were resolved before. `publicRoute` is the
 * only access kind the framework's closed `RouteAccess` union admits for a
 * handler-resolved door: `handlerManagedAuth` is not one of the four members, and
 * the runtime synthesises a handler-managed registry entry only from a declared
 * `withPermission`, which would put the framework door in front of the handler and
 * rewrite the two refusal bodies a released SDK parses. The recorded cost of
 * choosing the wire over the label is that the address inventory shows a
 * credential of `public` and a credential class of `none` for these five
 * addresses, which is wrong about them; the permission each one enforces is
 * written into its `reason` so an audit reading the registry finds it there.
 *
 * The addresses are literal with no `/api/v1` twin: they are the exact paths the
 * released SDK dials, and a superseded family negotiates no dated contract.
 */
import { TraceReadableSpanService } from "#services/read/trace-readable-span.service";
import { TraceFormattingService } from "#services/support/trace-formatting.service";
import { enrichTracesWithEvaluations } from "#rules/trace-evaluation-enrichment.rules";
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestCredentialPrincipal,
  type RestRawResult,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/runtime-composition";
import {
  traceFormatQuerySchema,
  traceLegacyIdParamsSchema,
  type Evaluation,
  type Span,
  type Trace,
  type TraceLegacyListInput,
  type TracesForProjectResult,
} from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

const PRODUCES_JSON = "application/json";

/** A resolved project credential, or the refusal this family publishes. */
export type TraceLegacyCredential =
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string }>;
      /** What the redactions are resolved FOR: the key, never its holder. */
      credential: RestCredentialPrincipal;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/**
 * How this process turns a request plus one permission ceiling into a project
 * credential. The permission travels with the request because the family is
 * split by grain: reads ask for `traces:view`, the share pair asks for
 * `traces:share`, which mints a PUBLIC link.
 */
export type TraceLegacyCredentialResolver = (input: {
  request: Request;
  permission: "traces:view" | "traces:share";
}) => Promise<TraceLegacyCredential>;

/** The trace reads these five routes answer from. */
export interface TraceLegacyReads {
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
export interface TraceLegacyShare {
  createShare(
    input: Readonly<{ projectId: string; resourceType: "TRACE"; resourceId: string }>,
  ): Promise<Readonly<{ id: string }>>;
  unshare(
    input: Readonly<{ projectId: string; resourceType: "TRACE"; resourceId: string }>,
  ): Promise<void>;
}

/** What the legacy trace family needs from the process. */
export interface TraceLegacyRestMembers<TSearchBody, TSearchBodyRaw> {
  credential: TraceLegacyCredentialResolver;
  /** The reads. Resolved per request, never constructed at mount. */
  traces(): TraceLegacyReads;
  /** The share ledger, resolved the same way. */
  shares(): TraceLegacyShare;
  /**
   * The API KEY caller's read-time redactions for one project. Same resolution
   * the v1 family uses — a key is not a person, so content categories resolve as
   * they do for a caller with no session, and costs are visible because a project
   * key carries full project access.
   */
  getProtections(
    input: Readonly<{ projectId: string; credential: RestCredentialPrincipal }>,
  ): Promise<unknown>;
  /**
   * The search body a caller may send: the deployment's shared analytics filter
   * vocabulary plus this family's own four additive fields. Parsed STRICTLY here,
   * unlike the v1 family — this deprecated endpoint has always behaved that way,
   * and loosening it would silently accept a typo the caller currently gets told
   * about.
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

export const TraceLegacyApi =
  moduleApi<TraceLegacyRestMembers<TraceLegacySearchFields, unknown>>("trace");

/** One answer, in the shape `c.json(body, status)` used to write. */
function answer(
  body: unknown,
  status: ContentfulStatusCode,
  headers: Readonly<Record<string, string>> = {},
): RestRawResult {
  return {
    status,
    headers: { "content-type": PRODUCES_JSON, ...headers },
    body: JSON.stringify(body),
  };
}

/** The two headers a superseded route names its replacement with. */
function supersededBy(successor: string): Readonly<Record<string, string>> {
  return { Deprecation: "true", Link: `<${successor}>; rel="successor-version"` };
}

/** The three shapes the deprecated search answers in: digest, LLM mode, or the traces as read. */
function legacySearchTraces(
  enrichedTraces: Trace[],
  options: Readonly<{ format: string; llmMode: boolean }>,
): unknown[] {
  if (options.format === "digest") {
    return enrichedTraces.map((trace) => ({
      trace_id: trace.trace_id,
      formatted_trace: TraceFormattingService.formatTraceSummaryDigest(trace),
      input: trace.input,
      output: trace.output,
      timestamps: trace.timestamps,
      metadata: trace.metadata,
      error: trace.error,
      evaluations: trace.evaluations,
    }));
  }

  if (options.llmMode) {
    return enrichedTraces.map((trace) => ({
      ...TraceFormattingService.toLLMModeTrace(trace as Trace & { spans: Span[] }),
      spans: [],
      evaluations: trace.evaluations,
    }));
  }

  return enrichedTraces;
}

const READ_REASON =
  "Trace API key resolved in-handler, so the refusal carries this family's own sentence; " +
  "the route itself is gated on traces:view";
const SHARE_REASON =
  "Trace API key resolved in-handler, so the refusal carries this family's own sentence; " +
  "the route itself is gated on traces:share, which mints a PUBLIC link";

export const traceLegacyRest = defineRestRouter(TraceLegacyApi)
  .withNamespace("trace-legacy")
  .withVersion(MANAGEMENT_API_VERSION)
  // The exact addresses a released SDK dials, with no `/api/v1` twin beside them.
  .withAddressing("literal", { v1Twin: false })

  // ── the deprecated single-trace read ──────────────────────────────────────
  .get("/api/trace/:id", "getLegacyTrace")
  .withParams(traceLegacyIdParamsSchema)
  .withQuery(traceFormatQuerySchema)
  .withAccess(publicRoute({ reason: READ_REASON }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const auth = await app.credential({ request, permission: "traces:view" });
    if (!auth.ok) return answer(auth.body, auth.status);
    const { project, credential, markUsed } = auth;

    // No catch-all here: an unanticipated failure is the shared error
    // renderer's to answer, which degrades it to the generic unknown plus the
    // request's trace id. Rendering it here put the internal message, the
    // absolute source paths and the stack frames in front of a customer.
    const traceId = input.id;
    const llmMode = input.llmMode === "true" || input.llmMode === "1";
    const format = input.format ?? (llmMode ? "digest" : "json");

    // Prepared before the read, so the 404 below carries them too.
    const headers = supersededBy(`/api/traces/${traceId}?format=${format}`);

    const protections = await app.getProtections({ projectId: project.id, credential });
    // `readTrace` resolves offloaded values in full (#4991) — the same
    // `{ full: true }` this handler used to pass for itself.
    const trace = await app.traces().readTrace({
      projectId: project.id,
      traceId,
      protections,
    });
    if (!trace) return answer({ message: "Trace not found." }, 404, headers);

    const evaluationsMap = await app.traces().readEvaluations({
      projectId: project.id,
      traceIds: [traceId],
      protections,
    });
    const evaluations = evaluationsMap[traceId] ?? [];

    markUsed();

    if (format === "digest") {
      return answer(
        {
          trace_id: traceId,
          formatted_trace: TraceReadableSpanService.formatSpansDigest(trace.spans ?? []),
          timestamps: trace.timestamps,
          metadata: trace.metadata,
          evaluations,
        },
        200,
        headers,
      );
    }

    return answer(
      {
        ...trace,
        evaluations,
        ascii_tree: TraceFormattingService.generateAsciiTree(trace.spans),
      },
      200,
      headers,
    );
  })

  // ── the public-link pair ──────────────────────────────────────────────────
  //
  // Neither names a successor, so neither carries the deprecation headers the
  // read and the search do.
  .post("/api/trace/:id/share", "shareLegacyTrace")
  .withParams(traceLegacyIdParamsSchema)
  .withAccess(publicRoute({ reason: SHARE_REASON }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const auth = await app.credential({ request, permission: "traces:share" });
    if (!auth.ok) return answer(auth.body, auth.status);
    const { project, markUsed } = auth;

    const share = await app.shares().createShare({
      projectId: project.id,
      resourceType: "TRACE",
      resourceId: input.id,
    });

    markUsed();

    return answer({ status: "success", path: `/share/${share.id}` }, 200);
  })

  .post("/api/trace/:id/unshare", "unshareLegacyTrace")
  .withParams(traceLegacyIdParamsSchema)
  .withAccess(publicRoute({ reason: SHARE_REASON }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const auth = await app.credential({ request, permission: "traces:share" });
    if (!auth.ok) return answer(auth.body, auth.status);
    const { project, markUsed } = auth;

    await app.shares().unshare({
      projectId: project.id,
      resourceType: "TRACE",
      resourceId: input.id,
    });

    markUsed();

    return answer({ status: "success" }, 200);
  })

  // ── the deprecated trace search ───────────────────────────────────────────
  //
  // The body is the evidence: it is read once and parsed by the family's own
  // schema, so a malformed payload earns the sentence a deployed SDK parses.
  .post("/api/trace/search", "searchLegacyTraces")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: READ_REASON }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }): Promise<RestRawResult> => {
    const auth = await app.credential({ request, permission: "traces:view" });
    if (!auth.ok) return answer(auth.body, auth.status);
    const { project, credential, markUsed } = auth;

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return answer({ error: "Invalid body" }, 400);
    }

    const parsed = app.searchBodySchema.safeParse(body);
    if (!parsed.success) {
      return answer({ error: app.describeValidationError(parsed.error) }, 400);
    }
    const params = parsed.data as TraceLegacySearchFields & Record<string, unknown>;

    const format = params.format ?? (params.llmMode ? "digest" : "json");

    const headers = supersededBy("/api/traces/search");

    const pageSize = Math.min(params.pageSize ?? 1000, 1000);
    const protections = await app.getProtections({ projectId: project.id, credential });
    const results = await app.traces().listTraces({
      // The body carried the deployment's own filter vocabulary through the
      // members' schema, so it already IS a list input once the two date
      // spellings are collapsed; the cast names that rather than restating the
      // shape.
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

    const traces = legacySearchTraces(enrichedTraces, {
      format,
      llmMode: params.llmMode ?? false,
    });

    markUsed();

    return answer(
      {
        traces,
        pagination: {
          totalHits: results.totalHits,
          scrollId: results.scrollId,
        },
      },
      200,
      headers,
    );
  })

  // ── the deprecated thread read ────────────────────────────────────────────
  .get("/api/thread/:id", "getLegacyThread")
  .withParams(traceLegacyIdParamsSchema)
  .withAccess(publicRoute({ reason: READ_REASON }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const auth = await app.credential({ request, permission: "traces:view" });
    if (!auth.ok) return answer(auth.body, auth.status);
    const { project, credential, markUsed } = auth;

    const protections = await app.getProtections({ projectId: project.id, credential });
    // Thread-detail read consumes conversation content — `readThreadTraces`
    // resolves full IO (#4991), which is what this handler asked for itself.
    const traces = await app.traces().readThreadTraces({
      projectId: project.id,
      threadId: input.id,
      protections,
    });

    markUsed();

    return answer({ traces }, 200);
  })

  .build();
