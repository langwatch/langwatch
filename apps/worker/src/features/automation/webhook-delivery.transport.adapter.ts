import type { WebhookDeliveryTransport, WebhookSendResult } from "@langwatch/automation-server";
import {
  assertWebhookDelivered,
  WebhookEgressService,
  type WebhookSendResult as EgressSendResult,
} from "@langwatch/egress";

/**
 * How customer-supplied webhooks are reached from this process. Composes the
 * egress fence with strict address policy (allowInsecureLocal never passed).
 */
export class WorkerWebhookDeliveryTransportAdapter implements WebhookDeliveryTransport {
  static create(egress: WebhookEgressService): WorkerWebhookDeliveryTransportAdapter {
    return new WorkerWebhookDeliveryTransportAdapter(egress);
  }

  private constructor(private readonly egress: WebhookEgressService) {}

  async send(input: {
    url: string;
    method?: "POST" | "PUT" | "PATCH";
    headers?: Record<string, string>;
    signingSecrets?: readonly string[];
    body: string;
    triggerName: string;
    projectId: string;
    eventId: string;
  }): Promise<WebhookSendResult> {
    const result: EgressSendResult = await this.egress.send(input);
    return result;
  }

  assertDelivered(input: { result: WebhookSendResult; triggerName: string }): void {
    assertWebhookDelivered(input);
  }
}
