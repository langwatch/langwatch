import type { WebhookDeliveryTransport, WebhookSendResult } from "@langwatch/automation-server";
import {
  assertWebhookDelivered,
  WebhookEgressService,
  type WebhookSendResult as EgressSendResult,
} from "@langwatch/egress";

/**
 * How a customer-supplied webhook destination is reached from this process.
 *
 * `WebhookDeliveryTransport` is the two things `WebhookDeliveryAdapter` in
 * `@langwatch/automation-server` needs out of an outbound sender: put the bytes
 * on the wire, and say whether the receiver's answer was a success, a retry or a
 * dead letter. Automation decides WHEN to send and WHAT to send; everything
 * about how the request leaves the building belongs to the egress fence, which
 * is why that half is a package rather than an automation asset.
 *
 * Twin of `platform/app/src/runtime/app/features/automation-adapters/delivery/
 * deliverWebhook.ts`, which composes the application's own copy of the same
 * sender against the same port. Both stay while both graphs send: an envelope
 * shaped one way here and another way there is one automation delivering two
 * different requests depending on which process fired.
 *
 * Nothing is relaxed here. `allowInsecureLocal` is never passed, so this
 * transport is always on the strict address policy — the same choice the
 * application's automations channel makes, and the reason a customer's
 * `https://10.0.0.5/hook` is refused from either process.
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
