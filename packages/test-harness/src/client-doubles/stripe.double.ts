import Stripe from "stripe";

import { type ClientScript, scriptedClient } from "./scripted-client.ts";

/** A Stripe SDK client that never calls Stripe, answering only what the test scripted. */
export function stripeDouble(script: ClientScript<Stripe> = {}): Stripe {
  const client = new Stripe("sk_test_stripe_double");
  return scriptedClient({ client, script, name: "stripe" });
}
