import { GatewayApi } from "@langwatch/gateway-contract";
import {
  gatewayElevenLabsSignatureSchema,
  gatewayElevenLabsWebhookParamsSchema,
} from "@langwatch/gateway-contract/gateway-elevenlabs-webhook-schemas";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";

const WEBHOOK_PUBLIC_REASON =
  "ElevenLabs delivers this callback publicly; the application verifies the raw bytes against the provider row's stored HMAC secret.";

export const elevenLabsSignature = defineRestMiddleware(
  "elevenLabsSignature",
  gatewayElevenLabsSignatureSchema,
);

export const elevenLabsWebhookRest = defineRestRouter(GatewayApi)
  .withNamespace("elevenlabs-webhook")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .post("/api/elevenlabs/webhook/:modelProviderId", "receiveElevenLabsWebhook")
  .withParams(gatewayElevenLabsWebhookParamsSchema)
  .withRawBody("text")
  .withAccess({ kind: "public", reason: WEBHOOK_PUBLIC_REASON })
  .withRawResponse({ produces: "application/json" })
  .withMiddleware(elevenLabsSignature)
  .handle(async ({ app, input, raw }, headers) => {
    const answer = await app.receiveElevenLabsWebhook({
      modelProviderId: input.modelProviderId,
      rawBody: raw,
      signature: headers.signature,
    });

    return {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer.body),
    };
  })
  .build();
