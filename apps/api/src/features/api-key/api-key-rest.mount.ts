/**
 * Binds the api-keys REST declaration to this process's organization door.
 *
 * The two management audit rows this family writes are no longer here: reading
 * one key by id and updating one both declare `withAudit` on the route itself,
 * and the runtime writes the row from the actor, the addressed id and the
 * organization the door resolved. What is left is the one thing the runtime
 * cannot yet answer for itself — the credential, as an object rather than as
 * its holder.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { apiKeyRest, apiKeyRestCredential } from "@langwatch/api-key-server";
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/api-keys` behind this process's organization credential. */
export function mountApiKeyRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ apiKeys: () => ApiKeyApi }>,
): MountableRestApp {
  return runtime.mount(apiKeyRest.router(), options.apiKeys, {
    // The credential itself, not just its holder: two of these routes ask
    // whether the KEY may act organization-wide as well as whether the member
    // may, so a narrowed key cannot borrow the reach of whoever created it.
    facts: [
      bindRestMiddleware(apiKeyRestCredential, (context) => {
        const credential = runtime.organizationCredentialOf(context.req.raw);

        return { apiKeyId: credential.apiKeyId, userId: credential.userId };
      }),
    ],
  });
}
