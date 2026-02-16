import Stripe from "stripe";
import { env } from "../../src/env.mjs";

export const createStripeClient = () => {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required for SaaS billing runtime");
  }

  return new Stripe(secretKey, {
    apiVersion: "2024-04-10",
  });
};
