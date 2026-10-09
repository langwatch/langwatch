import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { GatewayApi } from "@langwatch/gateway-contract";
import {
  gatewayElevenLabsSignatureSchema,
  gatewayElevenLabsWebhookParamsSchema,
} from "@langwatch/gateway-contract/gateway-elevenlabs-webhook-schemas";
import { resolveRequestBound } from "@langwatch/plans";

const WEBHOOK_PUBLIC_REASON =
  "ElevenLabs delivers this callback publicly; the application verifies the raw bytes against the provider row's stored HMAC secret.";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

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
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess({ kind: "public", reason: WEBHOOK_PUBLIC_REASON })
  .withResponse("protocol", {
    produces: "application/json",
    because:
      "ElevenLabs reads its own delivery acknowledgement, status and body, as the provider defines it.",
  })
  .withMiddleware(elevenLabsSignature)
  .handle(async ({ app, input, raw, response }, headers) => {
    const answer = await app.receiveElevenLabsWebhook({
      modelProviderId: input.modelProviderId,
      rawBody: raw,
      signature: headers.signature,
    });

    return response.write({
      status: answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answer.body),
    });
  })
  .build();
