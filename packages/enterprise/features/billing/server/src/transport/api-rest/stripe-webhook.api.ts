/**
 * `POST /api/webhooks/stripe` — the billing provider's callback.
 *
 * Stripe signs every delivery, and the signature is verified HERE, over the RAW
 * bytes, before anything is parsed: a webhook body is attacker-controlled until
 * that check passes, and verifying a re-serialised parse verifies nothing.
 * Everything after it is the {@link WebhookService}'s, which is transport-
 * agnostic so a worker, a replay and a test dispatch the same event the same
 * way.
 *
 * The refusals are TEXT rather than JSON, deliberately: Stripe's own delivery
 * log renders the response body as the failure reason an operator reads, and it
 * has always been these two sentences. A 404 for a deployment that does no
 * billing is JSON, because that one is answered to a caller rather than to
 * Stripe's retry loop.
 */
import { internalSecret } from "@langwatch/api";
import {
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type ServiceContext,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";

import type { WebhookService } from "../../services/billing-webhook.service";

const logger = createLogger("langwatch:billing:stripe-webhook");

/** What the callback reaches that it does not own. */
export interface StripeWebhookRestPorts {
  /**
   * The event dispatcher, or none.
   *
   * None where this deployment does no billing at all: the route then answers
   * 404, which is what it has always answered off SaaS.
   */
  webhooks: () => WebhookService | null;
  /**
   * Verifies the signature over the raw bytes and returns the event.
   *
   * A port rather than the Stripe client itself, because the client is a
   * deployment credential and the transport needs exactly one operation on it.
   * Throwing means the payload or the signature is wrong.
   */
  constructEvent(input: { rawBody: Buffer; signature: string }): Stripe.Event;
  /** The signing secret, read per request so a rotation without a restart works. */
  signingSecret: () => string | undefined;
}

/** `POST /api/webhooks/stripe`, built against one process's security. */
export function createStripeWebhookRestApp(options: {
  security: AppRestSecurity;
  ports: StripeWebhookRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createServiceVersionedApp({
    name: "stripe-webhook",
    basePath: "/api",
    // Stripe's dashboard holds this exact URL; a provider callback has no
    // dated contract to negotiate.
    staticGeneration: "v1",
    errorEnvelope: "legacy",
  });

  const stripeHandler = async (
    c: ServiceContext<EndpointVariables>,
    input: { body: Uint8Array },
  ) => {
    const webhooks = ports.webhooks();
    if (!webhooks) {
      return c.json({ error: "Not Found" }, 404);
    }

    const signature = c.req.header("stripe-signature");
    const secret = ports.signingSecret();
    if (!signature || !secret) {
      logger.error(
        { signature: !!signature, secret: !!secret },
        "[stripeWebhook] Missing signature or secret",
      );
      return c.text("Webhook Error: Missing signature or secret", 400);
    }

    let event: Stripe.Event;
    try {
      event = ports.constructEvent({
        rawBody: Buffer.from(input.body),
        signature,
      });
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "[stripeWebhook] Failed to construct event",
      );
      return c.text("Webhook Error: Invalid payload or signature", 400);
    }

    const result = await webhooks.handleEvent(event);
    if (result.status === "error") {
      return c.text(result.message, result.httpStatus);
    }
    return c.json({ received: true });
  };

  return service
    .registerRoute("post", "/webhooks/stripe", MANAGEMENT_API_VERSION, stripeHandler, (b) =>
      policy(internalSecret("Stripe webhook signature verified in-handler"))(b)
        // The signature is computed over these bytes: a parse-then-reserialise
        // verifies nothing.
        .withRawBody("bytes")
        .withRawResponse(
          "Stripe's delivery log renders the response body as the failure reason an " +
            "operator reads, and it has always been these two sentences in text/plain",
        ),
    )
    .build();
}
