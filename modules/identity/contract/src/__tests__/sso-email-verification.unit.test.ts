/**
 * @vitest-environment node
 * What a provider said about an address, and which issuers are Entra ID.
 */
import { describe, expect, it } from "vitest";

import { assertedEmailVerification } from "../sso-email-verification.ts";
import {
  canonicalEntraIssuer,
  entraEndpointOrigins,
  entraTenancyOf,
  isEntraIssuer,
} from "../sso-entra-issuer.ts";

const ENTRA = "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
const KEYCLOAK = "https://keycloak.acme.test/realms/acme";

describe("assertedEmailVerification", () => {
  describe("when the provider sends email_verified", () => {
    it.each([
      [true, "verified"],
      ["true", "verified"],
      [false, "unverified"],
      ["false", "unverified"],
    ] as const)("reads %s as %s", (value, expected) => {
      expect(
        assertedEmailVerification({
          claimSources: [{ email_verified: value }],
          issuer: KEYCLOAK,
        }),
      ).toBe(expected);
    });
  });

  describe("when no source carries a verification claim", () => {
    it("answers unasserted", () => {
      expect(
        assertedEmailVerification({
          claimSources: [{ email: "ana@acme.com" }, {}],
          issuer: KEYCLOAK,
        }),
      ).toBe("unasserted");
    });
  });

  describe("when one source says verified and another says not", () => {
    it("lets the negative win", () => {
      expect(
        assertedEmailVerification({
          claimSources: [{ email_verified: true }, { email_verified: false }],
          issuer: KEYCLOAK,
        }),
      ).toBe("unverified");
    });
  });

  describe("when the issuer is Microsoft Entra ID", () => {
    it.each([
      [true, "verified"],
      [false, "unverified"],
    ] as const)("reads xms_edov %s as %s", (value, expected) => {
      expect(
        assertedEmailVerification({
          claimSources: [{ email: "ana@acme.com", xms_edov: value }],
          issuer: ENTRA,
        }),
      ).toBe(expected);
    });

    it("answers unasserted without xms_edov", () => {
      expect(
        assertedEmailVerification({
          claimSources: [{ email: "ana@acme.com" }],
          issuer: ENTRA,
        }),
      ).toBe("unasserted");
    });
  });

  describe("when another issuer sends xms_edov", () => {
    it("ignores it", () => {
      expect(
        assertedEmailVerification({
          claimSources: [{ xms_edov: true }],
          issuer: KEYCLOAK,
        }),
      ).toBe("unasserted");
    });
  });
});

describe("isEntraIssuer", () => {
  it.each([
    [ENTRA, true],
    ["https://sts.windows.net/9188040d-6c67-4c5b-b112-36a304b66dad/", true],
    ["https://login.microsoftonline.us/tenant/v2.0", true],
    [KEYCLOAK, false],
    ["https://login.microsoftonline.com.evil.test/tenant/v2.0", false],
    ["not a url", false],
    [null, false],
  ] as const)("reads %s as %s", (issuer, expected) => {
    expect(isEntraIssuer(issuer)).toBe(expected);
  });
});

describe("entraEndpointOrigins", () => {
  it.each([
    [ENTRA, ["https://graph.microsoft.com"]],
    ["https://sts.windows.net/tenant/", ["https://graph.microsoft.com"]],
    [
      "https://login.microsoftonline.us/tenant/v2.0",
      ["https://graph.microsoft.us", "https://dod-graph.microsoft.us"],
    ],
    ["https://login.chinacloudapi.cn/tenant/v2.0", ["https://microsoftgraph.chinacloudapi.cn"]],
    [KEYCLOAK, []],
    ["http://login.microsoftonline.com/tenant/v2.0", []],
  ] as const)("names Graph for %s", (issuer, expected) => {
    expect(entraEndpointOrigins(issuer)).toEqual(expected);
  });
});

describe("canonicalEntraIssuer", () => {
  it.each([
    [`${ENTRA}/`, ENTRA],
    [`${ENTRA}//`, ENTRA],
    [ENTRA, ENTRA],
    ["https://sts.windows.net/tenant", "https://sts.windows.net/tenant/"],
    ["https://sts.windows.net/tenant/", "https://sts.windows.net/tenant/"],
    ["https://acme.eu.auth0.com/", "https://acme.eu.auth0.com/"],
    [KEYCLOAK, KEYCLOAK],
  ])("reads %s as %s", (issuer, expected) => {
    expect(canonicalEntraIssuer(issuer)).toBe(expected);
  });
});

describe("entraTenancyOf", () => {
  it.each([
    ["https://login.microsoftonline.com/common/v2.0", "common"],
    ["https://login.microsoftonline.com/organizations/v2.0", "organizations"],
    ["https://login.microsoftonline.com/Consumers/v2.0/", "consumers"],
  ])("reads %s as the multi-tenant segment %s", (issuer, segment) => {
    expect(entraTenancyOf(issuer)).toEqual({ multiTenant: true, segment });
  });

  it.each([[ENTRA], ["https://acme.okta.com/common"]])("reads %s as one tenant", (issuer) => {
    expect(entraTenancyOf(issuer)).toEqual({ multiTenant: false });
  });
});
