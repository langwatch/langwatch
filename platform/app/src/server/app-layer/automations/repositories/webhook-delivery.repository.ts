import type { WebhookDeliveryOutcome } from "@prisma/client";

/**
 * Read + write repository over `WebhookDelivery` — the per-attempt delivery
 * log behind a webhook automation's "recent fires" drill-down (ADR-040 §6).
 * A slim facts table: outcome, status, latency, capped error message, plus a
 * truncated failure response for debugging (industry-baseline plaintext,
 * GitHub/Stripe style). Our request content is never stored; the response
 * dies with the row in the 30-day prune.
 */

/** The debugging context a failed attempt keeps — the receiver's truncated
 *  response, stored exactly as the endpoint sent it (ADR-040 §6). */
export interface WebhookFailureResponse {
  body?: string;
  headers?: Record<string, string>;
  retryAfterMs?: number;
}

/** One persisted delivery attempt, as shown in the drawer's attempts list. */
export interface WebhookDeliveryRow {
  id: string;
  triggerId: string;
  /** Groups every attempt of one logical fire (== X-LangWatch-Event-Id). */
  dispatchId: string;
  responseStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  response: WebhookFailureResponse | null;
  outcome: WebhookDeliveryOutcome;
  firedAt: Date;
}

/** The fields a writer supplies for one attempt (ids + timestamps are set by
 *  the store). */
export interface WebhookDeliveryInput {
  projectId: string;
  triggerId: string;
  dispatchId: string;
  responseStatus?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  response?: WebhookFailureResponse | null;
  outcome: WebhookDeliveryOutcome;
}

export interface WebhookDeliveryRepository {
  create(input: WebhookDeliveryInput): Promise<void>;

  /** Latest attempts for one trigger, newest first, capped at `limit`. */
  findAllRecentByTriggerId(params: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]>;

  /** Delete rows older than `before`; returns how many were removed (the
   *  30-day prune, ADR-040 §6). */
  deleteOlderThan(params: { before: Date }): Promise<number>;
}
