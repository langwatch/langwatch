/**
 * Push-mode IngestionSource receivers for the Activity Monitor:
 *
 *   POST /api/ingest/otel/:sourceId      OTLP/HTTP passthrough
 *   POST /api/ingest/webhook/:sourceId   Generic JSON webhook
 *
 * Auth is `Authorization: Bearer <ingestSecret>`, resolved by hash lookup
 * with the rotated-secret grace window in `IngestionSourceService`.
 *
 * Receivers are thin auth/routing wrappers over the existing trace pipeline.
 * Origin metadata distinguishes ingestion data from application traces, while
 * the hidden per-organisation Governance Project supplies governance RBAC.
 * Do not add a parallel governance event store or write path here.
 */

import {
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
} from "./ingest-key-provenance.utils";
import { createLogger } from "@langwatch/observability";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
  IKeyValue,
} from "@opentelemetry/otlp-transformer";
import type { Context } from "hono";
import type {
  CanonicalCostEvent,
  GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";
import type { AppContextVariables } from "~/app/api/middleware/app-context";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth } from "@langwatch/platform-api/app-rest";
import type { App } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";
import { usdToNanoUsd } from "@langwatch/gateway-server";
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
function buildOriginAttrs(source: GovernanceIngestionSource) {
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
  source: GovernanceIngestionSource,
): IKeyValue[] {
  const caller = (existing ?? []).filter(
    (attribute) =>
      !RESERVED_ORIGIN_PREFIXES.some((prefix) => attribute.key?.startsWith(prefix)),
  );
  return [...caller, ...buildOriginAttrs(source)];
}

function stampOriginAttrs(
  request: IExportTraceServiceRequest,
  source: GovernanceIngestionSource,
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
  source: GovernanceIngestionSource,
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
  source: GovernanceIngestionSource;
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
  source: GovernanceIngestionSource,
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
 * Any source with `parserConfig.ottlStatements` uses the gateway transform,
 * regardless of source type. Native extractors and the UI editor gate do not
 * change that runtime rule. A transform failure falls back to canonical
 * extraction over the original payload so the receiver can still acknowledge
 * the upstream batch.
 */
async function extractCostEventsForSource(input: {
  source: GovernanceIngestionSource;
  parsed: IExportLogsServiceRequest;
  rawBody: ArrayBuffer;
  contentType: string | undefined;
  governance: Pick<App["governance"], "extractCanonicalCostEvents" | "ottlTransform">;
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
    const result = await input.governance.ottlTransform({
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
      return input.governance.extractCanonicalCostEvents(input.parsed);
    }
    const mutatedBuffer = Buffer.from(result.payloadB64, "base64");
    const mutatedBytes = mutatedBuffer.buffer.slice(
      mutatedBuffer.byteOffset,
      mutatedBuffer.byteOffset + mutatedBuffer.byteLength,
    ) as ArrayBuffer;
    const mutatedContentType =
      result.encoding === "json" ? "application/json" : "application/x-protobuf";
    const reparsed = parseOtlpLogs(mutatedBytes, mutatedContentType);
    if (!reparsed.ok) {
      logger.warn(
        { sourceId: input.source.id, err: reparsed.error },
        "OTTL transform returned unparseable payload — falling back to un-mutated extraction",
      );
      return input.governance.extractCanonicalCostEvents(input.parsed);
    }
    return input.governance.extractCanonicalCostEvents(reparsed.request);
  } catch (transformErr) {
    logger.warn(
      { sourceId: input.source.id, err: String(transformErr) },
      "OTTL transform request failed — falling back to un-mutated extraction",
    );
    return input.governance.extractCanonicalCostEvents(input.parsed);
  }
}

type IngestContext = Context<{ Variables: AppContextVariables }>;

const secured = createServiceApp<{ Variables: AppContextVariables }>({
  basePath: "/api/ingest",
});
const ingestAuth = handlerManagedAuth({
  reason: "ingestion source bearer secret resolved in-handler via authIngestionSource",
  // Per-source bearer secret, not an RBAC permission.
  permissions: [],
  credential: "internal",
});

/**
 * Resolve `Authorization: Bearer <secret>` against IngestionSource.
 * Returns the source on hit, null on miss / malformed / expired.
 */
async function authIngestionSource(c: IngestContext) {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(lw_is_[A-Za-z0-9_\-]+)$/.exec(header.trim());
  if (!match) return null;
  return await c.var.langwatchApp.governance.tryFindIngestionSourceByIngestSecret(
    match[1]!,
  );
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
async function rateLimitGuard(c: IngestContext): Promise<Response | null> {
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
//      getApp().traceIngestion.collection.handleOtlpTraceRequest with the Gov
//      Project as the tenant. The receiver does NOT write CH directly.
//
// Spec contracts:
//   - receiver-shapes.feature (Lane-S)
//   - architecture-invariants.feature (Lane-B)
// ---------------------------------------------------------------------------
secured.access(ingestAuth).post("/otel/:sourceId", async (c: IngestContext) => {
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
    source.sourceType !== "otel_generic" &&
    source.sourceType !== "claude_cowork" &&
    source.sourceType !== "claude_code"
  ) {
    return c.json(
      {
        error: "wrong_endpoint",
        error_description:
          "OTLP path is only valid for otel_generic, claude_cowork, and claude_code sources",
      },
      400,
    );
  }

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
        const govProject = await c.var.langwatchApp.projects.projectService.ensureInternal({
          organizationId: source.organizationId,
          kind: "internal_governance",
        });
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
        const result = await c.var.langwatchApp.traceIngestion.collection.handleOtlpTraceRequest(
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

  await c.var.langwatchApp.governance.ingestionSourceRecordEventReceived(source.id);
  logger.info(
    {
      sourceId: source.id,
      sourceType: source.sourceType,
      bytes: bodyBytes,
      events: eventCount,
      rejectedSpans,
    },
    "otel ingest landed in unified trace pipeline",
  );

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
  return c.json(responseBody, 202);
});

// ---------------------------------------------------------------------------
// POST /api/ingest/webhook/:sourceId
// ---------------------------------------------------------------------------
// Generic JSON webhook receiver for flat-event sources (workato audit
// streaming, s3_custom callback mode, custom in-house agents). Maps
// the JSON envelope to ONE OTLP log_record (NOT a synthetic span — flat
// events have no logical duration / parent-child tree) and hands off to
// the EXISTING log pipeline via getApp().traceIngestion.logCollection.
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
secured.access(ingestAuth).post("/webhook/:sourceId", async (c: IngestContext) => {
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
      const govProject = await c.var.langwatchApp.projects.projectService.ensureInternal({
        organizationId: source.organizationId,
        kind: "internal_governance",
      });
      const logRequest = buildWebhookLogRequest(raw, source);
      await c.var.langwatchApp.traceIngestion.logCollection.handleOtlpLogRequest({
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

  await c.var.langwatchApp.governance.ingestionSourceRecordEventReceived(source.id);
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
secured.access(ingestAuth).post("/otel/:sourceId/v1/logs", async (c: IngestContext) => {
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
      logRecordCount = (parsed.request.resourceLogs ?? []).reduce(
        (acc, rl) =>
          acc +
          (rl.scopeLogs ?? []).reduce((a, sl) => a + (sl.logRecords?.length ?? 0), 0),
        0,
      );

      // Audit / forensics: hand the LogRecords to the existing log
      // pipeline so they show up alongside spans in the trace viewer
      // + /me Recent Activity. Stamp origin attrs on every
      // record first — governance origin filtering reads them
      // off the log attributes, mirroring the trace path and the
      // webhook receiver.
      if (logRecordCount > 0) {
        const govProject = await c.var.langwatchApp.projects.projectService.ensureInternal({
          organizationId: source.organizationId,
          kind: "internal_governance",
        });
        stampLogOriginAttrs(parsed.request, source);
        enforceApiKeyIdOnLogRequest(
          parsed.request as unknown as Parameters<typeof enforceApiKeyIdOnLogRequest>[0],
          null,
        );
        try {
          await c.var.langwatchApp.traceIngestion.logCollection.handleOtlpLogRequest({
            tenantId: govProject.id,
            organizationId: source.organizationId,
            logRequest: parsed.request,
            piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
          });
        } catch (handoffErr) {
          logger.warn(
            { sourceId: source.id, err: String(handoffErr) },
            "log pipeline handoff failed (cost extraction continues)",
          );
        }

        // Cost extraction: when the source carries OTTL statements in
        // parserConfig, round-trip the payload through the gateway's
        // /internal/transform (which embeds pkg/ottl) and read the
        // canonical `langwatch.*` namespace from the mutated payload.
        // Otherwise fall back to the legacy hardcoded claude_code
        // extractor for sources created before OTTL config existed.
        // Ledger-write one row per event per applicable budget.
        const events = await extractCostEventsForSource({
          source,
          parsed: parsed.request,
          rawBody: body,
          contentType,
          governance: c.var.langwatchApp.governance,
        });
        costEventCount = events.length;

        const budgetCHRepo =
          events.length > 0 ? c.var.langwatchApp.gatewayStores.budgets : undefined;
        if (events.length > 0 && budgetCHRepo) {
          const budgetDecisions = c.var.langwatchApp.gatewayStores.budgetDecisions;
          const changeEvents = c.var.langwatchApp.gatewayStores.changes;

          for (const event of events) {
            try {
              // Resolve principal: user.email → User.id (org member only).
              // Fallback to null on unknown users — the budget still rolls
              // up at org/team/project scope, just no per-user attribution.
              let principalUserId: string | null = null;
              if (event.userEmail) {
                // Prisma relation name on User is `orgMemberships` (not
                // `organizations`) — Ariana caught this on the first
                // real Claude Code call. The auto-detected user.email
                // matched the captured OAuth account; the relation
                // filter was the only blocker between extracted event
                // and ledger row.
                const user = await prisma.user.findFirst({
                  where: {
                    email: event.userEmail,
                    orgMemberships: {
                      some: { organizationId: source.organizationId },
                    },
                  },
                  select: { id: true },
                });
                principalUserId = user?.id ?? null;
                if (!principalUserId) {
                  // Audit hint: Anthropic OAuth user is emitting cost
                  // but isn't a member of the source's org. Roll-up
                  // still happens at org/team/project scope; admins
                  // can grep this log to see who's leaking cost they
                  // can't yet attribute per-user.
                  logger.info(
                    {
                      sourceId: source.id,
                      userEmail: event.userEmail,
                      anthropicAccountId: event.raw["user.account_id"],
                      requestId: event.requestId,
                    },
                    "ingestion-source event from non-member email — falling back to org/team/project scope only",
                  );
                }
              }

              // Sentinel teamId/virtualKeyId for ingestion-source rows.
              // ApplicableScopes typed signature requires non-null
              // strings; the budget query filters TEAM-scoped budgets
              // by `scope=TEAM AND scopeId=teamId` so a sentinel that
              // can't be a real team id naturally excludes those
              // narrow budgets while still letting ORG / PROJECT /
              // PRINCIPAL budgets match. Same shape for VIRTUAL_KEY:
              // ingestion sources have no VK, the sentinel ensures
              // VK-scoped budgets correctly skip.
              const sentinelVK = `_ingestion_:${source.id}`;
              const scopes = {
                organizationId: source.organizationId,
                teamId: source.teamId ?? `_ingestion_:${source.id}`,
                projectId: govProject.id,
                virtualKeyId: sentinelVK,
                principalUserId,
              };
              // ATTRIBUTED_USER templates bucket spend per end user, and
              // an ingestion source carries none, so a row here could
              // only name the bare anchor: a bucket no enforcement reads,
              // filed under the same (budget, request) identity the
              // per-user row needs. Templates accrue on the gateway
              // spend pipeline alone.
              const budgets = (await budgetDecisions.resolveApplicableBudgets(scopes))
                .map(({ budget }) => budget)
                .filter((budget) => budget.scopeType !== "ATTRIBUTED_USER");
              if (budgets.length === 0) continue;

              // The reported cost is a decimal string, so it is pinned to
              // an integer once, here, and every total downstream adds
              // those integers rather than re-deriving from decimals.
              const nano = usdToNanoUsd(event.costUsd);
              const nanoNum = Number(nano);
              if (!Number.isSafeInteger(nanoNum)) {
                logger.error(
                  {
                    costUsd: event.costUsd,
                    nanoUsd: nano.toString(),
                    requestId: event.requestId,
                  },
                  "budget: amountNanoUsd exceeds Number.MAX_SAFE_INTEGER, skipping debit row to avoid silent rounding",
                );
                continue;
              }
              const rows = budgets.map((b) => ({
                tenantId: govProject.id,
                budgetId: b.id,
                scope: b.scopeType,
                scopeId: b.scopeId,
                window: b.window,
                virtualKeyId: sentinelVK,
                gatewayRequestId: event.requestId,
                amountNanoUsd: nanoNum,
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
              ledgerRowsWritten += rows.length;

              // BUDGET_UPDATED so the gateway's /changes subscriber
              // evicts L1 and the next request re-resolves with the
              // fresh spend. Ariana's anomaly + budget pipelines fire
              // identically to the gateway VK path.
              try {
                await changeEvents.append({
                  organizationId: source.organizationId,
                  projectId: govProject.id,
                  kind: "BUDGET_UPDATED",
                  payload: {
                    source: "ingestion_source",
                    sourceId: source.id,
                    requestId: event.requestId,
                    userEmail: event.userEmail,
                    budgetIds: budgets.map((b) => b.id),
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
        }
      }
    }
  } catch (err) {
    parseHint = String(err);
    logger.warn(
      { sourceId: source.id, err: String(err) },
      "otel logs ingest receive failed (still ack'ing)",
    );
  }

  await c.var.langwatchApp.governance.ingestionSourceRecordEventReceived(source.id);
  logger.info(
    {
      sourceId: source.id,
      sourceType: source.sourceType,
      bytes: bodyBytes,
      logRecords: logRecordCount,
      costEvents: costEventCount,
      ledgerRows: ledgerRowsWritten,
    },
    "otel logs ingest landed",
  );

  const responseBody: Record<string, unknown> = {
    accepted: true,
    bytes: bodyBytes,
    logRecords: logRecordCount,
    costEvents: costEventCount,
    ledgerRows: ledgerRowsWritten,
  };
  if (parseHint) responseBody.hint = parseHint;
  return c.json(responseBody, 202);
});

secured
  .access(ingestAuth)
  .post("/otel/:sourceId/v1/metrics", async (c: IngestContext) => {
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
        metricCount = (parsed.request.resourceMetrics ?? []).reduce(
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
        // Gate on the payload carrying metrics at all, not on its datapoint
        // arrays being well-formed: a request whose metrics all have malformed
        // dataPoints has a zero pre-count, and skipping validation would ack it
        // as fully accepted with nothing rejected.
        const resourceMetrics = parsed.request.resourceMetrics;
        const hasMetricPayload = Array.isArray(resourceMetrics)
          ? resourceMetrics.length > 0
          : resourceMetrics != null;
        if (hasMetricPayload) {
          // Scoped away from the outer catch, which turns anything it sees into
          // a `parseHint` on a 202 `accepted: true`. Past parsing, a throw is no
          // longer the sender's bad payload — it is ours, and acking it drops
          // the batch for good. In both exits below the source event is
          // deliberately not recorded: the collector re-sends this same
          // request, so counting it now double-counts it.
          try {
            const govProject = await c.var.langwatchApp.projects.projectService.ensureInternal({
              organizationId: source.organizationId,
              kind: "internal_governance",
            });
            stampMetricOriginAttrs({ request: parsed.request, source });
            enforceApiKeyIdOnMetricRequest(
              parsed.request as unknown as Parameters<
                typeof enforceApiKeyIdOnMetricRequest
              >[0],
              null,
            );
            const result =
              await c.var.langwatchApp.traceIngestion.metricCollection.handleOtlpMetricRequest({
                tenantId: govProject.id,
                organizationId: source.organizationId,
                metricRequest: parsed.request,
                piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
              });
            if (result.outcome === "unavailable") {
              return c.json({ accepted: false, error: result.errorMessage }, 503);
            }
            rejectedDataPoints = result.rejectedDataPoints;
            acceptedDataPoints = result.acceptedDataPoints;
            parseHint = result.errorMessage;
          } catch (error) {
            logger.error(
              { error, sourceId: source.id },
              "otel metrics ingest failed after parsing; answering retryably",
            );
            return c.json({ accepted: false, error: "failed to record data point" }, 503);
          }
        }
      }
    } catch (err) {
      parseHint = String(err);
    }

    await c.var.langwatchApp.governance.ingestionSourceRecordEventReceived(source.id);
    logger.info(
      {
        sourceId: source.id,
        bytes: bodyBytes,
        metrics: metricCount,
      },
      "otel metrics ingest landed",
    );

    const responseBody: Record<string, unknown> = {
      accepted: true,
      bytes: bodyBytes,
      metrics: metricCount,
      acceptedDataPoints,
      partialSuccess: {
        rejectedDataPoints,
        ...(parseHint ? { errorMessage: parseHint } : {}),
      },
    };
    if (parseHint) responseBody.hint = parseHint;
    return c.json(responseBody, 202);
  });

export const app = secured.hono;
