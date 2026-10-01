import type { WebhookApi, WebhookSendRequestResult } from "@langwatch/webhook-contract";

/** The webhook module's one-attempt operation; this module's outbox retries it (ADR-167). */
export type WebhookDeliveryTransport = Pick<WebhookApi, "sendRequest">;

export interface WebhookDeliveryRequest {
  projectId: string;
  triggerId: string;
  eventId: string;
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  signingSecrets?: readonly string[];
  body: string;
  triggerName: string;
}

/** A webhook action's attempt, handed to the webhook module to fence, sign, send and log. */
export class HttpWebhookDeliveryChannel {
  private constructor(private readonly transport: WebhookDeliveryTransport) {}

  static create(transport: WebhookDeliveryTransport): HttpWebhookDeliveryChannel {
    return new HttpWebhookDeliveryChannel(transport);
  }

  deliver(request: WebhookDeliveryRequest): Promise<WebhookSendRequestResult> {
    return this.transport.sendRequest({
      projectId: request.projectId,
      url: request.url,
      method: request.method,
      headers: request.headers,
      signingSecrets: request.signingSecrets,
      body: request.body,
      dispatchId: request.eventId,
      label: `Webhook for trigger "${request.triggerName}"`,
      source: { module: "automation", ref: request.triggerId },
    });
  }
}
