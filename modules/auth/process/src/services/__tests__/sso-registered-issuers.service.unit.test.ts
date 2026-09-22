/**
 * @vitest-environment node
 * Which issuers ONE sign-in request may reach: the connection it names, or
 * the connection that proved the domain of the address somebody typed —
 * never both, and never another tenant's.
 */
import { createLogger } from "@langwatch/observability";
import { describe, expect, it } from "vitest";

import {
  SsoRegisteredIssuersService,
  type SsoIssuerDirectory,
} from "../sso-registered-issuers.service.ts";

const ACME_ISSUER = "https://idp.acme.test";

const logger = createLogger("langwatch:auth:test");

function serviceOver(directory: Partial<SsoIssuerDirectory>) {
  return SsoRegisteredIssuersService.create({
    issuers: {
      findIssuersForConnection: async () => [],
      findIssuersForDomain: async () => [],
      ...directory,
    },
    logger,
  });
}

const signInRequest = (body: Record<string, unknown>) =>
  new Request("https://app.langwatch.test/api/auth/sign-in/sso", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("given a request that is not about single sign-on", () => {
  it("asks nothing and trusts nothing new", async () => {
    const service = serviceOver({
      findIssuersForDomain: async () => {
        throw new Error("a password sign-in must not read the connection directory");
      },
    });

    expect(
      await service.issuersForRequest(
        new Request("https://app.langwatch.test/api/auth/sign-in/email", { method: "POST" }),
      ),
    ).toEqual([]);
    expect(await service.issuersForRequest(undefined)).toEqual([]);
  });
});

describe("given a sign-in naming an email address", () => {
  it("answers the issuer of the connection that proved its domain", async () => {
    const service = serviceOver({
      findIssuersForDomain: async ({ domain }) => (domain === "acme.test" ? [ACME_ISSUER] : []),
    });

    expect(await service.issuersForRequest(signInRequest({ email: "person@acme.test" }))).toEqual([
      ACME_ISSUER,
    ]);
  });

  describe("when the address names no domain we hold", () => {
    it("answers nothing", async () => {
      const service = serviceOver({});

      expect(await service.issuersForRequest(signInRequest({ email: "not-an-address" }))).toEqual(
        [],
      );
    });
  });
});

describe("given a callback naming a connection in its path", () => {
  it("answers that connection's issuer, whatever the body says", async () => {
    const service = serviceOver({
      findIssuersForConnection: async ({ connectionId }) =>
        connectionId === "ssoc_acme" ? [ACME_ISSUER] : [],
    });

    expect(
      await service.issuersForRequest(
        new Request("https://app.langwatch.test/api/auth/sso/callback/ssoc_acme?code=1"),
      ),
    ).toEqual([ACME_ISSUER]);
  });

  it("reads the SAML assertion consumer path the same way", async () => {
    const service = serviceOver({
      findIssuersForConnection: async ({ connectionId }) =>
        connectionId === "ssoc_acme" ? [ACME_ISSUER] : [],
    });

    expect(
      await service.issuersForRequest(
        new Request("https://app.langwatch.test/api/auth/sso/saml2/sp/acs/ssoc_acme", {
          method: "POST",
        }),
      ),
    ).toEqual([ACME_ISSUER]);
  });
});

describe("given the connection directory cannot be read", () => {
  it("trusts this deployment's own origins only rather than refusing the sign-in", async () => {
    const service = SsoRegisteredIssuersService.create({
      issuers: {
        findIssuersForConnection: async () => {
          throw new Error("directory unreachable");
        },
        findIssuersForDomain: async () => [],
      },
      logger,
    });

    expect(await service.issuersForRequest(signInRequest({ providerId: "ssoc_acme" }))).toEqual([]);
  });
});
