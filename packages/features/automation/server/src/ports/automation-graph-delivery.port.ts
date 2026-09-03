import type { WebhookDeliveryInput } from "@langwatch/automation-contract";

/**
 * Automation-owned persistence operations used by the host's graph delivery
 * adapter. Keeping this nominal boundary prevents composition from reaching
 * into the process service while it is being constructed.
 */
export abstract class AutomationGraphDeliveryPort {
  abstract filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
  abstract isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void>;
}
