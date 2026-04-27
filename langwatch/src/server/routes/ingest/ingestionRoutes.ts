/**
 * IngestionSource receivers — push-mode entry points for the Activity
 * Monitor pillar. Two endpoints in this slice (foundation):
 *
 *   POST /api/ingest/otel/:sourceId      OTLP/HTTP passthrough
 *   POST /api/ingest/webhook/:sourceId   Generic JSON webhook
 *
 * Per-platform adapters (Cowork-flavoured OTel, Workato-shaped
 * webhook, S3 drops with custom DSL, Office365 puller) get their own
 * routes/jobs in follow-up slices. This file establishes the
 * authentication contract + the OCSF normalisation handoff that all
 * push-mode receivers share.
 *
 * Auth: Authorization: Bearer <ingestSecret>. The IngestionSource is
 * resolved by raw secret → hash lookup, with a 24h grace window for
 * rotated secrets (see IngestionSourceService.findByIngestSecret).
 *
 * Out of scope for this slice (deferred to follow-up):
 *   - Real OCSF/AOS event normalisation (today: capture raw, tag with
 *     SourceType + SourceId, defer parse to a downstream pipeline)
 *   - Per-platform adapter logic
 *   - Anomaly detection
 *   - Alert routing
 */
import type { Context } from "hono";
import { Hono } from "hono";

import { prisma } from "~/server/db";
import { IngestionSourceService } from "~/server/governance/activity-monitor/ingestionSource.service";
import { createLogger } from "~/utils/logger/server";

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

  // Body shape validation is light at this slice — parsers per source
  // type land later. We just count bytes and attempt JSON parse for
  // the health metrics, then ack.
  let bodyBytes = 0;
  let parseOk = true;
  try {
    const raw = await c.req.text();
    bodyBytes = raw.length;
    JSON.parse(raw); // throws on malformed JSON; we still 202 below
  } catch {
    parseOk = false;
  }

  const service = IngestionSourceService.create(prisma);
  await service.recordEventReceived(source.id);
  logger.info(
    {
      sourceId: source.id,
      sourceType: source.sourceType,
      bytes: bodyBytes,
      parseOk,
    },
    "otel ingest received",
  );

  // 202 Accepted: we've taken the bytes; downstream parse + persist is
  // async (and a no-op in this foundation slice).
  return c.json({ accepted: true, bytes: bodyBytes }, 202);
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

  let bodyBytes = 0;
  let parseOk = true;
  try {
    const raw = await c.req.text();
    bodyBytes = raw.length;
    JSON.parse(raw);
  } catch {
    parseOk = false;
  }

  const service = IngestionSourceService.create(prisma);
  await service.recordEventReceived(source.id);
  logger.info(
    {
      sourceId: source.id,
      sourceType: source.sourceType,
      bytes: bodyBytes,
      parseOk,
    },
    "webhook ingest received",
  );

  return c.json({ accepted: true, bytes: bodyBytes }, 202);
});
