/**
 * `POST /api/webhooks/stripe`. The signature is verified over the RAW bytes
 * before anything is parsed: a body is attacker-controlled until it passes.
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  BadRequestError,
  NotFoundError,
  InternalServerError,
} from "@langwatch/api/rest";
import {
  billingStripeWebhookReceiptSchema,
  billingStripeWebhookHeadersSchema,
  type HandleEventResult,
} from "@langwatch/enterprise-billing-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import type Stripe from "stripe";

const logger = createLogger("langwatch:billing:stripe-webhook");

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** What the callback asks of the application. */
export interface BillingStripeWebhookApi {
  /**
   * Whether this deployment dispatches provider events at all. False where it
   * does no billing: the route then answers 404, which is what it has always
   * answered off SaaS.
   */
  dispatchesEvents(): boolean;
  /** The signing secret, read per request so a rotation without a restart works. */
  findSigningSecret(): string | undefined;
  /**
   * Verifies the signature over the raw bytes and returns the event. Throwing
   * means the payload or the signature is wrong.
   */
  constructEvent(input: { rawBody: Uint8Array; signature: string }): Stripe.Event;
  handleEvent(event: Stripe.Event): Promise<HandleEventResult>;
}

export const BillingStripeWebhookApi = moduleApi<BillingStripeWebhookApi>()("billing");

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
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(
    publicRoute({
      reason:
        "the provider signs every delivery and the signature is verified over the raw bytes by " +
        "the route itself; no API credential opens this door",
    }),
  )
  .withHeaders(billingStripeWebhookHeadersSchema)
  .withOutput(billingStripeWebhookReceiptSchema)
  .handle(async ({ app, raw }, headers) => {
    if (!app.dispatchesEvents()) {
      throw new NotFoundError("Billing webhooks are not enabled");
    }

    const signature = headers["stripe-signature"];
    const secret = app.findSigningSecret();

    if (!signature || !secret) {
      logger.error(
        { signature: !!signature, secret: !!secret },
        "[stripeWebhook] Missing signature or secret",
      );

      throw new BadRequestError("Webhook Error: Missing signature or secret");
    }

    const event = findVerifiedEvent({ app, rawBody: raw, signature });

    if (!event) throw new BadRequestError("Webhook Error: Invalid payload or signature");

    const result = await app.handleEvent(event);

    if (result.status === "error") {
      if (result.httpStatus === 400) throw new BadRequestError(result.message);

      throw new InternalServerError(result.message);
    }

    return { received: true as const };
  })
  .build();

/**
 * The event the delivery carries, or nothing where the payload or the
 * signature is wrong. The failure is logged here because the answer the sender
 * gets is deliberately the same for both.
 */
function findVerifiedEvent({
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
