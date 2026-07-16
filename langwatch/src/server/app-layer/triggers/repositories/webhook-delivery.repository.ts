import type { WebhookDeliveryOutcome } from "@prisma/client";

/**
 * Read + write repository over `WebhookDelivery` — the per-attempt delivery
 * log behind a webhook automation's "recent fires" drill-down (ADR-040 §6).
 * Header values are already REDACTED by the writer; this layer stores and
 * returns them as-is.
 */

/** One persisted delivery attempt, as shown in the drawer's attempts list. */
export interface WebhookDeliveryRow {
  id: string;
  triggerId: string;
  /** Groups every attempt of one logical fire (== X-LangWatch-Event-Id). */
  dispatchId: string;
  requestMethod: string;
  requestUrl: string;
  /** Redacted header record (auth/signature values already masked). */
  requestHeaders: Record<string, string>;
  responseStatus: number | null;
  responseBody: string | null;
  latencyMs: number | null;
  error: string | null;
  outcome: WebhookDeliveryOutcome;
  firedAt: Date;
}

/** The fields a writer supplies for one attempt (ids + timestamps are set by
 *  the store). */
export interface WebhookDeliveryInput {
  projectId: string;
  triggerId: string;
  dispatchId: string;
  requestMethod: string;
  requestUrl: string;
  requestHeaders: Record<string, string>;
  responseStatus?: number | null;
  responseBody?: string | null;
  latencyMs?: number | null;
  error?: string | null;
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

  /** Delete rows older than `before` within the given projects; returns how
   *  many were removed (the projectId-scoped 30-day prune, ADR-040 §6).
   *  `projectId` is the first predicate — no unscoped deletion on a
   *  project-level model. */
  deleteOlderThan(params: {
    projectIds: string[];
    before: Date;
  }): Promise<number>;
}
