/**
 * `POST /api/webhooks/stripe`. The signature is verified over the RAW bytes
 * before anything is parsed: a body is attacker-controlled until it passes.
 * @see packages/enterprise/features/billing/specs/stripe-webhook.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestRawAnswer,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { featureApi } from "@langwatch/runtime-composition";
import type Stripe from "stripe";

import type { HandleEventResult } from "../services/billing-stripe-webhook.service.ts";

const logger = createLogger("langwatch:billing:stripe-webhook");

/** The bodies this route writes for itself, and the headers Hono gave them. */
const JSON_HEADERS = { "Content-Type": "application/json" } as const;
const TEXT_HEADERS = { "Content-Type": "text/plain; charset=UTF-8" } as const;

/** What the callback asks of the application. */
export interface BillingStripeWebhookApi {
  /**
   * Whether this deployment dispatches provider events at all. False where it
   * does no billing: the route then answers 404, which is what it has always
   * answered off SaaS.
   */
  dispatchesEvents(): boolean;
  /** The signing secret, read per request so a rotation without a restart works. */
  signingSecret(): string | undefined;
  /**
   * Verifies the signature over the raw bytes and returns the event. Throwing
   * means the payload or the signature is wrong.
   */
  constructEvent(input: { rawBody: Uint8Array; signature: string }): Stripe.Event;
  handleEvent(event: Stripe.Event): Promise<HandleEventResult>;
}

export const BillingStripeWebhookApi = featureApi<BillingStripeWebhookApi>("billing");

/**
 * `/api/webhooks/stripe`, at exactly the address Stripe's dashboard holds, and
 * the `/api/v1` twin the family has always also answered at. Literal because a
 * provider callback has no dated contract to negotiate.
 */
export const billingStripeWebhookRest = defineRestRouter(BillingStripeWebhookApi)
  .withNamespace("billing-stripe-webhook")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal")

  .post("/api/webhooks/stripe", "receiveStripeWebhook")
  // The signature is computed over these bytes: a parse-then-reserialise
  // verifies nothing.
  .withRawBody("bytes")
  .withAccess(
    publicRoute({
      reason:
        "the provider signs every delivery and the signature is verified over the raw bytes by " +
        "the route itself; no API credential opens this door",
    }),
  )
  .withRawResponse({ produces: ["application/json", "text/plain"] })
  .handle(async ({ app, raw, request }) => {
    if (!app.dispatchesEvents()) {
      return { status: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "Not Found" }) };
    }

    const signature = request.headers.get("stripe-signature");
    const secret = app.signingSecret();

    if (!signature || !secret) {
      logger.error(
        { signature: !!signature, secret: !!secret },
        "[stripeWebhook] Missing signature or secret",
      );

      return refusal("Webhook Error: Missing signature or secret");
    }

    const event = verifiedEvent({ app, rawBody: raw, signature });

    if (!event) return refusal("Webhook Error: Invalid payload or signature");

    const result = await app.handleEvent(event);

    if (result.status === "error") {
      return { status: result.httpStatus, headers: TEXT_HEADERS, body: result.message };
    }

    return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ received: true }) };
  })
  .build();

/** One of the two sentences the provider's delivery log shows an operator. */
function refusal(message: string): RestRawAnswer {
  return { status: 400, headers: TEXT_HEADERS, body: message };
}

/**
 * The event the delivery carries, or nothing where the payload or the
 * signature is wrong. The failure is logged here because the answer the sender
 * gets is deliberately the same for both.
 */
function verifiedEvent({
  app,
  rawBody,
  signature,
}: {
  app: BillingStripeWebhookApi;
  rawBody: Uint8Array;
  signature: string;
}): Stripe.Event | null {
  try {
    return app.constructEvent({ rawBody, signature });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "[stripeWebhook] Failed to construct event",
    );

    return null;
  }
}
