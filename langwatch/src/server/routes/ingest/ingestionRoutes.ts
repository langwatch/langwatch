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
 * Event sourcing (since C1): the receiver normalises the body and
 * appends an `ActivityEventReceived` event into event_log via
 * `getApp().activityMonitor.recordActivityEvent`. The
 * activityEventStorage map projection then writes the row to
 * `gateway_activity_events`. The receiver no longer writes CH
 * directly — see docs/ai-gateway/governance/activity-monitor-event-sourcing.md
 * for the architecture rationale (rchaves directive 2026-04-27 +
 * PR #3351 pattern).
 *
 * Out of scope for this slice (deferred to follow-up):
 *   - Per-platform deeper normalisers (Workato audit, Copilot Studio
 *     poller, S3 custom DSL, Compliance API pullers)
 *   - Anomaly detection (Option C2 — anomaly reactor on the same
 *     pipeline)
 *   - Alert routing destinations beyond log-only (Option C3)
 */
import type { Context } from "hono";
import { Hono } from "hono";

import type { IngestionSource } from "@prisma/client";

import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { IngestionSourceService } from "~/server/governance/activity-monitor/ingestionSource.service";
import { normalizeOtlpRequest } from "~/server/governance/activity-monitor/normalizers/otel";
import {
  parseOtlpTraces,
  readOtlpBody,
} from "~/server/otel/parseOtlpBody";
import { createLogger } from "~/utils/logger/server";

/**
 * The activity-monitor event-sourcing pipeline writes events to
 * `event_log` (ClickHouse), which resolves its CH client by treating
 * the event's `tenantId` as a Project id. IngestionSources are
 * org-scoped (no projectId), so we need a representative project for
 * the org to anchor the event-log writes.
 *
 * This cache holds (organizationId → projectId) for the resolved
 * representative project. Misses do a single lookup, hits are O(1).
 * The CH `gateway_activity_events.TenantId` column still carries
 * `IngestionSource.id` (set by the map projection from data.sourceId),
 * so the storage table's tenancy semantics are unchanged — only the
 * event_log layer is bridged through a project id.
 */
const orgRepresentativeProjectCache = new Map<string, string>();

async function resolveEventLogProjectId(
  source: IngestionSource,
): Promise<string | null> {
  const cached = orgRepresentativeProjectCache.get(source.organizationId);
  if (cached) return cached;
  const project = await prisma.project.findFirst({
    where: { team: { organizationId: source.organizationId } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!project) return null;
  orgRepresentativeProjectCache.set(source.organizationId, project.id);
  return project.id;
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

// ---------------------------------------------------------------------------
// POST /api/ingest/otel/:sourceId
// ---------------------------------------------------------------------------
// Generic OTLP/HTTP passthrough receiver. Accepts standard OTLP JSON
// payloads (resource_spans / log_records). The body is parked under the
// IngestionSource's normalisation queue for OCSF mapping in a follow-up
// adapter slice. For this foundation slice we acknowledge receipt + tag
// the source as having seen its first event so the admin UI flips the
// status to 'active'.
// ---------------------------------------------------------------------------
app.post("/otel/:sourceId", async (c: Context) => {
  const source = await authIngestionSource(c);
  if (!source) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sourceId = c.req.param("sourceId");
  if (sourceId !== source.id) {
    // Path source id vs auth source id mismatch — could be a benign
    // typo or a probe; either way reject without leaking which one
    // exists.
    return c.json({ error: "unauthorized" }, 401);
  }
  if (source.sourceType !== "otel_generic" && source.sourceType !== "claude_cowork") {
    return c.json(
      { error: "wrong_endpoint", error_description: "OTLP path is only valid for otel_generic and claude_cowork sources" },
      400,
    );
  }

  // Parse + normalise + enqueue events into the event-sourcing pipeline.
  // Even if parse fails we still 202-ack (upstream platforms shouldn't
  // retry-bomb us); the source's lastEventAt still flips synchronously
  // so the admin sees the connection is alive. The map projection
  // writes the row to gateway_activity_events.
  //
  // Body read + decompress + protobuf/JSON parse all run through the
  // shared src/server/otel helper so this path matches /api/otel/v1/traces
  // for gzip / deflate / brotli + protobuf + JSON-then-protobuf-encode
  // fallback. OCSF mapping is the only governance-specific step
  // downstream.
  let bodyBytes = 0;
  let eventCount = 0;
  let parseHint: string | undefined;
  const eventLogProjectId = await resolveEventLogProjectId(source);
  try {
    const body = await readOtlpBody(c.req.raw);
    bodyBytes = body.byteLength;
    const parsed = parseOtlpTraces(body, c.req.header("content-type"));
    if (!parsed.ok) {
      parseHint = parsed.error;
      logger.warn(
        { sourceId: source.id, err: parsed.error },
        "otel ingest body did not parse as OTLP (still ack'ing)",
      );
    } else {
      const rawPayload =
        bodyBytes > 0 ? Buffer.from(body).toString("utf-8") : "";
      const events = normalizeOtlpRequest(source, parsed.request, rawPayload);
      eventCount = events.length;
      if (!eventLogProjectId) {
        logger.warn(
          { sourceId: source.id, organizationId: source.organizationId },
          "no project in org — activity events not enqueued (lastEventAt still flips)",
        );
      } else {
        const occurredAt = Date.now();
        for (const ev of events) {
          await getApp().activityMonitor.recordActivityEvent({
            tenantId: eventLogProjectId,
            occurredAt,
            sourceId: source.id,
            organizationId: source.organizationId,
            sourceType: ev.sourceType,
            eventType: ev.eventType,
            eventId: ev.eventId,
            actor: ev.actor ?? "",
            action: ev.action ?? "",
            target: ev.target ?? "",
            costUsd: ev.costUsd,
            tokensInput: ev.tokensInput ?? 0,
            tokensOutput: ev.tokensOutput ?? 0,
            rawPayload: ev.rawPayload ?? "",
            eventTimestampMs: ev.eventTimestamp.getTime(),
          });
        }
      }
    }
  } catch (err) {
    parseHint = String(err);
    logger.warn(
      { sourceId: source.id, err: String(err) },
      "otel ingest enqueue failed (still ack'ing)",
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
    },
    "otel ingest received",
  );

  // Onboarding-friendly hint: body present but produced zero events.
  // The receiver still 202-acks (production traffic mustn't be retried
  // because of one bad span), but during first-event setup this silent
  // success is the #1 reason fresh users think it works and then get
  // confused that the dashboard stays empty. parseHint surfaces the
  // concrete reason (unsupported Content-Encoding, malformed protobuf,
  // JSON that doesn't decode) when set; otherwise we fall back to the
  // generic "shape doesn't carry spans" hint.
  const responseBody: Record<string, unknown> = {
    accepted: true,
    bytes: bodyBytes,
    events: eventCount,
  };
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
// Generic JSON webhook receiver. Used by source types that push events
// over HTTPS to a customer-specific URL: workato (audit log streaming),
// custom in-house agents, future adapters with bespoke shapes. Body is
// stored verbatim and dispatched to the per-source-type adapter
// downstream (in this slice we just acknowledge + flip status).
// ---------------------------------------------------------------------------
app.post("/webhook/:sourceId", async (c: Context) => {
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

  // Webhook receivers are platform-specific in shape — for the
  // foundation we only enqueue a single envelope event with the raw
  // payload. Per-platform normalisers (workato audit shape, S3
  // custom DSL, etc.) ship in follow-up adapter slices and replace
  // this minimal envelope with their richer normalised events.
  let bodyBytes = 0;
  let envelopeId = "";
  let raw = "";
  const eventLogProjectId = await resolveEventLogProjectId(source);
  try {
    raw = await c.req.text();
    bodyBytes = raw.length;
    envelopeId = `envelope-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (!eventLogProjectId) {
      logger.warn(
        { sourceId: source.id, organizationId: source.organizationId },
        "no project in org — webhook event not enqueued (lastEventAt still flips)",
      );
    } else {
      const occurredAt = Date.now();
      await getApp().activityMonitor.recordActivityEvent({
        tenantId: eventLogProjectId,
        occurredAt,
        sourceId: source.id,
        organizationId: source.organizationId,
        sourceType: source.sourceType,
        eventType: "agent.action",
        eventId: envelopeId,
        actor: "",
        action: "",
        target: "",
        tokensInput: 0,
        tokensOutput: 0,
        rawPayload: raw,
        eventTimestampMs: occurredAt,
      });
    }
  } catch (err) {
    logger.warn(
      { sourceId: source.id, err: String(err) },
      "webhook ingest enqueue failed (still ack'ing)",
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
    },
    "webhook ingest received",
  );

  return c.json({ accepted: true, bytes: bodyBytes, eventId: envelopeId }, 202);
});
