/**
 * `POST /api/webhooks/stripe`. The signature is verified over the RAW bytes
 * before anything is parsed: a body is attacker-controlled until it passes.
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  billingStripeWebhookReceiptSchema,
  billingStripeWebhookHeadersSchema,
} from "@langwatch/enterprise-billing-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { resolveRequestBound } from "@langwatch/plans";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** What the callback asks of the application. */
export interface BillingStripeWebhookApi {
  receiveStripeWebhook(input: {
    rawBody: Uint8Array;
    signature: string | undefined;
  }): Promise<{ received: true }>;
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
  .handle(async ({ app, raw }, headers) =>
    app.receiveStripeWebhook({ rawBody: raw, signature: headers["stripe-signature"] }),
  )
  .build();
