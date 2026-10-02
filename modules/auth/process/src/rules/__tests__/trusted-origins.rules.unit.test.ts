/**
 * @vitest-environment node
 * What the sign-in door may fetch a discovery document from: this
 * deployment's own addresses, plus what a customer registered, plus the two
 * static ways on. Decided with nothing booted.
 */
import { describe, expect, it } from "vitest";

import { resolveTrustedOrigins } from "../trusted-origins.rules.ts";

const deployment = {
  baseUrl: "https://app.langwatch.test",
  publicBaseUrl: undefined,
  trustedIdpOrigins: undefined,
  idpSimulatorUrl: undefined,
  isProduction: true,
};

describe("given a deployment holding no registered connection", () => {
  /** @scenario "An issuer nobody registered is refused by name" */
  it("trusts its own address and nothing else", () => {
    expect(resolveTrustedOrigins(deployment)).toEqual(["https://app.langwatch.test"]);
  });

  describe("when a proxy gives it a second address", () => {
    it("trusts both, in the order an operator wrote them", () => {
      expect(
        resolveTrustedOrigins({ ...deployment, publicBaseUrl: "https://langwatch.example" }),
      ).toEqual(["https://app.langwatch.test", "https://langwatch.example"]);
    });
  });
});

describe("given a customer registered an issuer", () => {
  /** @scenario "An issuer a customer registered is one this installation may fetch from" */
  it("trusts its ORIGIN, because that is what the engine compares", () => {
    expect(
      resolveTrustedOrigins({
        ...deployment,
        registeredIssuers: ["https://idp.acme.test/realms/acme"],
      }),
    ).toEqual(["https://app.langwatch.test", "https://idp.acme.test"]);
  });

  describe("when the registration is not an address at all", () => {
    it("trusts nothing new rather than refusing every sign-in", () => {
      expect(
        resolveTrustedOrigins({ ...deployment, registeredIssuers: ["urn:acme:idp", ""] }),
      ).toEqual(["https://app.langwatch.test"]);
    });
  });
});

describe("given the registered issuer is Microsoft Entra ID", () => {
  const entra = "https://login.microsoftonline.com/tenant-id/v2.0";

  it("trusts Microsoft Graph too, where Entra ID serves userinfo", () => {
    expect(resolveTrustedOrigins({ ...deployment, registeredIssuers: [entra] })).toEqual([
      "https://app.langwatch.test",
      "https://login.microsoftonline.com",
      "https://graph.microsoft.com",
    ]);
  });

  describe("when the issuer is any other provider", () => {
    it("does not trust Microsoft Graph", () => {
      expect(
        resolveTrustedOrigins({ ...deployment, registeredIssuers: ["https://acme.okta.com"] }),
      ).not.toContain("https://graph.microsoft.com");
    });
  });
});

describe("given a registered issuer whose discovery document serves endpoints elsewhere", () => {
  /** @scenario "Google's endpoints on googleapis.com are trusted for a Google connection" */
  it("trusts the endpoint origins identity vouched for, once each", () => {
    expect(
      resolveTrustedOrigins({
        ...deployment,
        registeredIssuers: ["https://accounts.google.com"],
        issuerEndpointOrigins: [
          "https://accounts.google.com",
          "https://oauth2.googleapis.com",
          "https://www.googleapis.com",
        ],
      }),
    ).toEqual([
      "https://app.langwatch.test",
      "https://accounts.google.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
    ]);
  });
});

describe("given an operator's own allowlist", () => {
  it("reads it however they wrote it, in production too", () => {
    expect(
      resolveTrustedOrigins({
        ...deployment,
        trustedIdpOrigins: "https://idp.internal, https://idp.two.internal\nhttps://idp.internal",
      }),
    ).toEqual(["https://app.langwatch.test", "https://idp.internal", "https://idp.two.internal"]);
  });
});

describe("given a worktree running the identity-provider simulator", () => {
  /** @scenario "The worktree simulator is trusted outside production only" */
  it("trusts it outside production", () => {
    expect(
      resolveTrustedOrigins({
        ...deployment,
        isProduction: false,
        idpSimulatorUrl: "https://idp.worktree.langwatch.localhost",
      }),
    ).toContain("https://idp.worktree.langwatch.localhost");
  });

  describe("when the deployment is production", () => {
    /** @scenario "The worktree simulator is trusted outside production only" */
    it("refuses it: it signs whatever it is asked to sign", () => {
      expect(
        resolveTrustedOrigins({
          ...deployment,
          idpSimulatorUrl: "https://idp.worktree.langwatch.localhost",
        }),
      ).toEqual(["https://app.langwatch.test"]);
    });
  });
});
