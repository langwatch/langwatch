import type { WebhookDeliveryInput, WebhookDeliveryRow } from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";

export abstract class WebhookDeliveryRepository {
  abstract create(input: WebhookDeliveryInput): Promise<void>;
  abstract findAllRecentByTriggerId(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]>;
  abstract pruneExpired(now?: Instant): Promise<number>;
}
