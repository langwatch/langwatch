// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * BullMQ worker driving the PullerAdapter framework.
 *
 * Per scheduled tick:
 *   1. Load IngestionSource by id (must be active + in pull mode)
 *   2. Resolve adapter from `pullConfig.adapter` via the registry
 *   3. Read `pollerCursor` from the IngestionSource row
 *   4. Resolve credentials (placeholder — wired into the existing
 *      ingestion-source secret store; for the framework demo, credentials
 *      flow through `parserConfig.credentials`)
 *   5. Call `adapter.runOnce({ cursor, credentials, context })`
 *   6. Persist new cursor on success, increment errorCount on failure
 *   7. Hand off `events` to the trace store ingest path (TODO: wire
 *      to OCSF event sink — left as a follow-up to keep this slice
 *      focused on the framework + scheduling. The reactor at
 *      governanceOcsfEventsSync.reactor.ts already understands the
 *      payload shape; the adapter's NormalizedPullEvent maps cleanly
 *      onto its input.)
 *
 * This worker is the source-agnostic dispatcher — it does NOT contain
 * any per-source logic. New sources arrive by registering an adapter
 * in `pullers/index.ts` and pointing IngestionSource.pullConfig at it.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { Prisma } from "@prisma/client";
import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

import { env } from "~/env.mjs";
import type { IngestionPullerJob } from "~/server/background/types";
import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { withJobContext } from "~/server/context/asyncContext";
import { prisma } from "~/server/db";
import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";
import {
  captureException,
  withScope,
} from "~/utils/posthogErrorCapture";
import { PULLER_QUEUE } from "~/server/background/queues/constants";

import {
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
  type GovernanceOcsfEventInput,
} from "../governanceOcsfEvents.clickhouse.repository";

import {
  pullerAdapterRegistry,
  registerBuiltInPullers,
  type NormalizedPullEvent,
  type PullResult,
} from "./index";

const logger = createLogger("langwatch:workers:ingestionPuller");

// Soft per-job deadline. The scheduled cadence is the primary control
// — long-running pulls just defer follow-on work to the next tick.
const PER_JOB_DEADLINE_MS = 5 * 60 * 1000;

export async function runIngestionPullerJob(
  job: Job<IngestionPullerJob, void, string>,
): Promise<void> {
  registerBuiltInPullers();

  const { ingestionSourceId } = job.data;
  logger.info({ jobId: job.id, ingestionSourceId }, "puller job start");

  const source = await prisma.ingestionSource.findUnique({
    where: { id: ingestionSourceId },
  });
  if (!source) {
    logger.warn({ ingestionSourceId }, "IngestionSource not found, skipping");
    return;
  }
  if (source.status !== "active" && source.status !== "awaiting_first_event") {
    logger.info(
      { ingestionSourceId, status: source.status },
      "IngestionSource not active, skipping",
    );
    return;
  }

  const pullConfig = (source.parserConfig ?? {}) as Record<string, unknown>;
  const adapterId = pullConfig.adapter;
  if (typeof adapterId !== "string") {
    logger.warn(
      { ingestionSourceId },
      "IngestionSource has no pullConfig.adapter; not a pull-mode source",
    );
    return;
  }
  const adapter = pullerAdapterRegistry.get(adapterId);
  if (!adapter) {
    logger.error(
      { ingestionSourceId, adapterId },
      "Unknown adapter id — refusing to dispatch",
    );
    await prisma.ingestionSource.update({
      where: { id: ingestionSourceId },
      data: { errorCount: { increment: 1 } },
    });
    return;
  }

  let validatedConfig: unknown;
  try {
    validatedConfig = adapter.validateConfig(pullConfig);
  } catch (error) {
    logger.error(
      { ingestionSourceId, adapterId, error },
      "pullConfig validation failed",
    );
    await prisma.ingestionSource.update({
      where: { id: ingestionSourceId },
      data: { errorCount: { increment: 1 } },
    });
    return;
  }

  const credentials =
    typeof pullConfig.credentials === "object" && pullConfig.credentials !== null
      ? (pullConfig.credentials as Record<string, string>)
      : {};

  const cursor =
    typeof source.pollerCursor === "string"
      ? source.pollerCursor
      : source.pollerCursor !== null && typeof source.pollerCursor === "object"
      ? // Some adapters persist structured cursors; for now we serialize.
        JSON.stringify(source.pollerCursor)
      : null;

  let result: PullResult;
  try {
    result = await adapter.runOnce(
      {
        cursor,
        credentials,
        context: {
          organizationId: source.organizationId,
          ingestionSourceId: source.id,
        },
        deadlineMs: Date.now() + PER_JOB_DEADLINE_MS,
      },
      validatedConfig,
    );
  } catch (error) {
    logger.error(
      { ingestionSourceId, adapterId, error },
      "adapter.runOnce threw — incrementing errorCount + leaving cursor unchanged",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "ingestionPuller");
      scope.setExtra?.("ingestionSourceId", ingestionSourceId);
      captureException(error);
    });
    await prisma.ingestionSource.update({
      where: { id: ingestionSourceId },
      data: { errorCount: { increment: 1 } },
    });
    return;
  }

  // Hand off events to the governance_ocsf_events sink. Each
  // NormalizedPullEvent → one OCSF row keyed by (TenantId, EventId)
  // for natural dedup on replay (BullMQ at-least-once + adapter
  // at-least-once both collapse via the ReplacingMergeTree). Going
  // direct-to-CH (rather than synthesizing a fake trace) is the right
  // shape for pull-mode: each audit-log entry is a single event, not
  // a multi-span trace.
  if (result.events.length > 0) {
    const ocsfRepo = new GovernanceOcsfEventsClickHouseRepository(
      getClickHouseClientForOrganization,
    );
    let inserted = 0;
    for (const evt of result.events) {
      try {
        await ocsfRepo.insertEvent(
          mapToOcsfRow({
            event: evt,
            organizationId: source.organizationId,
            ingestionSourceId: source.id,
            sourceType: source.sourceType,
          }),
        );
        inserted += 1;
      } catch (error) {
        // Single-event failures don't tear down the whole batch — log
        // + capture, leave cursor unchanged so the next run re-pulls
        // and the failed event gets another shot. ReplacingMergeTree
        // handles the duplicate from the successful events on retry.
        logger.error(
          {
            ingestionSourceId,
            sourceEventId: evt.source_event_id,
            error,
          },
          "Failed to insert OCSF event row",
        );
      }
    }
    logger.info(
      {
        ingestionSourceId,
        adapterId,
        eventCount: result.events.length,
        ocsfInserted: inserted,
      },
      "puller events written to governance_ocsf_events",
    );
  }

  // Persist the new cursor + reset errorCount on success. JSON columns
  // need Prisma.JsonNull for SQL NULL, not bare JS null.
  await prisma.ingestionSource.update({
    where: { id: ingestionSourceId },
    data: {
      pollerCursor: result.cursor === null ? Prisma.JsonNull : result.cursor,
      errorCount: result.errorCount > 0 ? { increment: 1 } : 0,
      lastEventAt: result.events.length > 0 ? new Date() : undefined,
      status: source.status === "awaiting_first_event" && result.events.length > 0
        ? "active"
        : source.status,
    },
  });

  logger.info(
    {
      jobId: job.id,
      ingestionSourceId,
      adapterId,
      eventCount: result.events.length,
      cursor: result.cursor,
      errorCount: result.errorCount,
    },
    "puller job done",
  );
}

/**
 * Map a NormalizedPullEvent to a GovernanceOcsfEventInput row. Each
 * pull event becomes ONE OCSF row (ClassUid 6003 / API Activity, with
 * ActivityId INVOKE for completion-style events). The raw_payload is
 * preserved verbatim under metadata.extension.raw_event so SIEM
 * consumers can still drill back to the source-of-truth bytes.
 *
 * EventId is `${sourceType}:${source_event_id}` to keep the (TenantId,
 * EventId) key unique across multiple sources of the same type.
 */
function mapToOcsfRow({
  event,
  organizationId,
  ingestionSourceId,
  sourceType,
}: {
  event: NormalizedPullEvent;
  organizationId: string;
  ingestionSourceId: string;
  sourceType: string;
}): GovernanceOcsfEventInput {
  const eventTime = new Date(event.event_timestamp);
  const safeEventTime = Number.isFinite(eventTime.getTime())
    ? eventTime
    : new Date();
  const eventId = `${sourceType}:${event.source_event_id}`;
  const occurredAtMs = safeEventTime.getTime();
  const rawOcsfJson = JSON.stringify({
    class_uid: 6003,
    category_uid: 6,
    activity_id: OCSF_ACTIVITY.INVOKE,
    type_uid: 6003 * 100 + OCSF_ACTIVITY.INVOKE,
    severity_id: OCSF_SEVERITY.INFO,
    time: occurredAtMs,
    actor: {
      user: { uid: "", email_addr: event.actor },
      enduser: { uid: "" },
    },
    api: { operation: event.action },
    dst_endpoint: { name: event.target },
    metadata: {
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      extension: {
        uid: "langwatch.governance",
        source_type: sourceType,
        source_id: ingestionSourceId,
        ingest_mode: "pull",
        cost_usd: event.cost_usd,
        tokens_input: event.tokens_input,
        tokens_output: event.tokens_output,
        raw_event: event.raw_payload,
        ...(event.extra ?? {}),
      },
    },
  });
  return {
    tenantId: organizationId,
    eventId,
    // Pull events are atomic — synthesize a stable trace id from the
    // event id so SIEM-side pivot ("show me this trace") still works.
    traceId: `pull:${eventId}`,
    sourceId: ingestionSourceId,
    sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: safeEventTime,
    actorUserId: "",
    actorEmail: event.actor,
    actorEnduserId: "",
    actionName: event.action,
    targetName: event.target,
    anomalyAlertId: "",
    rawOcsfJson,
  };
}

export const startIngestionPullerWorker = (): Worker | null => {
  if (!connection) {
    logger.info("no redis connection, skipping ingestion puller worker");
    return null;
  }
  const worker = new Worker<IngestionPullerJob, void, string>(
    PULLER_QUEUE.NAME,
    withJobContext(runIngestionPullerJob),
    {
      connection,
      concurrency: env.NODE_ENV === "test" ? 1 : 4,
      telemetry: new BullMQOtel("ingestion_puller"),
    },
  );
  worker.on("error", (error) => {
    logger.error({ error }, "ingestion puller worker error");
  });
  return worker;
};
