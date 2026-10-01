import {
  passwordResetSessionBridge,
  sessionCallbackEvidence,
  ssoRegisteredIssuers,
} from "~/server/app-layer/identity/runtime";
import {
  nameIssuerMismatch,
  runWithIdTokenIssuerScope,
} from "~/server/better-auth/id-token-issuer-mismatch";
import { aliasLegacyMicrosoftCallback } from "~/server/better-auth/legacy-callback-alias";

/**
 * One request through better-auth, the way the auth route hands it over.
 *
 * The legacy Microsoft callback path is served as the provider's own, the
 * per-request scopes the hooks read are opened (callback evidence, the
 * password-reset session bridge, the ID token issuer slot), and a token
 * refused for its issuer comes back as `sso_issuer_mismatch` naming both
 * issuers. The reset scope is opened around every request rather than only the
 * reset path: it is a per-request slot that costs nothing empty, and the path
 * check belongs to the hook that reads it.
 */
export function handleAuthRequest({
  request,
  handler,
}: {
  request: Request;
  /** better-auth's fetch-compatible handler, with whatever the caller adds. */
  handler: (request: Request) => Promise<Response>;
}): Promise<Response> {
  const served = aliasLegacyMicrosoftCallback(request);
  return runWithIdTokenIssuerScope(async () =>
    nameIssuerMismatch({
      response: await sessionCallbackEvidence().runWithScope(() =>
        passwordResetSessionBridge().runWithScope(() => handler(served)),
      ),
      expectedIssuer: async () =>
        (await ssoRegisteredIssuers().issuersForRequest(request))[0] ?? null,
    }),
  );
}
