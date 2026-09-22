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
