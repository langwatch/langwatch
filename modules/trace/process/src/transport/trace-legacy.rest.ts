import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestCredentialPrincipal,
} from "@langwatch/api/rest";
import type { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/kernel/module-api";
import { resolveRequestBound } from "@langwatch/plans";
import { toEpochMs } from "@langwatch/time";
import {
  traceFormatQuerySchema,
  traceLegacyIdParamsSchema,
  traceLegacyReadResponseSchema,
  traceLegacySearchResponseSchema,
  traceLegacyShareResponseSchema,
  traceLegacyUnshareResponseSchema,
  type Evaluation,
  type Span,
  type Trace,
  type TraceLegacyListInput,
  type TracesForProjectResult,
} from "@langwatch/trace-contract";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import { enrichTracesWithEvaluations } from "#rules/trace-evaluation-enrichment.rules";
import {
  formatTraceSummaryDigest,
  generateAsciiTree,
  toLLMModeTrace,
} from "#rules/trace-formatting.rules";
import {
  isTraceDoorRefusal,
  traceDoorRefusalBody,
  traceDoorRefusalStatus,
} from "#rules/trace-ingest-refusal.rules";
import { traceLegacySearchBodySchema } from "#rules/trace-legacy-search-body.rules";
/**
 * Deprecated trace family (v0): GET /api/trace/:id, share/unshare/search, thread.
 * Declared public, resolves own credential, checks permissions in handler. Literal
 * paths (no versioning) that released SDKs dial.
 */

const PRODUCES_JSON = "application/json";

/**
 * The page a legacy search answers when the caller named no size: the
 * registry's free-tier bound, the same default this route always had. An
 * explicit size is clamped to the caller's tier by the application, not here.
 */
const DEFAULT_TRACES_PAGE_SIZE = resolveRequestBound("tracesPageSizeMax", "FREE");

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Search filters can name many ids; the bulk cap is the ceiling they get. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

/** A resolved project credential; a refusal is thrown, and this family renders it. */
export type TraceLegacyCredential = Readonly<{
  project: Readonly<{ id: string }>;
  /** What the redactions are resolved FOR: the key, never its holder. */
  credential: RestCredentialPrincipal;
  markUsed: () => void;
}>;

/**
 * How this process turns a request plus one permission ceiling into a
 * project credential. The permission travels with the request since reads
 * ask for `traces:view`, the share pair for `traces:share` (a PUBLIC link).
 */
export type TraceLegacyCredentialResolver = (input: {
  request: Request;
  permission: "traces:view" | "traces:share";
}) => Promise<TraceLegacyCredential>;

/** The trace reads these five routes answer from. */
export interface TraceLegacyReads {
  findTrace(
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
   * The API KEY caller's read-time redactions for one project. Same
   * resolution as v1: a key resolves content categories like a caller with
   * no session, but costs are visible (a project key has full access).
   */
  getProtections(
    input: Readonly<{ projectId: string; credential: RestCredentialPrincipal }>,
  ): Promise<unknown>;
  /**
   * Search body schema: strict parsing (method, not field).
   */
  searchBodySchema(): z.ZodType<TSearchBody, TSearchBodyRaw>;
  /** Renders a schema failure as the one sentence this family answers with. */
  describeValidationError(error: unknown): string;
  formatSpansDigest(input: { spans: Span[] }): Promise<string>;
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

/** One protocol answer, in the shape `c.json(body, status)` used to write. */
type LegacyAnswer = Readonly<{
  status: ContentfulStatusCode;
  mediaType: typeof PRODUCES_JSON;
  body: string;
  headers: Readonly<Record<string, string>>;
}>;

function answer(
  body: unknown,
  status: ContentfulStatusCode,
  headers: Readonly<Record<string, string>> = {},
): LegacyAnswer {
  return { status, mediaType: PRODUCES_JSON, body: JSON.stringify(body), headers };
}

type LegacyApp = TraceLegacyRestMembers<TraceLegacySearchFields, unknown>;

/** Answers the read for a resolved credential, or the refusal in this family's own body. */
async function authorised(
  input: Readonly<{
    app: LegacyApp;
    request: Request;
    permission: "traces:view" | "traces:share";
  }>,
  read: (auth: TraceLegacyCredential) => Promise<LegacyAnswer>,
): Promise<LegacyAnswer> {
  let auth: TraceLegacyCredential;
  try {
    auth = await input.app.credential({ request: input.request, permission: input.permission });
  } catch (error) {
    if (!isTraceDoorRefusal(error)) throw error;
    return refusalAnswer(error);
  }

  return read(auth);
}

function refusalAnswer(refusal: HandledError): LegacyAnswer {
  return answer(traceDoorRefusalBody(refusal), traceDoorRefusalStatus(refusal));
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
      formatted_trace: formatTraceSummaryDigest(trace),
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
      ...toLLMModeTrace(trace as Trace & { spans: Span[] }),
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

const LEGACY_PROTOCOL_REASON =
  "Released SDKs parse this deprecated family's own statuses and bodies, credential refusals included";

/** `readLegacyTrace`: one legacy route's read, for a resolved credential. */
async function readLegacyTrace({
  app,
  input,
  auth: { project, credential, markUsed },
}: {
  app: LegacyApp;
  input: z.infer<typeof traceLegacyIdParamsSchema> & z.infer<typeof traceFormatQuerySchema>;
  auth: TraceLegacyCredential;
}): Promise<LegacyAnswer> {
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
  // `findTrace` resolves offloaded values in full (#4991) — the same
  // `{ full: true }` this handler used to pass for itself.
  const trace = await app.traces().findTrace({
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
        formatted_trace: app.formatSpansDigest({ spans: trace.spans ?? [] }),
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
      ascii_tree: generateAsciiTree(trace.spans),
    },
    200,
    headers,
  );
}

/** `shareLegacyTrace`: one legacy route's read, for a resolved credential. */
async function shareLegacyTrace({
  app,
  input,
  auth: { project, markUsed },
}: {
  app: LegacyApp;
  input: z.infer<typeof traceLegacyIdParamsSchema>;
  auth: TraceLegacyCredential;
}): Promise<LegacyAnswer> {
  const share = await app.shares().createShare({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: input.id,
  });

  markUsed();

  return answer({ status: "success", path: `/share/${share.id}` }, 200);
}

/** `unshareLegacyTrace`: one legacy route's read, for a resolved credential. */
async function unshareLegacyTrace({
  app,
  input,
  auth: { project, markUsed },
}: {
  app: LegacyApp;
  input: z.infer<typeof traceLegacyIdParamsSchema>;
  auth: TraceLegacyCredential;
}): Promise<LegacyAnswer> {
  await app.shares().unshare({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: input.id,
  });

  markUsed();

  return answer({ status: "success" }, 200);
}

/** `searchLegacyTraces`: one legacy route's read, for a resolved credential. */
async function searchLegacyTraces({
  app,
  raw,
  auth: { project, credential, markUsed },
}: {
  app: LegacyApp;
  raw: string;
  auth: TraceLegacyCredential;
}): Promise<LegacyAnswer> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return answer({ error: "Invalid body" }, 400);
  }

  const parsed = app.searchBodySchema().safeParse(body);
  if (!parsed.success) {
    return answer({ error: app.describeValidationError(parsed.error) }, 400);
  }
  const params = parsed.data as TraceLegacySearchFields & Record<string, unknown>;

  const format = params.format ?? (params.llmMode ? "digest" : "json");

  const headers = supersededBy("/api/traces/search");

  const pageSize = params.pageSize ?? DEFAULT_TRACES_PAGE_SIZE;
  const protections = await app.getProtections({ projectId: project.id, credential });
  const query: TraceLegacyListInput = {
    ...params,
    projectId: project.id,
    startDate:
      typeof params.startDate === "string" ? toEpochMs(params.startDate) : params.startDate,
    endDate: typeof params.endDate === "string" ? toEpochMs(params.endDate) : params.endDate,
    pageSize,
  };
  const results = await app.traces().listTraces({
    query,
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
}

/** `readLegacyThread`: one legacy route's read, for a resolved credential. */
async function readLegacyThread({
  app,
  input,
  auth: { project, credential, markUsed },
}: {
  app: LegacyApp;
  input: z.infer<typeof traceLegacyIdParamsSchema>;
  auth: TraceLegacyCredential;
}): Promise<LegacyAnswer> {
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
}

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
  .withResponse("protocol", { produces: PRODUCES_JSON, because: LEGACY_PROTOCOL_REASON })
  .withDocs({
    description: "Returns single trace details based on the ID supplied",
    tags: ["Traces"],
    responses: {
      200: {
        description: "Trace details with spans and evaluations",
        content: { "application/json": { schema: resolver(traceLegacyReadResponseSchema) } },
      },
    },
  })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      await authorised({ app, request, permission: "traces:view" }, (auth) =>
        readLegacyTrace({ app, input, auth }),
      ),
    ),
  )

  // ── the public-link pair ──────────────────────────────────────────────────
  //
  // Neither names a successor, so neither carries the deprecation headers the
  // read and the search do.
  .post("/api/trace/:id/share", "shareLegacyTrace")
  .withParams(traceLegacyIdParamsSchema)
  .withAccess(publicRoute({ reason: SHARE_REASON }))
  .withResponse("protocol", { produces: PRODUCES_JSON, because: LEGACY_PROTOCOL_REASON })
  .withDocs({
    description: "Returns a public path for a trace",
    tags: ["Traces"],
    responses: {
      200: {
        description: "Public path created",
        content: { "application/json": { schema: resolver(traceLegacyShareResponseSchema) } },
      },
    },
  })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      await authorised({ app, request, permission: "traces:share" }, (auth) =>
        shareLegacyTrace({ app, input, auth }),
      ),
    ),
  )

  .post("/api/trace/:id/unshare", "unshareLegacyTrace")
  .withParams(traceLegacyIdParamsSchema)
  .withAccess(publicRoute({ reason: SHARE_REASON }))
  .withResponse("protocol", { produces: PRODUCES_JSON, because: LEGACY_PROTOCOL_REASON })
  .withDocs({
    description: "Deletes a public path for a trace",
    tags: ["Traces"],
    responses: {
      200: {
        description: "Public path deleted",
        content: { "application/json": { schema: resolver(traceLegacyUnshareResponseSchema) } },
      },
    },
  })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      await authorised({ app, request, permission: "traces:share" }, (auth) =>
        unshareLegacyTrace({ app, input, auth }),
      ),
    ),
  )

  // ── the deprecated trace search ───────────────────────────────────────────
  //
  // The body is the evidence: it is read once and parsed by the family's own
  // schema, so a malformed payload earns the sentence a deployed SDK parses.
  .post("/api/trace/search", "searchLegacyTraces")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(publicRoute({ reason: READ_REASON }))
  .withResponse("protocol", { produces: PRODUCES_JSON, because: LEGACY_PROTOCOL_REASON })
  .withDocs({
    summary: "Search traces",
    description: "Search for traces based on given criteria",
    tags: ["Traces"],
    requestBody: { schema: traceLegacySearchBodySchema },
    responses: {
      200: {
        description: "Successful response",
        content: { "application/json": { schema: resolver(traceLegacySearchResponseSchema) } },
      },
    },
  })
  .handle(async ({ app, raw, request, response }) =>
    response.write(
      await authorised({ app, request, permission: "traces:view" }, (auth) =>
        searchLegacyTraces({ app, raw, auth }),
      ),
    ),
  )

  // ── the deprecated thread read ────────────────────────────────────────────
  .get("/api/thread/:id", "getLegacyThread")
  .withParams(traceLegacyIdParamsSchema)
  .withAccess(publicRoute({ reason: READ_REASON }))
  .withResponse("protocol", { produces: PRODUCES_JSON, because: LEGACY_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      await authorised({ app, request, permission: "traces:view" }, (auth) =>
        readLegacyThread({ app, input, auth }),
      ),
    ),
  )

  .build();
