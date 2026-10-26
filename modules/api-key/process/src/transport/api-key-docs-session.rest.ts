/**
 * `DELETE /api/docs-session`: the documentation playground's Disconnect (ADR-185). The presenting
 * docs session key revokes itself and nothing else; any other key is answered the same and kept.
 */
import { ApiKeyApi, docsSessionRevokedSchema } from "@langwatch/api-key-contract";
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineMiddlewareContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { z } from "zod";

/** The key the door authenticated: null for a credential that is no stored key. */
export const docsSessionPresentedKey = defineMiddlewareContext(
  "docsSessionPresentedKey",
  z.object({ apiKeyId: z.string().nullable() }),
);

const THE_KEY_REVOKES_ITSELF =
  "The presenting key is the only thing this route touches, so holding it is the whole authority.";

export const apiKeyDocsSessionRest = defineRestRouter(ApiKeyApi)
  .withNamespace("docs-session")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("api_key")

  .delete("/", "revokeDocsSession")
  .withAccess(anyAuthenticated({ reason: THE_KEY_REVOKES_ITSELF }))
  .withOutput(docsSessionRevokedSchema)
  .withDocs({
    tags: ["API Keys"],
    summary: "Disconnect a docs session",
    description:
      "Revokes the docs session key that authenticates this request, so the documentation playground can end its session at once. Any other key is answered the same way and left as it is.",
    errors: [{ status: 401, description: "Invalid, expired or already revoked key" }],
  })
  .withMiddlewareContext(docsSessionPresentedKey)
  .withAudit("management.api-key.revoke-docs-session")
  .withoutConfirmation("A docs session key revokes only itself")
  .handle(({ app }, presented) => app.revokeDocsSessionKeys({ apiKeyId: presented.apiKeyId }))
  .build();
