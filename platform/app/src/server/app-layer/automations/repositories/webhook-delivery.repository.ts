import type { WebhookDeliveryOutcome } from "~/generated/prisma/client";

/**
 * The automations channel's read + write access to the shared webhook delivery
 * log — the per-attempt table behind a webhook automation's "recent fires"
 * drill-down (ADR-040 §6). A slim facts table: outcome, status, latency, capped
 * error message, plus a truncated failure response for debugging
 * (industry-baseline plaintext, GitHub/Stripe style). Our request content is
 * never stored; the response dies with the row in the 30-day prune.
 *
 * Both webhook channels write into that one table now, discriminated by
 * `channel`; this repository only ever sees the automations rows.
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

  /** Run the shared 30-day retention sweep over the delivery log; returns how
   *  many rows were removed (ADR-040 §6). Prunes BOTH channels, because they
   *  share the table and the bound. */
  pruneExpired(now?: Date): Promise<number>;
}
