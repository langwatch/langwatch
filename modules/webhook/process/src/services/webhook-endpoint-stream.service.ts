// SPDX-License-Identifier: Apache-2.0

import type { ProcessStore } from "@langwatch/eventing";
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
 * store absorbs duplicates), flushes are revision-guarded, and the batch
 * message key is a content hash, so any retry re-derives the same key and
 * the outbox suppresses it.
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
    // Endpoints belong to the ORGANIZATION, so the stream does too: one row
    // per endpoint holds one buffer, one outstanding-send count, and
    // therefore one max_in_flight, no matter how many of the org's projects
    // feed it. Keying by project would give an endpoint N of each.
    const ref = {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: organizationId,
      processKey: `endpoint:${endpoint.id}`,
    };
    const existing = await this.deps.processStore.findByRef<EndpointStreamState>({
      ref,
    });
    const pending: PendingEnvelope[] = existing?.state.pending ? [...existing.state.pending] : [];
    if (append) {
      const item: PendingEnvelope = { envelope: append, appendedAtMs: now };
      if (appendSalt) {
        item.salt = appendSalt;
      }

      pending.push(item);
    }

    const outstanding = (await this.deps.processStore.findMessagesByRef({ ref })).filter(
      (m) => m.intentType === "sendBatch" && m.status === "pending",
    ).length;

    const planner = WebhookBatchPlannerService.create({ endpoint });
    const { messages, remaining, inFlight } = planner.plan({
      organizationId,
      pending,
      outstanding,
      now,
    });

    const result = await this.deps.processStore.commit<EndpointStreamState>({
      ref,
      tenantId: organizationId,
      sourceEventId: sourceEventId ?? null,
      expectedRevision: existing?.revision ?? 0,
      state: { pending: remaining },
      nextWakeAt: planner.findNextWakeAt({ remaining, inFlight, now }),
      messages,
      now,
    });
    if (result.outcome === "revisionConflict") {
      // A concurrent append or flush won the stream's revision; retry this
      // intent so nothing is lost (idempotent by inbox id and content key).
      throw new Error(
        `webhook stream flush hit a revision conflict on endpoint ${endpoint.id}; retrying`,
      );
    }
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
}
