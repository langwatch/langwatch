/**
 * The app's check of a gateway-signed request agrees with the one signer every app-side caller
 * uses, so a request signed by `@langwatch/process/gateway-internal-signature` is admitted.
 */
import { gatewayInternalSignatureHeaders } from "@langwatch/process/gateway-internal-signature";
import { describe, expect, it } from "vitest";

import { GatewayInternalIdentityService } from "../gateway-internal-identity.service.ts";

const SECRET = "gateway-internal-test-secret";
const PATH = "/api/internal/gateway/changes";

function signedRequest({
  secret = SECRET,
  body = "",
  sentBody = body,
}: {
  secret?: string;
  body?: string;
  sentBody?: string;
}): { request: Request; rawBody: string } {
  const request = new Request(`http://api.test${PATH}?organization_id=org-1`, {
    method: "POST",
    body: sentBody,
    headers: gatewayInternalSignatureHeaders({
      secret,
      method: "POST",
      path: PATH,
      body,
      nowMs: Date.now(),
    }),
  });

  return { request, rawBody: sentBody };
}

const INVALID_SIGNATURE = { code: "permission_denied", meta: { reason: "invalid_signature" } };

/** What `identify` threw; a call that admitted the request answers that instead. */
function refusalOf(identify: () => unknown): unknown {
  try {
    return { admitted: identify() };
  } catch (error) {
    return error;
  }
}

describe("GatewayInternalIdentityService", () => {
  const identity = GatewayInternalIdentityService.create({ secret: SECRET });

  describe("when a request carries the shared signer's headers", () => {
    it("admits it as the gateway's internal caller", () => {
      expect(identity.identify(signedRequest({ body: '{"ok":true}' }))).toEqual({
        actor: null,
        scope: null,
        internal: { type: "internalSecret", secretName: "gateway-internal" },
      });
    });
  });

  describe("when the shared signer used another secret", () => {
    it("refuses it as a signature mismatch", () => {
      expect(
        refusalOf(() => identity.identify(signedRequest({ secret: "another-secret" }))),
      ).toMatchObject(INVALID_SIGNATURE);
    });
  });

  describe("when the body differs from the one signed", () => {
    it("refuses it as a signature mismatch", () => {
      expect(
        refusalOf(() =>
          identity.identify(signedRequest({ body: '{"ok":true}', sentBody: '{"ok":false}' })),
        ),
      ).toMatchObject(INVALID_SIGNATURE);
    });
  });
});
