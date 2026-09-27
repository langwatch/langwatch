/**
 * One Stripe delivery, received: refused unless this deployment dispatches
 * provider events and the signature verifies over the raw bytes.
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { BadRequestError, InternalServerError, NotFoundError } from "@langwatch/api/rest";
import type { HandleEventResult } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";

const logger = createLogger("langwatch:billing:stripe-webhook");

/** What receiving a delivery asks of the deployment's Stripe composition. */
export interface StripeWebhookEvents {
  /** False where the deployment does no billing: the delivery then answers 404. */
  dispatchesEvents(): boolean;
  /** The signing secret, read per request so a rotation without a restart works. */
  findSigningSecret(): string | undefined;
  /** Verifies the signature over the raw bytes; throwing means payload or signature is wrong. */
  constructEvent(input: { rawBody: Uint8Array; signature: string }): Stripe.Event;
  handleEvent(event: Stripe.Event): Promise<HandleEventResult>;
}

export class StripeWebhookReceiptService {
  private constructor(private readonly events: StripeWebhookEvents) {}

  static create(events: StripeWebhookEvents): StripeWebhookReceiptService {
    return new StripeWebhookReceiptService(events);
  }

  async receiveStripeWebhook({
    rawBody,
    signature,
  }: {
    rawBody: Uint8Array;
    signature: string | undefined;
  }): Promise<{ received: true }> {
    if (!this.events.dispatchesEvents()) {
      throw new NotFoundError("Billing webhooks are not enabled");
    }

    const secret = this.events.findSigningSecret();
    if (!signature || !secret) {
      logger.error(
        { signature: !!signature, secret: !!secret },
        "[stripeWebhook] Missing signature or secret",
      );
      throw new BadRequestError("Webhook Error: Missing signature or secret");
    }

    const event = this.verifiedEvent({ rawBody, signature });
    const result = await this.events.handleEvent(event);
    if (result.status === "error") {
      if (result.httpStatus === 400) throw new BadRequestError(result.message);
      throw new InternalServerError(result.message);
    }

    return { received: true };
  }

  /** A bad payload and a bad signature answer alike; the log tells them apart. */
  private verifiedEvent({
    rawBody,
    signature,
  }: {
    rawBody: Uint8Array;
    signature: string;
  }): Stripe.Event {
    try {
      return this.events.constructEvent({ rawBody, signature });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "[stripeWebhook] Failed to construct event",
      );
      throw new BadRequestError("Webhook Error: Invalid payload or signature");
    }
  }
}
