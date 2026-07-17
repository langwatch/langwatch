import type { PrismaClient } from "@prisma/client";
import { PrismaWebhookDeliveryRepository } from "./repositories/webhook-delivery.prisma.repository";
import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
} from "./repositories/webhook-delivery.repository";

export type { WebhookDeliveryInput, WebhookDeliveryRow };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The per-attempt webhook delivery log (ADR-040 §6). Write-side records one
 * row per HTTP attempt (headers already redacted by the caller); read-side
 * backs the drawer's "Recent deliveries" drill-down; the prune keeps the
 * table bounded at 30 days.
 */
export class WebhookDeliveryService {
  constructor(private readonly repo: WebhookDeliveryRepository) {}

  static create(prisma: PrismaClient): WebhookDeliveryService {
    return new WebhookDeliveryService(
      new PrismaWebhookDeliveryRepository(prisma),
    );
  }

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
