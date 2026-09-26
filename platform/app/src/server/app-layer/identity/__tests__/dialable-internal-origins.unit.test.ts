/** @vitest-environment node */

/**
 * Which addresses somebody vouched for, and under which deployment.
 *
 * The interesting half is the asymmetry: an operator's own allowlist is
 * honoured in production and the simulator's address is not, because the
 * simulator signs whatever it is asked to sign.
 *
 * Corresponds to specs/identity/sso-connection-lifecycle.feature.
 */
import { describe, expect, it } from "vitest";
import { resolveDialableInternalOrigins } from "../dialable-internal-origins";

describe("given an operator's own allowlist", () => {
  describe("when the deployment is production", () => {
    /** @scenario "An issuer inside the network an operator vouched for is dialled" */
    it("honours it, because a private provider has no public address to give", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins: "https://idp.internal.example",
          idpSimulatorUrl: undefined,
          isProduction: true,
        }),
      ).toEqual(["https://idp.internal.example"]);
    });
  });

  describe("when it carries the path an issuer usually has", () => {
    /** @scenario "An issuer inside the network an operator vouched for is dialled" */
    it("keeps the bare origin, which is what a hop is compared against", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins: "https://idp.internal.example/realms/acme",
          idpSimulatorUrl: undefined,
          isProduction: true,
        }),
      ).toEqual(["https://idp.internal.example"]);
    });
  });

  describe("when it is written with commas and spaces", () => {
    /** @scenario "An issuer inside the network an operator vouched for is dialled" */
    it("reads every entry and drops what is not an address", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins:
            "https://one.internal, https://two.internal  not-an-address",
          idpSimulatorUrl: undefined,
          isProduction: true,
        }),
      ).toEqual(["https://one.internal", "https://two.internal"]);
    });
  });
});

describe("given the identity provider simulator's address", () => {
  const simulator = "https://idp.acme.langwatch.localhost";

  describe("when the deployment is not production", () => {
    /** @scenario "The simulator is dialled outside production and nowhere else" */
    it("is dialled, so the journey can be walked on a laptop", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins: undefined,
          idpSimulatorUrl: simulator,
          isProduction: false,
        }),
      ).toEqual([simulator]);
    });
  });

  describe("when the deployment is production", () => {
    /** @scenario "The simulator is dialled outside production and nowhere else" */
    it("is dropped, because it signs whatever it is asked to sign", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins: undefined,
          idpSimulatorUrl: simulator,
          isProduction: true,
        }),
      ).toEqual([]);
    });

    /** @scenario "The simulator is dialled outside production and nowhere else" */
    it("drops it without taking the operator's own allowlist with it", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins: "https://idp.internal.example",
          idpSimulatorUrl: simulator,
          isProduction: true,
        }),
      ).toEqual(["https://idp.internal.example"]);
    });
  });
});

describe("given nothing is configured", () => {
  describe("when the origins are resolved", () => {
    it("vouches for nothing, which is the guard's plain rule", () => {
      expect(
        resolveDialableInternalOrigins({
          trustedIdpOrigins: undefined,
          idpSimulatorUrl: undefined,
          isProduction: false,
        }),
      ).toEqual([]);
    });
  });
});
