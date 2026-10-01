// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which of a deployment's four addresses a reader is shown. The protocol is
 * what scopes them: a SAML administrator never needs the redirect address,
 * and an OpenID Connect one never needs an entity id.
 */
import { describe, expect, it } from "vitest";

import { serviceProviderRowsFor, type ServiceProviderAddresses } from "../service-provider-rows.ts";

const ADDRESSES: ServiceProviderAddresses = {
  redirectUrl: "https://app.langwatch.ai/api/auth/sso/callback/{connection}",
  assertionConsumerServiceUrl: "https://app.langwatch.ai/api/auth/sso/saml2/sp/acs/{connection}",
  entityId: "https://app.langwatch.ai/api/auth/sso/saml2/sp/metadata/{connection}",
  metadataUrl: "https://app.langwatch.ai/api/auth/sso/saml2/sp/metadata/{connection}",
};

describe("given an OpenID Connect connection", () => {
  it("shows the one address it takes, and nothing SAML would want", () => {
    const rows = serviceProviderRowsFor({ protocol: "oidc", addresses: ADDRESSES });

    expect(rows.map((row) => row.label)).toEqual(["Redirect address"]);
    expect(rows[0]?.value).toBe(ADDRESSES.redirectUrl);
  });
});

describe("given a SAML connection", () => {
  it("shows the three it takes, and never the redirect address", () => {
    const rows = serviceProviderRowsFor({ protocol: "saml", addresses: ADDRESSES });

    expect(rows.map((row) => row.label)).toEqual([
      "Assertion address",
      "Entity id",
      "Service provider metadata",
    ]);
    expect(rows.map((row) => row.value)).not.toContain(ADDRESSES.redirectUrl);
  });

  it("says what each one is for, so none of them is pasted by guess", () => {
    const rows = serviceProviderRowsFor({ protocol: "saml", addresses: ADDRESSES });

    for (const row of rows) {
      expect(row.hint.length).toBeGreaterThan(0);
      expect(row.value.length).toBeGreaterThan(0);
    }
  });
});
