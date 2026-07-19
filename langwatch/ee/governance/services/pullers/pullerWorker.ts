// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One idempotent pull effect driven by the process-manager outbox.
 *
 * Per scheduled tick:
 *   1. Load IngestionSource by id (must be active + in pull mode)
 *   2. Resolve adapter from `pullConfig.adapter` via the registry
 *   3. Use the durable cursor supplied by the process state
 *   4. Resolve credentials (placeholder — wired into the existing
 *      ingestion-source secret store; for the framework demo, credentials
 *      flow through `parserConfig.credentials`)
 *   5. Call `adapter.runOnce({ cursor, credentials, context })`
 *   6. Write the normalized events to the OCSF sink
 *   7. Return an outcome; completion/failure events and their projection own
 *      cursor, status, and error state
 *
 * This worker is the source-agnostic dispatcher — it does NOT contain
 * any per-source logic. New sources arrive by registering an adapter
 * in `pullers/index.ts` and pointing IngestionSource.pullConfig at it.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { createLogger } from "@langwatch/observability";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import { decryptCredentials } from "../activity-monitor/ingestionCredentials";

import {
  type GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";

import {
  type NormalizedPullEvent,
  type PullResult,
  pullerAdapterRegistry,
  registerBuiltInPullers,
} from "./index";

const logger = createLogger("langwatch:workers:ingestionPuller");

// Soft per-job deadline. The scheduled cadence is the primary control
// — long-running pulls just defer follow-on work to the next tick.
const PER_JOB_DEADLINE_MS = 5 * 60 * 1000;

export async function runIngestionPull(params: {
  sourceId: string;
  cursor: string | null;
}): Promise<{ nextCursor: string | null; eventCount: number }> {
  registerBuiltInPullers();

  const ingestionSourceId = params.sourceId;
  logger.info({ ingestionSourceId }, "puller run start");

  const source = await prisma.ingestionSource.findUnique({
    where: { id: ingestionSourceId },
  });
  if (!source) {
    throw new Error(`IngestionSource ${ingestionSourceId} not found`);
  }
  if (source.status !== "active" && source.status !== "awaiting_first_event") {
    logger.info(
      { ingestionSourceId, status: source.status },
      "IngestionSource not active, skipping",
    );
    return { nextCursor: params.cursor, eventCount: 0 };
  }

  const pullConfig = (source.parserConfig ?? {}) as Record<string, unknown>;
  const adapterId = pullConfig.adapter;
  if (typeof adapterId !== "string") {
    logger.warn(
      { ingestionSourceId },
      "IngestionSource has no pullConfig.adapter; not a pull-mode source",
    );
    throw new Error("IngestionSource has no pullConfig.adapter");
  }
  const adapter = pullerAdapterRegistry.get(adapterId);
  if (!adapter) {
    logger.error(
      { ingestionSourceId, adapterId },
      "Unknown adapter id — refusing to dispatch",
    );
    throw new Error(`Unknown ingestion pull adapter: ${adapterId}`);
  }

  let validatedConfig: unknown;
  try {
    validatedConfig = adapter.validateConfig(pullConfig);
  } catch (error) {
    logger.error(
      { ingestionSourceId, adapterId, error },
      "pullConfig validation failed",
    );
    throw error;
  }

  const credentials = decryptCredentials(pullConfig.credentials);

  let result: PullResult;
  try {
    result = await adapter.runOnce(
      {
        cursor: params.cursor,
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
      "adapter.runOnce threw — leaving the durable cursor unchanged",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "ingestionPuller");
      scope.setExtra?.("ingestionSourceId", ingestionSourceId);
      captureException(toError(error));
    });
    throw error;
  }

  if (result.errorCount > 0) {
    throw new Error(
      `Ingestion pull adapter reported ${result.errorCount} error(s)`,
    );
  }

  // Hand off events to the governance_ocsf_events sink. Each
  // NormalizedPullEvent → one OCSF row keyed by (TenantId, EventId)
  // for natural dedup on replay (outbox at-least-once + adapter
  // at-least-once both collapse via the ReplacingMergeTree). Going
  // direct-to-CH (rather than synthesizing a fake trace) is the right
  // shape for pull-mode: each audit-log entry is a single event, not
  // a multi-span trace.
  //
  // TenantId convention: every governance write path (the trace fold
  // reactor, the OCSF export service) keys on the org's hidden
  // internal_governance Project ID. Pull events MUST follow the same
  // convention or they're invisible to SIEM export reads. Resolve
  // (and lazy-mint) that project once per job; the `governance_ocsf_events`
  // CH client is also acquired per-project so per-org private CH
  // clusters route correctly.
  if (result.events.length > 0) {
    const govProject = await ensureHiddenGovernanceProject(
      prisma,
      source.organizationId,
    );
    const ocsfRepo = new GovernanceOcsfEventsClickHouseRepository(
      async (tenantId) => {
        const client = await getClickHouseClientForProject(tenantId);
        if (!client) {
          throw new Error(`ClickHouse not available for tenant ${tenantId}`);
        }
        return client;
      },
    );
    for (const evt of result.events) {
      await ocsfRepo.insertEvent(
        mapToOcsfRow({
          event: evt,
          tenantId: govProject.id,
          ingestionSourceId: source.id,
          sourceType: source.sourceType,
        }),
      );
    }
    logger.info(
      {
        ingestionSourceId,
        adapterId,
        eventCount: result.events.length,
        ocsfInserted: result.events.length,
      },
      "puller events written to governance_ocsf_events",
    );
  }

  logger.info(
    {
      ingestionSourceId,
      adapterId,
      eventCount: result.events.length,
      cursor: result.cursor,
      errorCount: result.errorCount,
    },
    "puller run done",
  );
  return { nextCursor: result.cursor, eventCount: result.events.length };
}

/**
 * Map a NormalizedPullEvent to a GovernanceOcsfEventInput row. Each
 * pull event becomes ONE OCSF row (ClassUid 6003 / API Activity, with
 * ActivityId INVOKE for completion-style events). The raw_payload is
 * preserved verbatim under metadata.extension.raw_event so SIEM
 * consumers can still drill back to the source-of-truth bytes.
 *
 * EventId includes the source id so two same-type sources cannot collide.
 *
 * `tenantId` MUST be the hidden internal_governance Project ID for the
 * org — same key the trace-fold reactor and OCSF export service use.
 * Resolved by the worker before this is called.
 */
function mapToOcsfRow({
  event,
  tenantId,
  ingestionSourceId,
  sourceType,
}: {
  event: NormalizedPullEvent;
  tenantId: string;
  ingestionSourceId: string;
  sourceType: string;
}): GovernanceOcsfEventInput {
  const eventTime = new Date(event.event_timestamp);
  const safeEventTime = Number.isFinite(eventTime.getTime())
    ? eventTime
    : new Date();
  const eventId = `${sourceType}:${ingestionSourceId}:${event.source_event_id}`;
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
    tenantId,
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
