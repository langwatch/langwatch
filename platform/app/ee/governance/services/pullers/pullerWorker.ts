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
import type { PulledUsageObservedEventData } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import { decryptCredentials } from "../activity-monitor/ingestionCredentials";
import {
  type GovernanceOcsfEventInput,
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
import { buildPulledUsageRecord } from "./pulledUsageRecord";

const logger = createLogger("langwatch:workers:ingestionPuller");

// Hard per-job deadline. A run cannot execute for longer than this: the
// adapter is asked to stop cooperatively (deadlineMs), its transport is
// aborted (signal), and this worker stops awaiting it either way.
//
// It has to be hard because the scheduler supersedes a run it considers stale
// (INGESTION_PULL_STALE_RUN_MS, 30min) and starts a fresh one from the same
// cursor. If a hung run could outlive that, two pulls would read the same
// window concurrently and whichever finished last would decide the durable
// cursor. The gap between the two is deliberate slack, not a coincidence.
const PER_JOB_DEADLINE_MS = 5 * 60 * 1000;

/**
 * Raised when a run is cut off at its deadline.
 *
 * Surfaces as a run failure: the cursor is left where it was, so the window
 * is retried rather than silently skipped.
 */
export class IngestionPullDeadlineExceededError extends Error {
  constructor(deadlineMs: number) {
    super(`Ingestion pull exceeded its ${deadlineMs}ms deadline`);
    this.name = "IngestionPullDeadlineExceededError";
  }
}

/**
 * Runs `work` under a deadline that does not depend on `work` cooperating.
 *
 * The abort signal is passed in so the adapter can unwind its own transport;
 * the race is what guarantees this worker stops waiting even if it does not.
 */
async function withDeadline<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new IngestionPullDeadlineExceededError(timeoutMs)),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Unblocks any transport still holding the signal once we have stopped
    // waiting -- including when `work` lost the race.
    controller.abort();
  }
}

/**
 * The pulled-usage write surface, late-bound by the composition root exactly
 * the way the ingestion-pull outcome commands are: it belongs to a different
 * pipeline that is built after this worker is referenced.
 *
 * Optional. Without it the worker behaves as it always did — audit rows only,
 * no cost records — which is what a deployment with the pipeline switched off
 * should do.
 */
export interface PulledUsageDispatcher {
  recordPulledUsage(
    args: PulledUsageObservedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

export async function runIngestionPull(params: {
  sourceId: string;
  cursor: string | null;
  pulledUsage?: PulledUsageDispatcher;
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
    result = await withDeadline(PER_JOB_DEADLINE_MS, (signal) =>
      adapter.runOnce(
        {
          cursor: params.cursor,
          credentials,
          context: {
            organizationId: source.organizationId,
            ingestionSourceId: source.id,
          },
          deadlineMs: Date.now() + PER_JOB_DEADLINE_MS,
          signal,
        },
        validatedConfig,
      ),
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

  if (result.events.length > 0) {
    await writePulledEvents({
      events: result.events,
      source,
      pulledUsage: params.pulledUsage,
    });
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

/** The IngestionSource fields the two write paths below actually read. */
type PullingSource = {
  id: string;
  sourceType: string;
  organizationId: string;
  teamId: string | null;
};

/**
 * Writes one run's events: the OCSF audit row every pulled event has always
 * produced, and — for the ones carrying priced usage — a cost record beside it.
 *
 * Each NormalizedPullEvent → one OCSF row keyed by (TenantId, EventId), so
 * replays collapse on the ReplacingMergeTree (outbox at-least-once and adapter
 * at-least-once both land on the same key). Going direct-to-CH rather than
 * synthesizing a fake trace is the right shape for pull mode: an audit entry is
 * a single event, not a multi-span trace.
 *
 * TenantId convention: every governance write path (the trace fold's subscriber,
 * the OCSF export service) keys on the org's hidden internal_governance
 * Project ID, and pull events MUST follow it or they are invisible to SIEM
 * export reads. Resolved — and lazily minted — once per job; the ClickHouse
 * client is acquired per project so per-org private clusters route correctly.
 */
async function writePulledEvents({
  events,
  source,
  pulledUsage,
}: {
  events: NormalizedPullEvent[];
  source: PullingSource;
  pulledUsage?: PulledUsageDispatcher;
}): Promise<void> {
  const govProject = await ensureHiddenGovernanceProject(
    prisma,
    source.organizationId,
  );
  // ADR-088's stated gate for the new event + ledger write. Resolved ONCE per
  // run rather than per item: the answer cannot change mid-batch, and a flag
  // read per usage row would put a lookup on the money path for no decision.
  // Off → the loop below writes audit rows only, exactly as it did before.
  const costRecordingEnabled = await pulledUsageCostEnabled(
    source.organizationId,
  );
  // Taken from the App rather than constructed here: #6622 made `getApp()` the
  // only way this file may reach ClickHouse, enforced by the client-access
  // boundary test. Constructing a repository inline would put this file back on
  // that test's shrinking backlog.
  const ocsfRepo = getApp().governance.ocsfEvents;
  if (!ocsfRepo) {
    throw new Error(
      "ClickHouse client is not available — check ClickHouse connection configuration",
    );
  }
  // One pull instant for the whole batch. `observedAt` is the restatement
  // ordering field, so every record in one run has to share it: two records
  // from the same pull disagreeing about when they were observed could order a
  // corrected figure behind the one it corrects.
  const observedAt = new Date();
  for (const event of events) {
    await ocsfRepo.insertEvent(
      mapToOcsfRow({
        event,
        tenantId: govProject.id,
        ingestionSourceId: source.id,
        sourceType: source.sourceType,
      }),
    );
    await recordPulledUsageFor({
      event,
      source,
      govProjectId: govProject.id,
      observedAt,
      pulledUsage: costRecordingEnabled ? pulledUsage : undefined,
    });
  }
}

/**
 * Whether this organization records pulled provider cost yet.
 *
 * Read through the layered service rather than the raw store, so the full
 * layering applies (env force-on → operator row → PostHog rule → registry
 * default). Keyed on the organization because pulled usage is attributed at
 * org/team and has no project of its own until ADR-088's Decision 4 lands.
 *
 * A lookup that throws must not silently start writing money, and it must not
 * silently stop either. Answering false on an error would do the second: the
 * run completes, the cursor advances, and the whole window is filed at no cost
 * with nothing left to retry it. So the error propagates and the run is
 * retried, the one outcome that neither invents a price nor loses one.
 */
async function pulledUsageCostEnabled(
  organizationId: string,
): Promise<boolean> {
  return await featureFlagService.isEnabled(
    "release_pulled_usage_cost_enabled",
    { distinctId: organizationId, organizationId },
  );
}

/**
 * Appends one `PulledUsageObserved` for an event that carries priced usage.
 *
 * The stream's tenant is the hidden governance project, following the same
 * convention every other pull writer uses — that is where the aggregate LIVES.
 * It is not where the money is attributed: the customer's organization and
 * team ride the record itself, and a null project says unattributed rather
 * than quietly naming the governance project (ADR-088 Decision 4).
 *
 * The two failures here are not the same failure, so they are not handled the
 * same way.
 *
 * Mapping the item is deterministic: a row that cannot be built will never
 * build, and throwing would re-pull the same window forever behind one
 * malformed row — a poison pill that stops every later item too. That one is
 * logged and swallowed. The OCSF audit row it was mapped from already landed,
 * so the fact survives and only its price is missing.
 *
 * Appending the record is I/O, and its failure is usually transient. Swallowing
 * that one would advance the cursor past a window whose cost was never written
 * and would never be retried, losing real money to an outage that heals by
 * itself. So it propagates, matching every other failure in this worker: the
 * run fails, the cursor holds, and the effect retries the window.
 *
 * Retrying a partly-recorded window does not double-count. An unchanged
 * observation writes no ledger row — `insertPulledUsageRows` drops it via
 * `pulledRowsThatChanged` — and the OCSF rows collapse on `(TenantId, EventId)`.
 */
async function recordPulledUsageFor({
  event,
  source,
  govProjectId,
  observedAt,
  pulledUsage,
}: {
  event: NormalizedPullEvent;
  source: PullingSource;
  govProjectId: string;
  observedAt: Date;
  pulledUsage?: PulledUsageDispatcher;
}): Promise<void> {
  if (!pulledUsage) return;

  let record: ReturnType<typeof buildPulledUsageRecord>;
  try {
    record = buildPulledUsageRecord({
      event,
      source: {
        ingestionSourceId: source.id,
        sourceType: source.sourceType,
        organizationId: source.organizationId,
        teamId: source.teamId,
      },
      observedAt,
    });
  } catch (error) {
    logger.error(
      {
        ingestionSourceId: source.id,
        sourceEventId: event.source_event_id,
        error,
      },
      "could not map a pulled item to a usage record; the audit row landed but this item has no price",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "ingestionPuller");
      scope.setExtra?.("ingestionSourceId", source.id);
      captureException(toError(error));
    });
    return;
  }

  // Not a usage item — an ordinary audit event, and there was never a cost.
  if (!record) return;

  await pulledUsage.recordPulledUsage({
    ...record,
    tenantId: govProjectId,
    occurredAt: record.occurredAtMs,
  });
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
 * org — same key the trace-fold subscriber and OCSF export service use.
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
