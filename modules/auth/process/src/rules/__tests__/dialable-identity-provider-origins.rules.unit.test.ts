import { describe, expect, it } from "vitest";

import { resolveDialableIdentityProviderOrigins } from "../trusted-origins.rules.ts";

describe("resolveDialableIdentityProviderOrigins", () => {
  describe("given an operator's list of trusted identity providers", () => {
    it("vouches for each one's bare origin, however the list is separated", () => {
      expect(
        resolveDialableIdentityProviderOrigins({
          trustedIdpOrigins:
            "https://idp.corp.internal/realms/acme, https://sso.corp:8443 https://idp.corp.internal",
          idpSimulatorUrl: undefined,
          isProduction: true,
        }),
      ).toEqual(["https://idp.corp.internal", "https://sso.corp:8443"]);
    });

    it("ignores an entry that is not an address", () => {
      expect(
        resolveDialableIdentityProviderOrigins({
          trustedIdpOrigins: "not a url,,urn:example:idp",
          idpSimulatorUrl: undefined,
          isProduction: false,
        }),
      ).toEqual([]);
    });
  });

  describe("given the worktree's identity-provider simulator", () => {
    it("vouches for it outside production", () => {
      expect(
        resolveDialableIdentityProviderOrigins({
          trustedIdpOrigins: undefined,
          idpSimulatorUrl: "https://idpsim.acme.langwatch.localhost/issuer",
          isProduction: false,
        }),
      ).toEqual(["https://idpsim.acme.langwatch.localhost"]);
    });

    it("never vouches for it in production, because it signs whatever it is asked to", () => {
      expect(
        resolveDialableIdentityProviderOrigins({
          trustedIdpOrigins: undefined,
          idpSimulatorUrl: "https://idpsim.acme.langwatch.localhost",
          isProduction: true,
        }),
      ).toEqual([]);
    });
  });
});
