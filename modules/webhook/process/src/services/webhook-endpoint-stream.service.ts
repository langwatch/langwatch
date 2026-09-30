// SPDX-License-Identifier: Apache-2.0

import {
  captureTraceCarrier,
  DIAGNOSTIC_SAFE,
  DispatchError,
  type ProcessRef,
  type ProcessStore,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { WebhookEndpointView } from "@langwatch/webhook-contract";

import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type EndpointStreamState,
  type SendBatchPayload,
} from "../rules/webhook-delivery-contract.rules.ts";
import {
  WebhookBatchPlannerService,
  type PendingEnvelope,
} from "./webhook-batch-planner.service.ts";

const logger = createLogger("langwatch:webhooks:endpoint-stream");

/**
 * What the endpoint stream needs, and nothing the delivery process manager
 * carries beside it: the durable store the buffer and outbox commit
 * through, and an overridable clock for tests. Reachable from any process
 * that holds a `processStore` — the worker's delivery process manager and
 * the api's `WebhookApp` both compose over this same service, so a replay
 * append never needs the process manager's dispatch/plan/prune graph.
 */
export interface WebhookEndpointStreamDeps {
  processStore: ProcessStore;
  now?: () => number;
}

/**
 * The coalescing core shared by the delivery process's deliver/flush
 * executors and a direct replay append: appends an envelope (when given) to
 * the endpoint's buffered stream, then ships as many full-or-due batches as
 * the in-flight cap allows, in one atomic commit of buffer state + outbox
 * messages.
 *
 * Endpoint streams key at ORGANIZATION scope, matching what an endpoint is:
 * one buffer and one in-flight budget per endpoint, fed by every project in
 * the org.
 *
 * Redelivery safety: deliver appends carry an inbox sourceEventId (the
 * store absorbs duplicates), each flush reads and writes under the stream's
 * lock, and the batch message key is a content hash, so any retry re-derives
 * the same key and the outbox suppresses it.
 */
export class WebhookEndpointStreamService {
  private constructor(private readonly deps: WebhookEndpointStreamDeps) {}

  static create(deps: WebhookEndpointStreamDeps): WebhookEndpointStreamService {
    return new WebhookEndpointStreamService(deps);
  }

  async flush({
    organizationId,
    endpoint,
    append,
    appendSalt,
    sourceEventId,
  }: {
    organizationId: string;
    endpoint: WebhookEndpointView;
    append?: SendBatchPayload["envelopes"][number];
    appendSalt?: string;
    sourceEventId?: string;
  }): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    const ref = this.streamRef({ organizationId, endpointId: endpoint.id });
    // Read outside the stream's lock on purpose: holding it across this query would queue every
    // append in the org behind it, and a racing count is what max_in_flight always was.
    const outstanding = await this.deps.processStore.countPendingMessages({
      ref,
      intentType: "sendBatch",
    });
    const traceCarrier = captureTraceCarrier();
    const planner = WebhookBatchPlannerService.create({ endpoint });

    try {
      // Every gateway request in the org appends here, and appends have no order to preserve,
      // so the buffer is read INSIDE the store's lock: a racing append never fails for racing.
      await this.deps.processStore.transact<EndpointStreamState>({
        ref,
        tenantId: organizationId,
        sourceEventId: sourceEventId ?? null,
        now,
        apply: (current) => {
          const pending: PendingEnvelope[] = current?.state.pending
            ? [...current.state.pending]
            : [];
          if (append) {
            pending.push({ envelope: append, appendedAtMs: now, ...(appendSalt ? { salt: appendSalt } : {}) });
          }
          const { messages, remaining, inFlight } = planner.plan({
            organizationId,
            pending,
            outstanding: outstanding.count,
            now,
            traceCarrier,
          });
          return {
            state: { pending: remaining },
            nextWakeAt: planner.findNextWakeAt({
              remaining,
              inFlight,
              outstandingDueAt: outstanding.nextAttemptAt,
              now,
            }),
            messages,
          };
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "DispatchError" || Reflect.get(error, DIAGNOSTIC_SAFE) === true)
      ) {
        throw error;
      }
      // A foreign message is redacted at every telemetry surface, so name the failure here
      // with ids we already log and the error's class, never its text.
      throw new DispatchError({
        message: `webhook stream flush failed on endpoint ${endpoint.id}: ${failureClassOf(error)}`,
        retryable: true,
      });
    }
  }

  /**
   * Re-enabling an endpoint revives the batches that parked as dead while it was paused, with a
   * fresh attempt budget; pending ones flow on their next attempt.
   */
  async requeueParked({
    organizationId,
    endpointId,
  }: {
    organizationId: string;
    endpointId: string;
  }): Promise<number> {
    const revived = await this.deps.processStore.requeueDeadMessages({
      ...this.streamRef({ organizationId, endpointId }),
      messageKeyPrefix: "send:",
      now: (this.deps.now ?? Date.now)(),
    });
    if (revived > 0) {
      logger.info({ endpointId, revived }, "webhook endpoint re-enabled; parked batches requeued");
    }
    return revived;
  }

  /**
   * Replay one already-emitted envelope to one endpoint's stream. Rides the
   * exact live-delivery machinery (buffering, coalescing, the ladder, the
   * delivery log), so a replayed delivery is operationally indistinguishable
   * from the original: same envelope, same id (the consumer's dedup key,
   * unchanged on purpose). The replayId salts the batch identity and the
   * inbox source id so re-delivering recently-delivered envelopes cannot
   * collide with their historical batches and silently no-op.
   */
  async appendReplay({
    organizationId,
    endpoint,
    envelope,
    replayId,
  }: {
    organizationId: string;
    endpoint: WebhookEndpointView;
    envelope: SendBatchPayload["envelopes"][number];
    replayId: string;
  }): Promise<void> {
    await this.flush({
      organizationId,
      endpoint,
      append: envelope,
      appendSalt: replayId,
      sourceEventId: `replay:${replayId}:${endpoint.id}:${envelope.id}`,
    });
  }

  /**
   * Endpoints belong to the ORGANIZATION, so the stream does too: one row per endpoint holds one
   * buffer, one outstanding-send count and one max_in_flight, however many projects feed it.
   */
  private streamRef({
    organizationId,
    endpointId,
  }: {
    organizationId: string;
    endpointId: string;
  }): ProcessRef {
    return {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: organizationId,
      processKey: `endpoint:${endpointId}`,
    };
  }
}

/** A foreign failure's class, safe to quote: its name plus a machine code (Prisma P-code, errno). */
function failureClassOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "non-error";
  const name = error instanceof Error ? error.name : "non-error";
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? `${name} (${code})` : name;
}
