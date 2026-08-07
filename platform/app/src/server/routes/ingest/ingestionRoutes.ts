/**
 * IngestionSource receivers — push-mode entry points for the Activity
 * Monitor pillar. Two endpoints:
 *
 *   POST /api/ingest/otel/:sourceId      OTLP/HTTP passthrough
 *   POST /api/ingest/webhook/:sourceId   Generic JSON webhook
 *
 * Auth: Authorization: Bearer <ingestSecret>. The IngestionSource is
 * resolved by raw secret → hash lookup, with a 24h grace window for
 * rotated secrets (see IngestionSourceService.findByIngestSecret).
 *
 * Architecture (rchaves + master_orchestrator directive 2026-04-27):
 * the receivers are thin auth/routing wrappers over the EXISTING trace
 * pipeline (recorded_spans + log_records + trace_summaries). Spans land
 * in the same store /api/otel/v1/traces uses; origin metadata
 * (`langwatch.origin.kind = "ingestion_source"`) distinguishes governance
 * data from application traces. The hidden per-org Governance Project
 * carries RBAC for governance data without leaking
 * into user-facing project surfaces.
 *
 * This commit is the FIRST step of the unified-trace branch correction:
 *   1. (this commit) delete the parallel governance-event backend
 *      (gateway_activity_events + activity-monitor-processing pipeline)
 *      that this receiver previously fed; receiver becomes a placeholder
 *      that 202-acks + records lastEventAt only.
 *   2. (next commit) wire the receiver to call the existing
 *      traces.collection.handleOtlpTraceRequest with origin metadata
 *      stamped on each span/log, routed through the hidden Governance
 *      Project.
 *   3. (commit 3) add governance fold projection (KPIs/anomaly) +
 *      OCSF read projection (SIEM export) on top of the unified store.
 */

import {
  type CanonicalCostEvent,
  extractCanonicalCostEvents,
} from "@ee/governance/services/activity-monitor/canonicalCostExtractor.service";
import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { transformOttlPayload } from "@ee/governance/services/activity-monitor/ottlGatewayClient";
import { ensureHiddenGovernanceProject } from "@ee/governance/services/governanceProject.service";
import {
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
} from "@ee/governance/services/ingestKeyProvenance.utils";
import { createLogger } from "@langwatch/observability";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
  IKeyValue,
} from "@opentelemetry/otlp-transformer";
import type { IngestionSource } from "@prisma/client";
import type { Context } from "hono";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetRepository } from "~/server/gateway/budget.repository";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { usdToNanoUsd } from "~/server/gateway/wireMoney";
import {
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readOtlpBody,
} from "~/server/otel/parseOtlpBody";

import { checkIpRateLimit, extractClientIp } from "./rateLimit";

/**
 * Stamp `langwatch.origin.*` + `langwatch.governance.*` attributes on
 * every span of the parsed OTLP request, in-place. The trace pipeline
 * persists these alongside any caller-supplied attributes; downstream
 * consumers (governance fold projection, OCSF read projection) filter
 * on `langwatch.origin.kind = "ingestion_source"`.
 *
 * Spec: receiver-shapes.feature.
 */
function buildOriginAttrs(source: IngestionSource) {
  return [
    {
      key: "langwatch.origin.kind",
      value: { stringValue: "ingestion_source" },
    },
    { key: "langwatch.ingestion_source.id", value: { stringValue: source.id } },
    {
      key: "langwatch.ingestion_source.organization_id",
      value: { stringValue: source.organizationId },
    },
    {
      key: "langwatch.ingestion_source.source_type",
      value: { stringValue: source.sourceType },
    },
  ];
}

const RESERVED_ORIGIN_PREFIXES = [
  "langwatch.origin.",
  "langwatch.ingestion_source.",
] as const;

/**
 * Receiver-authoritative origin attributes REPLACE any the payload supplied
 * under a reserved key. Appending would leave two entries under one key and
 * make governance attribution depend on which one a downstream flattener
 * happens to keep — i.e. let a payload forge its own origin.
 */
function withOriginAttrs(
  existing: IKeyValue[] | undefined,
  source: IngestionSource,
): IKeyValue[] {
  const caller = (existing ?? []).filter(
    (attribute) =>
      !RESERVED_ORIGIN_PREFIXES.some((prefix) =>
        attribute.key?.startsWith(prefix),
      ),
  );
  return [...caller, ...buildOriginAttrs(source)];
}

function stampOriginAttrs(
  request: IExportTraceServiceRequest,
  source: IngestionSource,
): void {
  for (const rs of request.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        span.attributes = withOriginAttrs(span.attributes, source);
      }
    }
  }
}

function stampLogOriginAttrs(
  request: IExportLogsServiceRequest,
  source: IngestionSource,
): void {
  for (const rl of request.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const record of sl.logRecords ?? []) {
        record.attributes = withOriginAttrs(record.attributes, source);
      }
    }
  }
}

function stampMetricOriginAttrs({
  request,
  source,
}: {
  request: IExportMetricsServiceRequest;
  source: IngestionSource;
}): void {
  for (const resourceMetrics of request.resourceMetrics ?? []) {
    const resource = resourceMetrics.resource ?? {
      attributes: [],
      droppedAttributesCount: 0,
    };
    resource.attributes = withOriginAttrs(resource.attributes, source);
    resourceMetrics.resource = resource;
  }
}

/**
 * Map a webhook envelope (arbitrary JSON pushed by the upstream
 * platform) to a single OTLP `IExportLogsServiceRequest` carrying ONE
 * log_record. Per-source-type deeper mappings (workato job arrays,
 * s3_custom DSL parsing) ship as follow-up adapters; this is the
 * minimum shape that satisfies receiver-shapes.feature for flat-event
 * sources — body = raw JSON string, attributes carry origin metadata.
 *
 * Why one log_record per envelope (not per parsed sub-event): keeps
 * the unified-trace contract simple. When per-platform adapters land,
 * they replace this default mapper with their richer per-event shape.
 */
function buildWebhookLogRequest(
  rawBody: string,
  source: IngestionSource,
): IExportLogsServiceRequest {
  const nowNanos = String(BigInt(Date.now()) * 1_000_000n);
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: `ingestion-source/${source.sourceType}` },
            },
          ],
          droppedAttributesCount: 0,
        },
        scopeLogs: [
          {
            scope: {
              name: "langwatch.governance.ingestion",
              version: "1",
            },
            logRecords: [
              {
                timeUnixNano: nowNanos,
                observedTimeUnixNano: nowNanos,
                severityNumber: 9, // SeverityNumber.INFO
                severityText: "INFO",
                body: { stringValue: rawBody },
                attributes: buildOriginAttrs(source),
                droppedAttributesCount: 0,
                traceId: new Uint8Array(0),
                spanId: new Uint8Array(0),
                flags: 0,
              } as never,
            ],
            schemaUrl: "",
          },
        ],
        schemaUrl: "",
      },
    ],
  } as unknown as IExportLogsServiceRequest;
}

const logger = createLogger("langwatch:ingest");

/**
 * Cost-event extraction via OTTL.
 *
 * Runtime invariant (preserved across the platform-native lift
 * refactor in 713a36ed5..7b6fb20c0): OTTL is the future-extensible
 * catch-all surface, NOT a per-source-type opt-in at runtime. Any
 * IngestionSource whose `parserConfig.ottlStatements` is non-empty
 * gets the round-trip through the aigateway's `/internal/transform`
 * regardless of `sourceType`. The platform-known tools (claude_code,
 * codex, gemini, opencode, cursor) have their dedicated receiver-
 * side native TS extractors under canonicalisation/extractors/, but
 * an admin can still attach OTTL statements to those rows and they
 * will apply on top — useful for custom field mappings, in-house
 * derived attributes, or correcting upstream wire-shape drift.
 *
 * The UI gate (OTTL_ENABLED_SOURCE_TYPES in ottlStarterTemplates.ts)
 * controls whether the admin composer SHOWS the OTTL editor for a
 * given sourceType. Today it is "otel_generic" only. The runtime
 * pipeline below does NOT consult that gate — it acts purely on the
 * statements present on the source's parserConfig.
 *
 * `/v1/traces` (span-shaped ingestion) is a future extension point
 * for the same OTTL catch-all surface.
 *
 * On gateway/transform errors, falls back to canonical extraction
 * over the un-mutated payload so the receiver still 202-acks the
 * upstream (keeping the door open for a manual reconciliation later)
 * — better than dropping the whole batch when the UI-configured
 * statements have a bug.
 */
async function extractCostEventsForSource(input: {
  source: IngestionSource;
  parsed: IExportLogsServiceRequest;
  rawBody: ArrayBuffer;
  contentType: string | undefined;
}): Promise<CanonicalCostEvent[]> {
  const parserConfig =
    (input.source.parserConfig as Record<string, unknown> | null) ?? {};
  const ottlStatements = Array.isArray(parserConfig.ottlStatements)
    ? (parserConfig.ottlStatements as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
    : [];

  if (ottlStatements.length === 0) {
    return [];
  }

  const encoding: "json" | "proto" = (input.contentType ?? "")
    .toLowerCase()
    .includes("json")
    ? "json"
    : "proto";
  const payloadB64 = Buffer.from(input.rawBody).toString("base64");

  try {
    const result = await transformOttlPayload({
      sourceId: input.source.id,
      kind: "log",
      encoding,
      payloadB64,
      statements: ottlStatements,
    });
    if (!result.ok) {
      logger.warn(
        {
          sourceId: input.source.id,
          errorCount: result.errors.length,
          firstError: result.errors[0]?.message,
        },
        "OTTL transform rejected statements at receive — falling back to un-mutated extraction",
      );
      return extractCanonicalCostEvents(input.parsed);
    }
    const mutatedBuffer = Buffer.from(result.payloadB64, "base64");
    const mutatedBytes = mutatedBuffer.buffer.slice(
      mutatedBuffer.byteOffset,
      mutatedBuffer.byteOffset + mutatedBuffer.byteLength,
    ) as ArrayBuffer;
    const mutatedContentType =
      result.encoding === "json"
        ? "application/json"
        : "application/x-protobuf";
    const reparsed = parseOtlpLogs(mutatedBytes, mutatedContentType);
    if (!reparsed.ok) {
      logger.warn(
        { sourceId: input.source.id, err: reparsed.error },
        "OTTL transform returned unparseable payload — falling back to un-mutated extraction",
      );
      return extractCanonicalCostEvents(input.parsed);
    }
    return extractCanonicalCostEvents(reparsed.request);
  } catch (transformErr) {
    logger.warn(
      { sourceId: input.source.id, err: String(transformErr) },
      "OTTL transform request failed — falling back to un-mutated extraction",
    );
    return extractCanonicalCostEvents(input.parsed);
  }
}

const secured = createServiceApp({ basePath: "/api/ingest" });
const ingestAuth = handlerManagedAuth({
  reason:
    "ingestion source bearer secret resolved in-handler via authIngestionSource",
  // Per-source bearer secret, not an RBAC permission.
  permissions: [],
  credential: "internal",
});

/**
 * Resolve `Authorization: Bearer <secret>` against IngestionSource.
 * Returns the source on hit, null on miss / malformed / expired.
 */
async function authIngestionSource(c: Context) {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(lw_is_[A-Za-z0-9_\-]+)$/.exec(header.trim());
  if (!match) return null;
  const service = IngestionSourceService.create(prisma);
  return await service.findByIngestSecret(match[1]!);
}

/**
 * Per-IP fixed-window rate-limit guard for the ingest receivers.
 * Returns a 429 Response when the limit is exceeded; returns null
 * when the request should pass through. Applied at the top of every
 * POST handler — wedged before the DB findFirst on bearer-token
 * lookup so brute-force scanners shed at L7 instead of pinging PG.
 *
 * Spec: specs/ai-gateway/governance/receiver-auth-rate-limit.feature
 */
async function rateLimitGuard(c: Context): Promise<Response | null> {
  const ip = extractClientIp(c.req.raw.headers);
  const decision = await checkIpRateLimit({ ip });
  if (decision.allowed) return null;
  logger.warn(
    { ip, count: decision.count, retryAfterSec: decision.retryAfterSec },
    "ingest rate-limit exceeded; rejecting with 429",
  );
  c.header("Retry-After", String(decision.retryAfterSec));
  return c.json(
    {
      error: "rate_limited",
      error_description:
        "Too many requests from this client. Slow down and retry after the Retry-After window.",
    },
    429,
  );
}

/**
 * Shared prologue for every ingest receiver: rate-limit guard, bearer-secret
 * auth, and the path sourceId / authenticated-source id match check.
 */
async function authorizeIngestRequest(
  c: Context,
): Promise<
  { ok: true; source: IngestionSource } | { ok: false; response: Response }
> {
  const limited = await rateLimitGuard(c);
  if (limited) return { ok: false, response: limited };

  const source = await authIngestionSource(c);
  if (!source) {
    return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
  }
  const sourceId = c.req.param("sourceId");
  if (sourceId !== source.id) {
    return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
  }
  return { ok: true, source };
}

/** The 400 wrong_endpoint response when a source's type isn't among those
 *  the calling receiver accepts, or null when it is. */
function rejectWrongIngestEndpoint(
  c: Context,
  source: IngestionSource,
  {
    allowedSourceTypes,
    message,
  }: { allowedSourceTypes: readonly string[]; message: string },
): Response | null {
  if (allowedSourceTypes.includes(source.sourceType)) return null;
  return c.json({ error: "wrong_endpoint", error_description: message }, 400);
}

/** Marks the source as having just received an event (lastEventAt bump). */
async function recordIngestSourceEvent(sourceId: string): Promise<void> {
  const service = IngestionSourceService.create(prisma);
  await service.recordEventReceived(sourceId);
}

// ---------------------------------------------------------------------------
// POST /api/ingest/otel/:sourceId
// ---------------------------------------------------------------------------
// OTLP/HTTP passthrough receiver for span-shaped sources (otel_generic +
// claude_cowork). Body decompression + JSON/protobuf parse via the
// shared src/server/otel helper (same primitive used by /api/otel/v1/traces).
//
// After parse:
//   1. Resolve / lazy-create the org's hidden Governance Project (single
//      central helper, idempotent under concurrent first-mint races).
//   2. Stamp origin metadata onto every span — langwatch.origin.kind +
//      langwatch.ingestion_source.{id,organization_id,source_type}.
//      The governance fold projection + OCSF read projection downstream
//      filter on these.
//   3. Hand off to the existing trace pipeline via
//      getApp().traces.collection.handleOtlpTraceRequest with the Gov
//      Project as the tenant. The receiver does NOT write CH directly.
//
// Spec contracts:
//   - receiver-shapes.feature (Lane-S)
//   - architecture-invariants.feature (Lane-B)
// ---------------------------------------------------------------------------
const OTEL_TRACE_SOURCE_TYPES = [
  "otel_generic",
  "claude_cowork",
  "claude_code",
] as const;

interface OtelTraceIngestResult {
  bodyBytes: number;
  eventCount: number;
  rejectedSpans: number;
  parseHint: string | undefined;
}

/** Parses the OTLP traces body, stamps origin metadata, and hands off to
 *  the unified trace pipeline. Any failure degrades to a `parseHint` on the
 *  eventual 202 rather than propagating — the receiver still acks. */
async function ingestOtelTraces(
  c: Context,
  source: IngestionSource,
): Promise<OtelTraceIngestResult> {
  let bodyBytes = 0;
  let eventCount = 0;
  let rejectedSpans = 0;
  let parseHint: string | undefined;
  try {
    const body = await readOtlpBody(c.req.raw);
    bodyBytes = body.byteLength;
    const parsed = parseOtlpTraces(body, c.req.header("content-type"));
    if (!parsed.ok) {
      parseHint = parsed.error;
    } else {
      const spans = (parsed.request.resourceSpans ?? []).flatMap((rs) =>
        (rs.scopeSpans ?? []).flatMap((ss) => ss.spans ?? []),
      );
      eventCount = spans.length;

      if (eventCount > 0) {
        // Resolve the hidden Governance Project for this org. Lazy-
        // ensured via the single central helper — first mint of any
        // governance entity created it (per master directive); receiver
        // pulls it back here for trace-pipeline tenancy. Helper is
        // idempotent so a race-created Project resolves cleanly.
        const govProject = await ensureHiddenGovernanceProject(
          prisma,
          source.organizationId,
        );
        stampOriginAttrs(parsed.request, source);
        // These endpoints authenticate with an ingestion-source bearer
        // secret, so there is no ApiKey row to attribute the payload to.
        // The attribute is still enforced rather than left alone: a
        // payload-supplied copy has to be dropped, because redaction
        // exempts that name from the secret-name deny-list.
        enforceApiKeyIdOnTraceRequest(
          parsed.request as unknown as Parameters<
            typeof enforceApiKeyIdOnTraceRequest
          >[0],
          null,
        );
        const result = await getApp().traces.collection.handleOtlpTraceRequest(
          govProject.id,
          parsed.request,
          DEFAULT_PII_REDACTION_LEVEL,
        );
        rejectedSpans = result?.rejectedSpans ?? 0;
      }
    }
  } catch (err) {
    parseHint = String(err);
    logger.warn(
      { sourceId: source.id, err: String(err) },
      "otel ingest receive failed (still ack'ing)",
    );
  }
  return { bodyBytes, eventCount, rejectedSpans, parseHint };
}

function buildOtelTraceIngestResponse(
  result: OtelTraceIngestResult,
): Record<string, unknown> {
  const { bodyBytes, eventCount, rejectedSpans, parseHint } = result;
  const responseBody: Record<string, unknown> = {
    accepted: true,
    bytes: bodyBytes,
    events: eventCount,
  };
  if (rejectedSpans > 0) responseBody.rejectedSpans = rejectedSpans;
  if (eventCount === 0 && (parseHint || bodyBytes > 0)) {
    responseBody.hint = parseHint
      ? `Body did not parse as OTLP/HTTP: ${parseHint}. See https://docs.langwatch.ai/observability/trace-vs-activity-ingestion for the canonical shape.`
      : "Body received but no spans extracted. OTLP/HTTP expects " +
        "resource_spans[].scope_spans[].spans[] with non-empty spans " +
        "arrays. See https://docs.langwatch.ai/ai-gateway/governance/" +
        "ingestion-sources/otel-generic for a copy-paste curl.";
  }
  return responseBody;
}

secured.access(ingestAuth).post("/otel/:sourceId", async (c: Context) => {
  const auth = await authorizeIngestRequest(c);
  if (!auth.ok) return auth.response;
  const { source } = auth;

  const typeError = rejectWrongIngestEndpoint(c, source, {
    allowedSourceTypes: OTEL_TRACE_SOURCE_TYPES,
    message:
      "OTLP path is only valid for otel_generic, claude_cowork, and claude_code sources",
  });
  if (typeError) return typeError;

  const result = await ingestOtelTraces(c, source);
  await recordIngestSourceEvent(source.id);
  logger.info(
    {
      sourceId: source.id,
      sourceType: source.sourceType,
      bytes: result.bodyBytes,
      events: result.eventCount,
      rejectedSpans: result.rejectedSpans,
    },
    "otel ingest landed in unified trace pipeline",
  );

  return c.json(buildOtelTraceIngestResponse(result), 202);
});

// ---------------------------------------------------------------------------
// POST /api/ingest/webhook/:sourceId
// ---------------------------------------------------------------------------
// Generic JSON webhook receiver for flat-event sources (workato audit
// streaming, s3_custom callback mode, custom in-house agents). Maps
// the JSON envelope to ONE OTLP log_record (NOT a synthetic span — flat
// events have no logical duration / parent-child tree) and hands off to
// the EXISTING log pipeline via getApp().traces.logCollection.
// handleOtlpLogRequest. Same store, same trace viewer drill-down,
// origin metadata distinguishes from application logs.
//
// Per-source-type deeper mappings (workato job arrays, s3_custom DSL
// parsing) ship as follow-up adapters that replace buildWebhookLogRequest
// with their richer per-event shape — same handoff target.
//
// Spec contracts:
//   - receiver-shapes.feature flat-event scenarios
//   - architecture-invariants.feature unified-substrate scenarios
// ---------------------------------------------------------------------------
secured.access(ingestAuth).post("/webhook/:sourceId", async (c: Context) => {
  const limited = await rateLimitGuard(c);
  if (limited) return limited;

  const source = await authIngestionSource(c);
  if (!source) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sourceId = c.req.param("sourceId");
  if (sourceId !== source.id) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (
    source.sourceType !== "workato" &&
    source.sourceType !== "otel_generic" &&
    source.sourceType !== "s3_custom"
  ) {
    return c.json(
      {
        error: "wrong_endpoint",
        error_description:
          "Webhook path is only valid for workato, otel_generic, and s3_custom (callback-mode) sources",
      },
      400,
    );
  }

  let bodyBytes = 0;
  let envelopeId = "";
  let handoffOk = false;
  try {
    const raw = await c.req.text();
    bodyBytes = raw.length;
    envelopeId = `envelope-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    if (bodyBytes > 0) {
      const govProject = await ensureHiddenGovernanceProject(
        prisma,
        source.organizationId,
      );
      const logRequest = buildWebhookLogRequest(raw, source);
      await getApp().traces.logCollection.handleOtlpLogRequest({
        tenantId: govProject.id,
        organizationId: source.organizationId,
        logRequest,
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      });
      handoffOk = true;
    }
  } catch (err) {
    logger.warn(
      { sourceId: source.id, err: String(err) },
      "webhook ingest receive failed (still ack'ing)",
    );
  }

  const service = IngestionSourceService.create(prisma);
  await service.recordEventReceived(source.id);
  logger.info(
    {
      sourceId: source.id,
      sourceType: source.sourceType,
      bytes: bodyBytes,
      envelopeId,
      handoffOk,
    },
    "webhook ingest landed in unified log pipeline",
  );

  return c.json({ accepted: true, bytes: bodyBytes, eventId: envelopeId }, 202);
});

// ---------------------------------------------------------------------------
// POST /api/ingest/otel/:sourceId/v1/logs
// POST /api/ingest/otel/:sourceId/v1/metrics
// ---------------------------------------------------------------------------
// Claude Code (and other OTLP-emitting tools) post per-request events
// + cost metrics on the standard OTLP/HTTP sub-paths. The exporter
// suffixes `OTEL_EXPORTER_OTLP_ENDPOINT` with `/v1/logs` / `/v1/metrics`
// — admins paste `{base-url}/api/ingest/otel/{sourceId}` as the
// endpoint and the SDK appends the suffix.
//
// /v1/logs path:
//   - Hands LogRecords off to the existing log pipeline so /me Recent
//     Activity / trace viewer drill-down works for forensics
//   - Filters for `claude_code.api_request` events and writes one
//     ledger row per (request_id, applicable budget) so anomaly rules
//     + per-principal budgets fire on third-party traffic
//
// /v1/metrics path: v0 acks-only. Counter delta synthesis is a v2 add
// for sources that emit metrics but no per-request events. Logged at
// info-level for inspection.
//
// Spec: docs/ai-governance/ingestion-sources/claude-code-otlp.feature
// ---------------------------------------------------------------------------
function countOtlpLogRecords(request: IExportLogsServiceRequest): number {
  return (request.resourceLogs ?? []).reduce(
    (acc, rl) =>
      acc +
      (rl.scopeLogs ?? []).reduce(
        (a, sl) => a + (sl.logRecords?.length ?? 0),
        0,
      ),
    0,
  );
}

// Audit / forensics: hand the LogRecords to the existing log pipeline so
// they show up alongside spans in the trace viewer + /me Recent Activity.
// Best-effort: a failure here must not stop cost extraction below.
async function handOffOtelLogsToPipeline({
  source,
  govProjectId,
  logRequest,
}: {
  source: IngestionSource;
  govProjectId: string;
  logRequest: IExportLogsServiceRequest;
}): Promise<void> {
  try {
    await getApp().traces.logCollection.handleOtlpLogRequest({
      tenantId: govProjectId,
      organizationId: source.organizationId,
      logRequest,
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
    });
  } catch (handoffErr) {
    logger.warn(
      { sourceId: source.id, err: String(handoffErr) },
      "log pipeline handoff failed (cost extraction continues)",
    );
  }
}

/** Resolves a cost event's reporting user to an org member's User.id,
 *  falling back to null (and an audit log line) when the emitting email
 *  is not a member. */
async function resolveCostEventPrincipal({
  event,
  source,
}: {
  event: CanonicalCostEvent;
  source: IngestionSource;
}): Promise<string | null> {
  if (!event.userEmail) return null;

  // Prisma relation name on User is `orgMemberships` (not
  // `organizations`) — Ariana caught this on the first real Claude Code
  // call. The auto-detected user.email matched the captured OAuth
  // account; the relation filter was the only blocker between extracted
  // event and ledger row.
  const user = await prisma.user.findFirst({
    where: {
      email: event.userEmail,
      orgMemberships: { some: { organizationId: source.organizationId } },
    },
    select: { id: true },
  });
  if (user?.id) return user.id;

  // Audit hint: Anthropic OAuth user is emitting cost but isn't a member
  // of the source's org. Roll-up still happens at org/team/project scope;
  // admins can grep this log to see who's leaking cost they can't yet
  // attribute per-user.
  logger.info(
    {
      sourceId: source.id,
      userEmail: event.userEmail,
      anthropicAccountId: event.raw["user.account_id"],
      requestId: event.requestId,
    },
    "ingestion-source event from non-member email — falling back to org/team/project scope only",
  );
  return null;
}

// BUDGET_UPDATED so the gateway's /changes subscriber evicts L1 and the
// next request re-resolves with the fresh spend. Ariana's anomaly + budget
// pipelines fire identically to the gateway VK path. Best-effort: the
// ledger row already landed by the time this runs.
async function emitCostEventBudgetUpdated({
  changeEvents,
  source,
  govProjectId,
  event,
  budgetIds,
}: {
  changeEvents: ChangeEventRepository;
  source: IngestionSource;
  govProjectId: string;
  event: CanonicalCostEvent;
  budgetIds: string[];
}): Promise<void> {
  try {
    await changeEvents.append({
      organizationId: source.organizationId,
      projectId: govProjectId,
      kind: "BUDGET_UPDATED",
      payload: {
        source: "ingestion_source",
        sourceId: source.id,
        requestId: event.requestId,
        userEmail: event.userEmail,
        budgetIds,
        amountUsd: event.costUsd,
      },
    });
  } catch (changeErr) {
    logger.warn(
      {
        sourceId: source.id,
        requestId: event.requestId,
        err: String(changeErr),
      },
      "BUDGET_UPDATED emit failed (ledger row already landed)",
    );
  }
}

/** Writes one cost event's ledger rows (one per applicable budget) and
 *  emits the BUDGET_UPDATED change event. Returns the row count written. */
async function writeCostEventLedgerRows({
  event,
  source,
  govProjectId,
  budgetRepo,
  budgetCHRepo,
  changeEvents,
}: {
  event: CanonicalCostEvent;
  source: IngestionSource;
  govProjectId: string;
  budgetRepo: GatewayBudgetRepository;
  budgetCHRepo: GatewayBudgetClickHouseRepository;
  changeEvents: ChangeEventRepository;
}): Promise<number> {
  // Resolve principal: user.email → User.id (org member only). Fallback to
  // null on unknown users — the budget still rolls up at org/team/project
  // scope, just no per-user attribution.
  const principalUserId = await resolveCostEventPrincipal({ event, source });

  // Sentinel teamId/virtualKeyId for ingestion-source rows. ApplicableScopes
  // typed signature requires non-null strings; the budget query filters
  // TEAM-scoped budgets by `scope=TEAM AND scopeId=teamId` so a sentinel
  // that can't be a real team id naturally excludes those narrow budgets
  // while still letting ORG / PROJECT / PRINCIPAL budgets match. Same shape
  // for VIRTUAL_KEY: ingestion sources have no VK, the sentinel ensures
  // VK-scoped budgets correctly skip.
  const sentinelVK = `_ingestion_:${source.id}`;
  const scopes = {
    organizationId: source.organizationId,
    teamId: source.teamId ?? `_ingestion_:${source.id}`,
    projectId: govProjectId,
    virtualKeyId: sentinelVK,
    principalUserId,
  };
  // ATTRIBUTED_USER templates bucket spend per end user, and an ingestion
  // source carries none, so a row here could only name the bare anchor: a
  // bucket no enforcement reads, filed under the same (budget, request)
  // identity the per-user row needs. Templates accrue on the gateway spend
  // pipeline alone.
  const budgets = (await budgetRepo.applicableForRequest(scopes)).filter(
    (b) => b.scopeType !== "ATTRIBUTED_USER",
  );
  if (budgets.length === 0) return 0;

  // The reported cost is a float the caller sent, so it is pinned to an
  // integer once, here, and every total downstream adds those integers
  // rather than re-deriving from decimals.
  const nano = usdToNanoUsd(event.costUsd.toFixed(10));
  const rows = budgets.map((b) => ({
    tenantId: govProjectId,
    budgetId: b.id,
    scope: b.scopeType,
    scopeId: b.scopeId,
    window: b.window,
    virtualKeyId: sentinelVK,
    gatewayRequestId: event.requestId,
    amountNanoUsd: Number(nano),
    tokensInput: event.inputTokens,
    tokensOutput: event.outputTokens,
    tokensCacheRead: event.cacheReadTokens,
    tokensCacheWrite: event.cacheCreationTokens,
    model: event.model,
    durationMs: 0,
    status: "SUCCESS" as const,
    occurredAt: event.occurredAt,
  }));
  await budgetCHRepo.insertDebit(rows);

  await emitCostEventBudgetUpdated({
    changeEvents,
    source,
    govProjectId,
    event,
    budgetIds: budgets.map((b) => b.id),
  });

  return rows.length;
}

/** Dispatches every extracted cost event to the ledger, one at a time so a
 *  single event's failure doesn't drop the rest of the batch. */
async function dispatchIngestCostEvents({
  events,
  source,
  govProjectId,
  budgetCHRepo,
}: {
  events: CanonicalCostEvent[];
  source: IngestionSource;
  govProjectId: string;
  budgetCHRepo: GatewayBudgetClickHouseRepository;
}): Promise<number> {
  const budgetRepo = new GatewayBudgetRepository(prisma);
  const changeEvents = new ChangeEventRepository(prisma);

  let ledgerRowsWritten = 0;
  for (const event of events) {
    try {
      ledgerRowsWritten += await writeCostEventLedgerRows({
        event,
        source,
        govProjectId,
        budgetRepo,
        budgetCHRepo,
        changeEvents,
      });
    } catch (eventErr) {
      logger.warn(
        {
          sourceId: source.id,
          requestId: event.requestId,
          err: String(eventErr),
        },
        "ingestion-source event ledger-write failed (continuing batch)",
      );
    }
  }
  return ledgerRowsWritten;
}

interface OtelLogsIngestResult {
  bodyBytes: number;
  logRecordCount: number;
  costEventCount: number;
  ledgerRowsWritten: number;
  parseHint: string | undefined;
}

/** Parses the OTLP logs body, hands off to the log pipeline for forensics,
 *  and dispatches any extracted cost events to the budget ledger. Any
 *  failure degrades to a `parseHint` on the eventual 202 — the receiver
 *  still acks. */
/** Resolves the Governance Project, stamps origin attrs, hands the parsed
 *  request off to the log pipeline for forensics, and dispatches any
 *  extracted cost events to the budget ledger. Only called when the parsed
 *  request carries at least one log record. */
async function processOtelLogRecords({
  source,
  parsed,
  body,
  contentType,
}: {
  source: IngestionSource;
  parsed: IExportLogsServiceRequest;
  body: ArrayBuffer;
  contentType: string | undefined;
}): Promise<{ costEventCount: number; ledgerRowsWritten: number }> {
  const govProject = await ensureHiddenGovernanceProject(
    prisma,
    source.organizationId,
  );
  // Stamp origin attrs on every record first — governance origin filtering
  // reads them off the log attributes, mirroring the trace path and the
  // webhook receiver.
  stampLogOriginAttrs(parsed, source);
  enforceApiKeyIdOnLogRequest(
    parsed as unknown as Parameters<typeof enforceApiKeyIdOnLogRequest>[0],
    null,
  );
  await handOffOtelLogsToPipeline({
    source,
    govProjectId: govProject.id,
    logRequest: parsed,
  });

  // Cost extraction: when the source carries OTTL statements in
  // parserConfig, round-trip the payload through the gateway's
  // /internal/transform (which embeds pkg/ottl) and read the canonical
  // `langwatch.*` namespace from the mutated payload. Otherwise fall back
  // to the legacy hardcoded claude_code extractor for sources created
  // before OTTL config existed. Ledger-write one row per event per
  // applicable budget.
  const events = await extractCostEventsForSource({
    source,
    parsed,
    rawBody: body,
    contentType,
  });

  const budgetCHRepo = events.length > 0 ? getApp().gateway.budgets : undefined;
  const ledgerRowsWritten =
    events.length > 0 && budgetCHRepo
      ? await dispatchIngestCostEvents({
          events,
          source,
          govProjectId: govProject.id,
          budgetCHRepo,
        })
      : 0;

  return { costEventCount: events.length, ledgerRowsWritten };
}

async function ingestOtelLogsAndCost(
  c: Context,
  source: IngestionSource,
): Promise<OtelLogsIngestResult> {
  let bodyBytes = 0;
  let logRecordCount = 0;
  let costEventCount = 0;
  let ledgerRowsWritten = 0;
  let parseHint: string | undefined;

  try {
    const body = await readOtlpBody(c.req.raw);
    bodyBytes = body.byteLength;
    const contentType = c.req.header("content-type");
    const parsed = parseOtlpLogs(body, contentType);
    if (!parsed.ok) {
      parseHint = parsed.error;
    } else {
      logRecordCount = countOtlpLogRecords(parsed.request);

      if (logRecordCount > 0) {
        const processed = await processOtelLogRecords({
          source,
          parsed: parsed.request,
          body,
          contentType,
        });
        costEventCount = processed.costEventCount;
        ledgerRowsWritten = processed.ledgerRowsWritten;
      }
    }
  } catch (err) {
    parseHint = String(err);
    logger.warn(
      { sourceId: source.id, err: String(err) },
      "otel logs ingest receive failed (still ack'ing)",
    );
  }

  return {
    bodyBytes,
    logRecordCount,
    costEventCount,
    ledgerRowsWritten,
    parseHint,
  };
}

function buildOtelLogsIngestResponse(
  result: OtelLogsIngestResult,
): Record<string, unknown> {
  const responseBody: Record<string, unknown> = {
    accepted: true,
    bytes: result.bodyBytes,
    logRecords: result.logRecordCount,
    costEvents: result.costEventCount,
    ledgerRows: result.ledgerRowsWritten,
  };
  if (result.parseHint) responseBody.hint = result.parseHint;
  return responseBody;
}

secured
  .access(ingestAuth)
  .post("/otel/:sourceId/v1/logs", async (c: Context) => {
    const auth = await authorizeIngestRequest(c);
    if (!auth.ok) return auth.response;
    const { source } = auth;

    const result = await ingestOtelLogsAndCost(c, source);
    await recordIngestSourceEvent(source.id);
    logger.info(
      {
        sourceId: source.id,
        sourceType: source.sourceType,
        bytes: result.bodyBytes,
        logRecords: result.logRecordCount,
        costEvents: result.costEventCount,
        ledgerRows: result.ledgerRowsWritten,
      },
      "otel logs ingest landed",
    );

    return c.json(buildOtelLogsIngestResponse(result), 202);
  });

function countOtlpMetricDataPoints(
  request: IExportMetricsServiceRequest,
): number {
  return (request.resourceMetrics ?? []).reduce(
    (acc, rm) =>
      acc +
      (rm.scopeMetrics ?? []).reduce(
        (scopeAcc, sm) =>
          scopeAcc +
          (sm.metrics ?? []).reduce(
            (metricAcc, metric) =>
              metricAcc +
              (metric?.gauge?.dataPoints?.length ?? 0) +
              (metric?.sum?.dataPoints?.length ?? 0) +
              (metric?.histogram?.dataPoints?.length ?? 0) +
              (metric?.exponentialHistogram?.dataPoints?.length ?? 0) +
              (metric?.summary?.dataPoints?.length ?? 0),
            0,
          ),
        0,
      ),
    0,
  );
}

// Gate on the payload carrying metrics at all, not on its datapoint arrays
// being well-formed: a request whose metrics all have malformed dataPoints
// has a zero pre-count, and skipping validation would ack it as fully
// accepted with nothing rejected.
function hasOtlpMetricPayload(request: IExportMetricsServiceRequest): boolean {
  const resourceMetrics = request.resourceMetrics;
  return Array.isArray(resourceMetrics)
    ? resourceMetrics.length > 0
    : resourceMetrics != null;
}

type MetricDispatchOutcome =
  | { kind: "short_circuit"; response: Response }
  | {
      kind: "dispatched";
      rejectedDataPoints: number;
      acceptedDataPoints: number;
      errorMessage: string | undefined;
    };

/** Hands the parsed metrics off to the metric pipeline. Scoped away from the
 *  outer catch, which turns anything it sees into a `parseHint` on a 202
 *  `accepted: true`. Past parsing, a throw is no longer the sender's bad
 *  payload — it is ours, and acking it drops the batch for good. On both
 *  short-circuit exits the source event is deliberately not recorded: the
 *  collector re-sends this same request, so counting it now double-counts
 *  it. */
async function dispatchOtelMetrics({
  c,
  source,
  request,
}: {
  c: Context;
  source: IngestionSource;
  request: IExportMetricsServiceRequest;
}): Promise<MetricDispatchOutcome> {
  try {
    const govProject = await ensureHiddenGovernanceProject(
      prisma,
      source.organizationId,
    );
    stampMetricOriginAttrs({ request, source });
    enforceApiKeyIdOnMetricRequest(
      request as unknown as Parameters<
        typeof enforceApiKeyIdOnMetricRequest
      >[0],
      null,
    );
    const result =
      await getApp().traces.metricCollection.handleOtlpMetricRequest({
        tenantId: govProject.id,
        organizationId: source.organizationId,
        metricRequest: request,
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      });
    if (result.outcome === "unavailable") {
      return {
        kind: "short_circuit",
        response: c.json({ accepted: false, error: result.errorMessage }, 503),
      };
    }
    return {
      kind: "dispatched",
      rejectedDataPoints: result.rejectedDataPoints,
      acceptedDataPoints: result.acceptedDataPoints,
      errorMessage: result.errorMessage,
    };
  } catch (error) {
    logger.error(
      { error, sourceId: source.id },
      "otel metrics ingest failed after parsing; answering retryably",
    );
    return {
      kind: "short_circuit",
      response: c.json(
        { accepted: false, error: "failed to record data point" },
        503,
      ),
    };
  }
}

type OtelMetricsIngestOutcome =
  | { kind: "short_circuit"; response: Response }
  | {
      kind: "completed";
      bodyBytes: number;
      metricCount: number;
      rejectedDataPoints: number;
      acceptedDataPoints: number;
      parseHint: string | undefined;
    };

/** Parses the OTLP metrics body and dispatches any datapoints to the metric
 *  pipeline. Any parse failure degrades to a `parseHint` on the eventual
 *  202 — the receiver still acks; a post-parse dispatch failure short-
 *  circuits with a retryable 503 instead (see `dispatchOtelMetrics`). */
async function ingestOtelMetrics(
  c: Context,
  source: IngestionSource,
): Promise<OtelMetricsIngestOutcome> {
  let bodyBytes = 0;
  let metricCount = 0;
  let rejectedDataPoints = 0;
  let acceptedDataPoints = 0;
  let parseHint: string | undefined;
  try {
    const body = await readOtlpBody(c.req.raw);
    bodyBytes = body.byteLength;
    const parsed = parseOtlpMetrics(body, c.req.header("content-type"));
    if (!parsed.ok) {
      parseHint = parsed.error;
    } else {
      metricCount = countOtlpMetricDataPoints(parsed.request);
      if (hasOtlpMetricPayload(parsed.request)) {
        const dispatch = await dispatchOtelMetrics({
          c,
          source,
          request: parsed.request,
        });
        if (dispatch.kind === "short_circuit") return dispatch;
        rejectedDataPoints = dispatch.rejectedDataPoints;
        acceptedDataPoints = dispatch.acceptedDataPoints;
        parseHint = dispatch.errorMessage;
      }
    }
  } catch (err) {
    parseHint = String(err);
  }

  return {
    kind: "completed",
    bodyBytes,
    metricCount,
    rejectedDataPoints,
    acceptedDataPoints,
    parseHint,
  };
}

secured
  .access(ingestAuth)
  .post("/otel/:sourceId/v1/metrics", async (c: Context) => {
    const auth = await authorizeIngestRequest(c);
    if (!auth.ok) return auth.response;
    const { source } = auth;

    const outcome = await ingestOtelMetrics(c, source);
    if (outcome.kind === "short_circuit") return outcome.response;

    await recordIngestSourceEvent(source.id);
    logger.info(
      {
        sourceId: source.id,
        bytes: outcome.bodyBytes,
        metrics: outcome.metricCount,
      },
      "otel metrics ingest landed",
    );

    const responseBody: Record<string, unknown> = {
      accepted: true,
      bytes: outcome.bodyBytes,
      metrics: outcome.metricCount,
      acceptedDataPoints: outcome.acceptedDataPoints,
      partialSuccess: {
        rejectedDataPoints: outcome.rejectedDataPoints,
        ...(outcome.parseHint ? { errorMessage: outcome.parseHint } : {}),
      },
    };
    if (outcome.parseHint) responseBody.hint = outcome.parseHint;
    return c.json(responseBody, 202);
  });

export const app = secured.hono;
