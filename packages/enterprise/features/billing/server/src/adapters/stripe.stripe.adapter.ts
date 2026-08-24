import Stripe from "stripe";

export class StripeClientAdapter {
  private constructor(readonly client: Stripe) {}

  static create(options: { secretKey: string }): StripeClientAdapter {
    if (!options.secretKey) {
      throw new Error("A Stripe secret key is required for SaaS billing runtime");
    }
    return new StripeClientAdapter(
      new Stripe(options.secretKey, { apiVersion: "2024-04-10" }),
    );
  }
}
