/**
 * The three SCIM REST families, each on the door its own declaration names:
 * the management family on the organization credential, the SCIM 2.0 protocol
 * on the directory bearer, the Auth0 intake on no credential at all.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import {
  scimProtocolErrorHandler,
  scimProtocolRest,
  scimTokenRest,
  scimTokenRestActor,
  scimWebhookRest,
  type ScimApi,
} from "@langwatch/enterprise-api";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/**
 * Mounts `/api/scim-tokens` behind the organization credential. OWED: the
 * Enterprise plan gate, over `ScimApi.isEnterpriseEntitled` - it ran AFTER the
 * RBAC check and neither runtime has a post-authorization seam yet.
 */
export function mountScimTokenRest(
  runtime: ApiRestRuntime,
  scim: () => ScimApi,
): MountableRestApp {
  return runtime.mount(scimTokenRest.router(), scim, {
    // Who a mint or a revocation is recorded against, read off the door's own
    // answer: the member the credential acts as, or the credential itself
    // where it acts as nobody.
    facts: [
      bindRestMiddleware(scimTokenRestActor, (context) => {
        const credential = runtime.organizationCredentialOf(context.req.raw);

        return { actorId: credential.userId ?? `apikey:${credential.apiKeyId}` };
      }),
    ],
  });
}

/**
 * Mounts `/api/scim/v2` behind the bearer an identity provider provisions
 * with. The family answers its own refusals in the protocol's error document;
 * anything it does not recognise falls to the process boundary.
 */
export function mountScimProtocolRest(
  runtime: ApiRestRuntime,
  scim: () => ScimApi,
): MountableRestApp {
  return runtime.mount(scimProtocolRest.router(), scim, {
    onError: scimProtocolErrorHandler,
  });
}

/**
 * Mounts `POST /api/webhooks/auth0-scim`. Public at the door: the provider
 * signs every delivery and the route verifies it over the raw bytes.
 */
export function mountScimWebhookRest(
  runtime: ApiRestRuntime,
  scim: () => ScimApi,
): MountableRestApp {
  return runtime.mount(scimWebhookRest.router(), scim);
}
