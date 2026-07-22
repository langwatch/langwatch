import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
} from "@langwatch/automations/repositories/webhook-delivery.repository";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The per-attempt webhook delivery log (ADR-040 §6). Write-side records one
 * row per HTTP attempt (failure responses truncated by the
 * caller); read-side backs the drawer's "Recent deliveries" drill-down; the
 * prune keeps the table bounded at 30 days.
 */
export class WebhookDeliveryService {
  constructor(private readonly repo: WebhookDeliveryRepository) {}

  /** Persist one attempt. */
  async record(input: WebhookDeliveryInput): Promise<void> {
    return this.repo.create(input);
  }

  /** Latest attempts for one trigger, newest first, capped at `limit`. */
  async getRecentByTrigger({
    projectId,
    triggerId,
    limit,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    return this.repo.findAllRecentByTriggerId({ projectId, triggerId, limit });
  }

  /** Delete attempts older than 30 days; returns how many were removed. */
  async pruneExpired(): Promise<number> {
    return this.repo.deleteOlderThan({
      before: new Date(Date.now() - THIRTY_DAYS_MS),
    });
  }
}
