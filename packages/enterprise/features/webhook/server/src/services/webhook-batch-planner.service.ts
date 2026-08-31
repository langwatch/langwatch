// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";
import type { JsonValue, NewOutboxMessage } from "@langwatch/eventing";
import type { WebhookEndpointView, WebhookEnvelope } from "@langwatch/enterprise-webhook-contract";

/** How soon to look again when the in-flight cap, not the delay, is holding. */
export const WEBHOOK_FLUSH_RECHECK_MS = 500;

/** One buffered envelope, with when it arrived, which starts its delay. */
export interface PendingEnvelope {
  envelope: WebhookEnvelope;
  appendedAtMs: number;
  salt?: string;
}

/**
 * The delivery controls for one endpoint, applied to its buffered stream.
 *
 * Held as an object because every decision here reads the same endpoint's
 * limits, and one flush asks several questions of them: what ships now, what
 * stays buffered, and when to wake for the rest.
 */
export class WebhookBatchPlanner {
  static for(endpoint: WebhookEndpointView): WebhookBatchPlanner {
    return new WebhookBatchPlanner(endpoint);
  }

  private constructor(private readonly endpoint: WebhookEndpointView) {}

  /**
   * Split the stream's buffer into the batches shippable right now and what
   * stays buffered, per the adopted delivery-controls design:
   * - a batch at max_batch_size ships immediately, delay never holds a full
   *   batch back;
   * - a partial batch ships once its oldest envelope has waited
   *   max_batch_delay_ms (zero means ship on arrival);
   * - nothing ships past max_in_flight pending sends, so a slow receiver
   *   accumulates buffer instead of parallel POSTs, and because full batches
   *   ship first the batch size CLIMBS toward its cap under backpressure,
   *   draining faster exactly when the receiver is behind.
   */
  plan({
    organizationId,
    pending,
    outstanding,
    now,
  }: {
    organizationId: string;
    pending: readonly PendingEnvelope[];
    outstanding: number;
    now: number;
  }): {
    messages: NewOutboxMessage[];
    remaining: PendingEnvelope[];
    inFlight: number;
  } {
    const messages: NewOutboxMessage[] = [];
    const remaining = [...pending];
    let inFlight = outstanding;
    while (
      remaining.length > 0 &&
      inFlight < this.endpoint.maxInFlight &&
      this.shipsNow(remaining, now)
    ) {
      const batchEntries = remaining.splice(0, this.endpoint.maxBatchSize);
      const batchId = this.batchId(batchEntries);
      messages.push({
        messageKey: `send:${batchId}`,
        intentType: "sendBatch",
        // Envelope data is JSON by construction (spendRowToEnvelope emits
        // only JSON primitives); the cast crosses the JsonValue boundary.
        payload: {
          organizationId,
          endpointId: this.endpoint.id,
          batchId,
          envelopes: batchEntries.map((entry) => entry.envelope),
        } as unknown as JsonValue,
        traceCarrier: {},
      });
      inFlight++;
    }
    return { messages, remaining, inFlight };
  }

  /**
   * Anything still buffered arms a wake: the coalescing deadline when the
   * delay is holding it, a short recheck when the in-flight cap is.
   */
  nextWakeAt({
    remaining,
    inFlight,
    now,
  }: {
    remaining: readonly PendingEnvelope[];
    inFlight: number;
    now: number;
  }): number | null {
    const oldest = remaining[0];
    if (!oldest) return null;
    if (inFlight >= this.endpoint.maxInFlight) return now + WEBHOOK_FLUSH_RECHECK_MS;
    return Math.max(this.deadlineFor(oldest), now + WEBHOOK_FLUSH_RECHECK_MS);
  }

  /** A full batch, no delay configured, or the oldest envelope's wait is up. */
  private shipsNow(remaining: readonly PendingEnvelope[], now: number): boolean {
    return (
      remaining.length >= this.endpoint.maxBatchSize ||
      this.endpoint.maxBatchDelayMs === 0 ||
      this.deadlineFor(remaining[0]!) <= now
    );
  }

  /** The instant a buffered envelope stops being held by the coalescing delay. */
  private deadlineFor(entry: PendingEnvelope): number {
    return entry.appendedAtMs + this.endpoint.maxBatchDelayMs;
  }

  /**
   * Content-derived, so a retry that re-plans the same envelopes re-derives
   * the same key and the outbox suppresses the duplicate send.
   */
  private batchId(entries: readonly PendingEnvelope[]): string {
    const hash = createHash("sha256")
      .update(
        entries
          .map((entry) => (entry.salt ? `${entry.envelope.id}:${entry.salt}` : entry.envelope.id))
          .join(","),
      )
      .digest("hex")
      .slice(0, 16);
    return `${this.endpoint.id}:${hash}`;
  }
}
