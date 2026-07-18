import type { WebhookDeliveryOutcome } from "@prisma/client";

/**
 * Read + write repository over `WebhookDelivery` — the per-attempt delivery
 * log behind a webhook automation's "recent fires" drill-down (ADR-040 §6).
 * A slim facts table: outcome, status, latency, capped error message and a
 * failure classification. Request/response content is never stored.
 */

/** Failure classification driving operator guidance in the drawer. Stored as
 *  a plain string so new kinds ship without migrations. */
export type WebhookFailureKind =
  | "blocked_url"
  | "timeout"
  | "network"
  | "rate_limited"
  | "client_error"
  | "server_error";

/** One persisted delivery attempt, as shown in the drawer's attempts list. */
export interface WebhookDeliveryRow {
  id: string;
  triggerId: string;
  /** Groups every attempt of one logical fire (== X-LangWatch-Event-Id). */
  dispatchId: string;
  responseStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  failureKind: WebhookFailureKind | null;
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
  failureKind?: WebhookFailureKind | null;
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
