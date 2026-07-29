// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { PlanInfo } from "../../licensing/planInfo";
import {
  defineProcessManager,
  type IntentSpec,
  type ProcessManagerDefinition,
  type WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type {
  NewOutboxMessage,
  ProcessStore,
} from "~/server/event-sourcing/process-manager/stores/processStore.types";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  assertWebhookDelivered,
  sendWebhook,
} from "~/server/app-layer/automations/delivery/sendWebhook";
import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";
import { spendRowToEnvelope, type WebhookEnvelope } from "../envelope";
import { eventMatches } from "../eventRegistry";
import type { WebhookEventsClickHouseRepository } from "../webhookEvents.clickhouse.repository";
import type {
  WebhookEndpointService,
  WebhookEndpointView,
} from "../webhookEndpoint.service";

const logger = createLogger("langwatch:webhooks:delivery-process");

export const WEBHOOK_DELIVERY_PROCESS_NAME = "webhookDelivery" as const;

/** Scan cadence: how fresh the push is. Billing tolerates seconds. */
export const WEBHOOK_SCAN_INTERVAL_MS = 15_000;
/** Envelopes per POST, the contract's batch cap. */
export const WEBHOOK_BATCH_MAX_EVENTS = 100;
/** Spend rows examined per project per scan; the next scan continues. */
export const WEBHOOK_SCAN_ROW_LIMIT = 500;
/**
 * Cursor floor: a project whose scan fell further behind than this resumes
 * here and the skipped window is served by replay, never silently.
 */
export const WEBHOOK_SCAN_LOOKBACK_MS = 72 * 60 * 60 * 1000;
/**
 * First cursor for a project never scanned before: a small overlap rather
 * than deep history, Stripe's endpoints-receive-from-creation semantics.
 * Backfill is the replay surface's job.
 */
export const WEBHOOK_NEW_CURSOR_OVERLAP_MS = 5 * 60 * 1000;
/** Dispatched scan/send outbox rows older than this are pruned. */
const OUTBOX_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The Stripe-shaped retry ladder. `attempt` is the 1-based attempt that
 * just failed: the delay to the next one. After the sixth failure the
 * cadence holds at 12h; 11 attempts keep the last retry inside 72h of the
 * first failure (1m + 5m + 30m + 2h + 6h + 12h + 4 * 12h = 68h36m).
 */
export const WEBHOOK_RETRY_LADDER_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
];
export const WEBHOOK_SEND_MAX_ATTEMPTS = 11;

export function webhookRetryDelayMs({ attempt }: { attempt: number }): number {
  return (
    WEBHOOK_RETRY_LADDER_MS[attempt - 1] ??
    WEBHOOK_RETRY_LADDER_MS[WEBHOOK_RETRY_LADDER_MS.length - 1]!
  );
}

export const scanSchema = z.object({ scheduledFor: z.number().int() });

export const sendBatchSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  endpointId: z.string(),
  /** Stable batch identity: the X-LangWatch-Event-Id across every retry. */
  batchId: z.string(),
  envelopes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      created: z.string(),
      schema_version: z.literal("1"),
      data: z.record(z.unknown()),
    }),
  ),
});
export type SendBatchPayload = z.infer<typeof sendBatchSchema>;

export interface WebhookDeliverySingletonState {
  lastScanAt: number | null;
  lastDeliveryPruneAt: number | null;
}

/** Per-project scan cursor, committed by the scan through the ProcessStore. */
export interface WebhookProjectCursorState {
  cursorEventTsMs: number;
}

type DeliveryIntents = {
  scan: IntentSpec<typeof scanSchema>;
  sendBatch: IntentSpec<typeof sendBatchSchema>;
};

/**
 * Singleton wake: emit one scan slot. The scan itself is I/O and lives in
 * the intent executor; a failed scan's retries are superseded by the next
 * slot, so losing one is losing freshness, never data.
 */
export const webhookDeliveryWake: WakeHandler<
  WebhookDeliverySingletonState,
  DeliveryIntents
> = (state, ctx) => ({
  state: { ...state, lastScanAt: ctx.at },
  intents: [ctx.intents.scan(`scan:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface WebhookDeliveryProcessDeps {
  prisma: PrismaClient;
  processStore: ProcessStore;
  eventsRepository: WebhookEventsClickHouseRepository;
  endpoints: WebhookEndpointService;
  /** Resolves the org's active plan for the enterprise gate. */
  getPlan: (organizationId: string) => Promise<PlanInfo>;
  now?: () => number;
}

function batchHash(ids: readonly string[]): string {
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

/**
 * One scan slot: for every org with ACTIVE matching endpoints (and the
 * plan flag), walk each project's spend log from its cursor, first-sight
 * filter against the delivered-marker table, freeze the fresh rows into
 * per-endpoint batches, and commit them onto the delivery outbox together
 * with the advanced cursor. The commit is the atomic boundary: markers are
 * written after it, so a crash in between re-derives the same batch next
 * scan and the deterministic message key suppresses the duplicate.
 */
export function runWebhookScan(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: z.output<typeof scanSchema>,
    _context: IntentContext,
  ): Promise<void> => {
    const now = (deps.now ?? Date.now)();
    const organizationIds =
      await deps.endpoints.organizationIdsWithActiveEndpoints();

    for (const organizationId of organizationIds) {
      try {
        await scanOrganization({ deps, organizationId, now });
      } catch (error) {
        logger.error(
          { organizationId, error },
          "webhook delivery scan failed for organization; next slot retries",
        );
      }
    }

    // Self-retention (ADR-052): recurring scan intents and yesterday's
    // dispatched batches; dead rows are never touched.
    try {
      await deps.processStore.deleteDispatchedBefore({
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        before: now - OUTBOX_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn({ error }, "webhook delivery outbox retention failed");
    }
    // Delivery-log prune rides the scan hourly rather than a second
    // scheduled process; the hour guard keeps it one deletion an hour.
    const hourOf = (ms: number) => Math.floor(ms / (60 * 60 * 1000));
    if (hourOf(payload.scheduledFor) !== hourOf(payload.scheduledFor - WEBHOOK_SCAN_INTERVAL_MS)) {
      try {
        await deps.endpoints.pruneDeliveries(new Date(now));
      } catch (error) {
        logger.warn({ error }, "webhook delivery-log prune failed");
      }
    }
  };
}

async function scanOrganization({
  deps,
  organizationId,
  now,
}: {
  deps: WebhookDeliveryProcessDeps;
  organizationId: string;
  now: number;
}): Promise<void> {
  const plan = await deps.getPlan(organizationId);
  if (plan.webhookEndpoints !== true) return;

  const endpoints = (
    await deps.endpoints.listActiveByOrganization({ organizationId })
  ).filter((e) => eventMatches(e.enabledEvents, "gateway.request.completed"));
  if (endpoints.length === 0) return;

  const projects = await deps.prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });

  for (const project of projects) {
    await scanProject({
      deps,
      organizationId,
      projectId: project.id,
      endpoints,
      now,
    });
  }
}

async function scanProject({
  deps,
  organizationId,
  projectId,
  endpoints,
  now,
}: {
  deps: WebhookDeliveryProcessDeps;
  organizationId: string;
  projectId: string;
  endpoints: WebhookEndpointView[];
  now: number;
}): Promise<void> {
  const ref = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId,
    processKey: projectId,
  };
  const existing =
    await deps.processStore.findByRef<WebhookProjectCursorState>({ ref });
  const rawCursor =
    existing?.state.cursorEventTsMs ?? now - WEBHOOK_NEW_CURSOR_OVERLAP_MS;
  const cursor = Math.max(rawCursor, now - WEBHOOK_SCAN_LOOKBACK_MS);
  if (cursor > rawCursor && existing) {
    logger.warn(
      { projectId, skippedMs: cursor - rawCursor },
      "webhook delivery cursor clamped to the lookback window; the gap needs a replay",
    );
  }

  const rows = await deps.eventsRepository.readSpendEventsSince({
    tenantId: projectId,
    sinceEventTsMs: cursor,
    limit: WEBHOOK_SCAN_ROW_LIMIT,
  });
  if (rows.length === 0) return;

  const maxTs = rows[rows.length - 1]!.eventTimestampMs;
  const seen = await deps.eventsRepository.probeDelivered({
    tenantId: projectId,
    requestIds: rows.map((r) => r.row.gatewayRequestId),
  });
  const fresh = rows.filter((r) => !seen.has(r.row.gatewayRequestId));

  // Nothing new to emit: advance the cursor alone, dampened so an idle
  // project is not a commit per scan.
  if (fresh.length === 0) {
    if (maxTs > cursor + 60_000 || rows.length === WEBHOOK_SCAN_ROW_LIMIT) {
      await commitScan({ deps, ref, existing, maxTs, messages: [], now });
    }
    return;
  }

  const freshRows: SpendEventRow[] = fresh.map((r) => r.row);
  const envelopes = freshRows.map(spendRowToEnvelope);
  const chunks = chunk(envelopes, WEBHOOK_BATCH_MAX_EVENTS);

  const messages = endpoints.flatMap((endpoint) =>
    chunks.map((batch) => {
      const batchId = `${endpoint.id}:${batchHash(batch.map((e) => e.id))}`;
      const payload: SendBatchPayload = {
        organizationId,
        projectId,
        endpointId: endpoint.id,
        batchId,
        envelopes: batch as SendBatchPayload["envelopes"],
      };
      return {
        messageKey: `send:${batchId}`,
        intentType: "sendBatch",
        // Envelope data is JSON by construction (spendRowToEnvelope emits
        // only JSON primitives); the cast crosses the JsonValue boundary.
        payload: payload as unknown as JsonValue,
        traceCarrier: {},
      };
    }),
  );

  const outcome = await commitScan({
    deps,
    ref,
    existing,
    maxTs,
    messages,
    now,
  });
  if (outcome !== "committed") return;

  // The commit above is the atomic boundary: batches and cursor land
  // together, so the events are enqueued no matter what happens next. The
  // markers only guard future re-emission, so their write is retried here
  // rather than failing the (already-committed) scan.
  const markers = freshRows.map((row) => ({
    tenantId: projectId,
    gatewayRequestId: row.gatewayRequestId,
    eventType: "gateway.request.completed",
    batchId: `scan:${now}`,
  }));
  let lastMarkerError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await deps.eventsRepository.markEnqueued(markers);
      lastMarkerError = undefined;
      break;
    } catch (error) {
      lastMarkerError = error;
    }
  }
  if (lastMarkerError !== undefined) {
    logger.error(
      { projectId, count: markers.length, error: lastMarkerError },
      "webhook first-sight markers failed after the batch commit; a future restatement of these ids could re-emit",
    );
  }
}

async function commitScan({
  deps,
  ref,
  existing,
  maxTs,
  messages,
  now,
}: {
  deps: WebhookDeliveryProcessDeps;
  ref: { processName: string; projectId: string; processKey: string };
  existing: { revision: number } | null;
  maxTs: number;
  messages: NewOutboxMessage[];
  now: number;
}): Promise<"committed" | "skipped"> {
  const result = await deps.processStore.commit<WebhookProjectCursorState>({
    ref,
    tenantId: ref.projectId,
    sourceEventId: null,
    expectedRevision: existing?.revision ?? 0,
    state: { cursorEventTsMs: maxTs },
    nextWakeAt: null,
    messages,
    now,
  });
  if (result.outcome === "committed") {
    if (result.duplicateMessageKeys.length > 0) {
      logger.info(
        { projectId: ref.projectId, duplicates: result.duplicateMessageKeys.length },
        "webhook scan re-derived already-enqueued batches; duplicates suppressed",
      );
    }
    return "committed";
  }
  // A concurrent scan slot won the revision race; its view supersedes ours.
  logger.info(
    { projectId: ref.projectId, outcome: result.outcome },
    "webhook scan commit superseded by a concurrent slot",
  );
  return "skipped";
}

/**
 * The registered process manager: a scheduled singleton whose wake emits
 * scan slots, plus the sendBatch intents the scan commits directly through
 * the ProcessStore under this same process name (per-project cursor
 * instances). The outbox config IS the delivery contract's retry ladder.
 */
export function createWebhookDeliveryProcessManager(
  deps: WebhookDeliveryProcessDeps,
): ProcessManagerDefinition<
  WebhookDeliverySingletonState,
  DeliveryIntents
> {
  return defineProcessManager({
    name: WEBHOOK_DELIVERY_PROCESS_NAME,
    state: {
      lastScanAt: null,
      lastDeliveryPruneAt: null,
    } as WebhookDeliverySingletonState,
    eventTypes: [],
    handlers: {},
    schedule: { everyMs: WEBHOOK_SCAN_INTERVAL_MS },
    onWake: webhookDeliveryWake,
    intents: {
      scan: { schema: scanSchema, run: runWebhookScan(deps) },
      sendBatch: { schema: sendBatchSchema, run: runWebhookSendBatch(deps) },
    },
    outbox: {
      maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
      retryDelayMs: webhookRetryDelayMs,
      // Sends are slow (a receiver can burn the full 10s timeout) and
      // parallel-safe: batches are independent, and Stripe-style receivers
      // must tolerate concurrent deliveries. Bound the leased batch to the
      // in-flight count so waiting messages are not invisible for a lease.
      concurrency: 4,
      batchSize: 8,
      leaseDurationMs: 120_000,
    },
  });
}

/**
 * Deliver one frozen batch to one endpoint through the SSRF-fenced signed
 * sender, record the receiver's answer, and classify: 2xx acks, 5xx/429/408
 * retry along the ladder (Retry-After honored as a floor), other statuses
 * retire the batch to the dead letter immediately. The endpoint's failure
 * streak and the 72h auto-disable ride every recorded outcome.
 */
export function runWebhookSendBatch(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: SendBatchPayload,
    context: IntentContext,
  ): Promise<void> => {
    const endpoint = await deps.prisma.webhookEndpoint.findFirst({
      where: {
        id: payload.endpointId,
        organizationId: payload.organizationId,
      },
    });
    // A deleted or disabled endpoint drains its queue without POSTing:
    // source tables keep the events, re-enable plus replay covers the gap.
    if (!endpoint || endpoint.status !== "ACTIVE" || endpoint.archivedAt) {
      logger.info(
        { endpointId: payload.endpointId, batchId: payload.batchId },
        "webhook batch dropped: endpoint disabled or gone (replay covers the gap)",
      );
      return;
    }

    const secret = await deps.endpoints.getSigningSecret({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
    });
    const body = JSON.stringify({
      batch: payload.envelopes satisfies WebhookEnvelope[],
    });
    const startedAt = (deps.now ?? Date.now)();

    let status: number | undefined;
    let responseBody = "";
    let retryAfterMs: number | undefined;
    try {
      const result = await sendWebhook({
        url: endpoint.url,
        body,
        triggerName: payload.endpointId,
        contextLabel: `Webhook endpoint ${payload.endpointId}`,
        projectId: payload.projectId,
        eventId: payload.batchId,
        signingSecret: secret,
        attempt: context.attempt,
      });
      status = result.status;
      responseBody = result.body;
      retryAfterMs = result.retryAfterMs;
    } catch (error) {
      // Transport-level failure (DNS, SSRF block, timeout): no receiver
      // status to store. DispatchError carries the retryable classification
      // the dispatcher acts on.
      const retryable =
        typeof error === "object" && error !== null
          ? Reflect.get(error, "retryable") !== false
          : true;
      await deps.endpoints.recordDeliveryAttempt({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
        dispatchId: payload.batchId,
        attempt: context.attempt,
        eventCount: payload.envelopes.length,
        outcome: retryable ? "retryable" : "terminal",
        latencyMs: (deps.now ?? Date.now)() - startedAt,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      });
      throw error;
    }

    const latencyMs = (deps.now ?? Date.now)() - startedAt;
    if (status >= 200 && status < 300) {
      await deps.endpoints.recordDeliveryAttempt({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
        dispatchId: payload.batchId,
        attempt: context.attempt,
        eventCount: payload.envelopes.length,
        outcome: "success",
        responseStatus: status,
        latencyMs,
      });
      return;
    }

    const retryable = status >= 500 || status === 429 || status === 408;
    await deps.endpoints.recordDeliveryAttempt({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
      dispatchId: payload.batchId,
      attempt: context.attempt,
      eventCount: payload.envelopes.length,
      outcome: retryable ? "retryable" : "terminal",
      responseStatus: status,
      latencyMs,
      error: `HTTP ${status}`,
      response: {
        body: responseBody.slice(0, 1000),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      },
    });
    // Throws DispatchError with the same classification just recorded; the
    // dispatcher ladders retryables and dead-letters terminals immediately.
    assertWebhookDelivered({
      result: { status, body: responseBody, retryAfterMs },
      triggerName: payload.endpointId,
    });
  };
}
