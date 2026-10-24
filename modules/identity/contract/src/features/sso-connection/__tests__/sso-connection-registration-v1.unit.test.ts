/**
 * @vitest-environment node
 * A stored version 1 registration, read as version 2 by the contract's own transform.
 * Spec: modules/identity/specs/sso-connection-legacy-registration.feature
 */
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { connectionRegisteredPayloadSchema } from "../connection.ts";
import { registrationFromV1 } from "../sso-connection-registration-v1.ts";

function stored(extra: Record<string, unknown>) {
  return {
    connectionId: "ssoconn_acme",
    organizationId: "org_acme",
    type: "oidc",
    idp: { issuer: null, providerId: "Okta", clientIdRef: null, secretRef: null, certRefs: [] },
    actor: { type: "user", id: "user_ana" },
    source: "legacy-grandfathered",
    ...extra,
  };
}

describe("given a version 1 registration that states an arrival policy outside the three answers", () => {
  describe("when it is read as version 2", () => {
    /** @scenario "A registration that states an arrival policy reads as written" */
    it("refuses it with an invalid_value issue on arrivalPolicy", () => {
      let refused: unknown;
      try {
        registrationFromV1(stored({ arrivalPolicy: "auto" }));
      } catch (error) {
        refused = error;
      }

      expect(refused).toBeInstanceOf(ZodError);
      expect((refused as ZodError).issues[0]).toMatchObject({
        code: "invalid_value",
        path: ["arrivalPolicy"],
      });
    });

    it("reads a stated policy as written, whatever allowsJit says", () => {
      expect(
        registrationFromV1(stored({ arrivalPolicy: "request", allowsJit: true })),
      ).toMatchObject({ arrivalPolicy: "request" });
    });
  });
});

describe("given a version 1 registration as it was stored", () => {
  describe("when it is read as version 2", () => {
    it("answers a payload the current version 2 schema accepts", () => {
      for (const extra of [{}, { allowsJit: true }, { arrivalPolicy: "request" }]) {
        const read = registrationFromV1(stored(extra));
        expect(connectionRegisteredPayloadSchema.parse(read)).toEqual(read);
      }
    });
  });
});
