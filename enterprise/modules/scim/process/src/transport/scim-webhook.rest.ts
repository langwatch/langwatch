// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Auth0 SCIM webhook's HTTP intake: `POST /api/webhooks/auth0-scim`.
 *
 * Thin on purpose — admitting a delivery and provisioning from it live in the
 * application. The answers this door owns are the bodies. An install that
 * configured no shared secret answers 404 rather than 401, so a deployment
 * that never enabled directory sync looks like one that never served the path.
 *
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestAnswer,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import { ScimApi, scimWebhookDeliveryHeadersSchema } from "@langwatch/enterprise-scim-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";

const JSON_MEDIA_TYPE = "application/json";

/** The signature and the directory token a delivery presents, read off it by the process. */
export const scimWebhookDelivery = defineRestMiddleware(
  "scimWebhookDelivery",
  scimWebhookDeliveryHeadersSchema,
);

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** One of the four sentences a refused delivery reads in Auth0's log. */
function refusal(
  response: RestProtocolProducer<typeof JSON_MEDIA_TYPE>,
  status: 400 | 401 | 403 | 404,
  error: string,
): RestAnswer<"protocol"> {
  return response.write({ status, mediaType: JSON_MEDIA_TYPE, body: JSON.stringify({ error }) });
}

/**
 * `/api/webhooks/auth0-scim`, at exactly the address Auth0's log stream holds.
 * Literal because a provider callback has no dated contract to negotiate, and
 * with no `/api/v1` twin because the path was never aliased under one.
 */
export const scimWebhookRest = defineRestRouter(ScimApi)
  .withNamespace("scim-webhook")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/webhooks/auth0-scim", "receiveAuth0ScimWebhook")
  // The HMAC is computed over these exact characters, so nothing parses them
  // first: a parse-then-reserialise verifies nothing.
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withAccess(
    publicRoute({
      reason:
        "the provider signs every delivery with the deployment secret and the route verifies it " +
        "over the raw bytes, then reads the tenant off the SCIM token presented; no API " +
        "credential opens this door",
    }),
  )
  .withMiddleware(scimWebhookDelivery)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "Auth0's log stream reads its own delivery acknowledgement, status and body.",
  })
  .withDocs({
    tags: ["SCIM"],
    summary: "Receive an Auth0 SCIM log-stream delivery",
    description:
      "Auth0's SCIM log stream, signed with the deployment's shared secret and tenanted by the SCIM token the delivery presents. A deployment that configured no secret answers 404, so a probe cannot learn whether the path is served here.",
  })
  .handle(async ({ app, raw, response }, delivery) => {
    const admission = await app.admitDirectoryDelivery({
      body: raw,
      signature: delivery.signature,
      authorization: delivery.authorization,
    });

    if (admission.status === "not-configured") {
      return refusal(response, 404, "Webhook not configured");
    }
    if (admission.status === "unauthorized") return refusal(response, 401, "Unauthorized");
    if (admission.status === "forbidden") return refusal(response, 403, "Forbidden");
    if (admission.status === "invalid-json") return refusal(response, 400, "Invalid JSON");

    await app.relayDirectoryEvents({
      organizationId: admission.organizationId,
      events: admission.events,
    });

    return response.write({
      status: 200,
      mediaType: JSON_MEDIA_TYPE,
      body: JSON.stringify({ received: true }),
    });
  })
  .build();
