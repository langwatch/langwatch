import { assertWebhookDelivered, type WebhookEgressService } from "@langwatch/egress";

import type {
  WebhookDeliveryTransport,
  WebhookSendResult,
} from "./http.webhook-delivery.channel.ts";

/** Customer webhooks, reached through the SSRF-fenced egress sender with strict address policy. */
export class EgressWebhookDeliveryTransport implements WebhookDeliveryTransport {
  static create(egress: WebhookEgressService): EgressWebhookDeliveryTransport {
    return new EgressWebhookDeliveryTransport(egress);
  }

  private constructor(private readonly egress: WebhookEgressService) {}

  send(input: Parameters<WebhookDeliveryTransport["send"]>[0]): Promise<WebhookSendResult> {
    return this.egress.send(input);
  }

  assertDelivered(input: { result: WebhookSendResult; triggerName: string }): void {
    assertWebhookDelivered(input);
  }
}
