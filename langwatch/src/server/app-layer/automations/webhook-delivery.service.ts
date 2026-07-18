import type { PrismaClient } from "@prisma/client";
import { decrypt } from "~/utils/encryption";
import type { WebhookFailureResponse } from "./delivery/deliverWebhook";
import { PrismaWebhookDeliveryRepository } from "./repositories/webhook-delivery.prisma.repository";
import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
} from "./repositories/webhook-delivery.repository";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** A delivery row as the drawer consumes it: the stored ciphertext is
 *  replaced by the decrypted truncated failure response. */
export type WebhookDeliveryView = Omit<
  WebhookDeliveryRow,
  "responseEncrypted"
> & {
  response: WebhookFailureResponse | null;
};

/**
 * The per-attempt webhook delivery log (ADR-040 §6). Write-side records one
 * row per HTTP attempt (failure responses encrypted by the caller);
 * read-side decrypts them for the drawer's "Recent deliveries" drill-down;
 * the prune keeps the table bounded at 30 days.
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

  /** Latest attempts for one trigger, newest first, capped at `limit`, with
   *  failure responses decrypted for display. */
  async getRecentByTrigger({
    projectId,
    triggerId,
    limit,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryView[]> {
    const rows = await this.repo.findAllRecentByTriggerId({
      projectId,
      triggerId,
      limit,
    });
    return rows.map(({ responseEncrypted, ...row }) => {
      let response: WebhookFailureResponse | null = null;
      if (responseEncrypted) {
        try {
          response = JSON.parse(
            decrypt(responseEncrypted),
          ) as WebhookFailureResponse;
        } catch {
          // Undecryptable (rotated secret, corrupt row) — the outcome facts
          // still stand; just drop the debugging context.
        }
      }
      return { ...row, response };
    });
  }

  /** Delete attempts older than 30 days; returns how many were removed. */
  async pruneExpired(): Promise<number> {
    return this.repo.deleteOlderThan({
      before: new Date(Date.now() - THIRTY_DAYS_MS),
    });
  }
}
