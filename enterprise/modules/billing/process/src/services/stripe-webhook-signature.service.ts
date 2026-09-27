import Stripe from "stripe";

/**
 * The deployment's Stripe webhook signing secret, as the one thing that can
 * verify a delivery: the secret stays here, only the verified event leaves.
 */
export class StripeWebhookSignatureService {
  private constructor(private readonly secret: string | undefined) {}

  static create(secret: string | undefined): StripeWebhookSignatureService {
    return new StripeWebhookSignatureService(secret?.trim() || void 0);
  }

  isConfigured(): boolean {
    return this.secret !== void 0;
  }

  /** Throws when the payload or the signature is wrong, or no secret is configured. */
  constructEvent({ rawBody, signature }: { rawBody: Uint8Array; signature: string }): Stripe.Event {
    if (!this.secret) throw new Error("No Stripe webhook signing secret is configured");
    return Stripe.webhooks.constructEvent(Buffer.from(rawBody), signature, this.secret);
  }
}
