// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Auth0 SCIM webhook's HTTP intake: `POST /api/webhooks/auth0-scim`.
 *
 * Thin on purpose — admitting a delivery and provisioning from it live in the
 * application. The answers this door owns are the bodies. An install that
 * configured no shared secret answers 404 rather than 401, so a deployment
 * that never enabled directory sync looks like one that never served the path.
 *
 * @see packages/enterprise/features/scim/specs/scim.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawAnswer } from "@langwatch/api/rest";
import { ScimApi } from "@langwatch/enterprise-scim-contract";

import { SCIM_WEBHOOK_SIGNATURE_HEADER } from "../rules/scim-webhook-signature.rules.ts";

/** The headers the intake's own bodies are written with. */
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** One of the four sentences a refused delivery reads in Auth0's log. */
function refusal(status: 400 | 401 | 403 | 404, error: string): RestRawAnswer {
  return { status, headers: JSON_HEADERS, body: JSON.stringify({ error }) };
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
  .withAccess(
    publicRoute({
      reason:
        "the provider signs every delivery with the deployment secret and the route verifies it " +
        "over the raw bytes, then reads the tenant off the SCIM token presented; no API " +
        "credential opens this door",
    }),
  )
  .withRawResponse({ produces: ["application/json"] })
  .withDocs({
    tags: ["SCIM"],
    summary: "Receive an Auth0 SCIM log-stream delivery",
    description:
      "Auth0's SCIM log stream, signed with the deployment's shared secret and tenanted by the SCIM token the delivery presents. A deployment that configured no secret answers 404, so a probe cannot learn whether the path is served here.",
  })
  .handle(async ({ app, raw, request }) => {
    const admission = await app.admitDirectoryDelivery({
      body: raw,
      signature: request.headers.get(SCIM_WEBHOOK_SIGNATURE_HEADER),
      authorization: request.headers.get("authorization"),
    });

    if (admission.status === "not-configured") return refusal(404, "Webhook not configured");
    if (admission.status === "unauthorized") return refusal(401, "Unauthorized");
    if (admission.status === "forbidden") return refusal(403, "Forbidden");
    if (admission.status === "invalid-json") return refusal(400, "Invalid JSON");

    await app.relayDirectoryEvents({
      organizationId: admission.organizationId,
      events: admission.events,
    });

    return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ received: true }) };
  })
  .build();
