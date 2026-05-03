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
 * carries RBAC + retention class for governance data without leaking
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
import type { Context } from "hono";
import { Hono } from "hono";

import type {
  IExportLogsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import type { IngestionSource } from "@prisma/client";

import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { IngestionSourceService } from "~/server/governance/activity-monitor/ingestionSource.service";
import { ensureHiddenGovernanceProject } from "~/server/governance/governanceProject.service";
import {
  parseOtlpTraces,
  readOtlpBody,
} from "~/server/otel/parseOtlpBody";
import { createLogger } from "~/utils/logger/server";

import { checkIpRateLimit, extractClientIp } from "./rateLimit";

/**
 * Stamp `langwatch.origin.*` + `langwatch.governance.*` attributes on
 * every span of the parsed OTLP request, in-place. The trace pipeline
 * persists these alongside any caller-supplied attributes; downstream
 * consumers (governance fold projection, OCSF read projection) filter
 * on `langwatch.origin.kind = "ingestion_source"`.
 *
 * Spec: receiver-shapes.feature, retention.feature.
 */
function stampOriginAttrs(
  request: IExportTraceServiceRequest,
  source: IngestionSource,
): void {
  const originAttrs = [
    { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
    { key: "langwatch.ingestion_source.id", value: { stringValue: source.id } },
    {
      key: "langwatch.ingestion_source.organization_id",
      value: { stringValue: source.organizationId },
    },
    {
      key: "langwatch.ingestion_source.source_type",
      value: { stringValue: source.sourceType },
    },
    {
      key: "langwatch.governance.retention_class",
      value: { stringValue: source.retentionClass },
    },
  ];
  for (const rs of request.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const existing = span.attributes ?? [];
        span.attributes = [...existing, ...originAttrs];
      }
    }
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
                attributes: [
                  {
                    key: "langwatch.origin.kind",
                    value: { stringValue: "ingestion_source" },
                  },
                  {
                    key: "langwatch.ingestion_source.id",
                    value: { stringValue: source.id },
                  },
                  {
                    key: "langwatch.ingestion_source.organization_id",
                    value: { stringValue: source.organizationId },
                  },
                  {
                    key: "langwatch.ingestion_source.source_type",
                    value: { stringValue: source.sourceType },
                  },
                  {
                    key: "langwatch.governance.retention_class",
                    value: { stringValue: source.retentionClass },
                  },
                ],
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

export const app = new Hono().basePath("/api/ingest");

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
//      langwatch.ingestion_source.{id,organization_id,source_type} +
//      langwatch.governance.retention_class. The governance fold
//      projection + OCSF read projection downstream filter on these.
//   3. Hand off to the existing trace pipeline via
//      getApp().traces.collection.handleOtlpTraceRequest with the Gov
//      Project as the tenant. The receiver does NOT write CH directly.
//
// Spec contracts:
//   - receiver-shapes.feature (Lane-S)
//   - architecture-invariants.feature (Lane-B)
//   - retention.feature (Lane-S)
// ---------------------------------------------------------------------------
app.post("/otel/:sourceId", async (c: Context) => {
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
  if (source.sourceType !== "otel_generic" && source.sourceType !== "claude_cowork") {
    return c.json(
      { error: "wrong_endpoint", error_description: "OTLP path is only valid for otel_generic and claude_cowork sources" },
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
        const govProject = await ensureHiddenGovernanceProject(
          prisma,
          source.organizationId,
        );
        stampOriginAttrs(parsed.request, source);
        const result = await getApp().traces.collection.handleOtlpTraceRequest(
          govProject.id,
          parsed.request,
          govProject.piiRedactionLevel,
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

  const service = IngestionSourceService.create(prisma);
  await service.recordEventReceived(source.id);
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
//   - retention.feature origin-attribute-stamping scenarios
// ---------------------------------------------------------------------------
app.post("/webhook/:sourceId", async (c: Context) => {
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
        logRequest,
        piiRedactionLevel: govProject.piiRedactionLevel,
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
