// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The addresses a customer pastes into their identity provider. One entity id
 * for the whole deployment, per-connection paths for the rest, and an honest
 * placeholder before there is a connection to key them on.
 */
import { describe, expect, it } from "vitest";

import { ssoServiceProviderAddresses } from "../sso-service-provider.rules.ts";

describe("the addresses this deployment answers on", () => {
  it("keys every per-provider path on the connection", () => {
    const addresses = ssoServiceProviderAddresses({
      baseUrl: "https://app.acme.test",
      connectionId: "connection-1",
    });

    expect(addresses).toEqual({
      redirectUrl: "https://app.acme.test/api/auth/sso/callback/connection-1",
      assertionConsumerServiceUrl: "https://app.acme.test/api/auth/sso/saml2/sp/acs/connection-1",
      singleLogoutUrl: "https://app.acme.test/api/auth/sso/saml2/sp/slo/connection-1",
      entityId: "https://app.acme.test/api/auth/sso/saml2/sp",
      metadataUrl: "https://app.acme.test/api/auth/sso/saml2/sp/metadata?providerId=connection-1",
    });
  });

  it("names one service provider for the deployment, whatever the connection", () => {
    const first = ssoServiceProviderAddresses({ baseUrl: "https://a.test", connectionId: "one" });
    const second = ssoServiceProviderAddresses({ baseUrl: "https://a.test", connectionId: "two" });

    expect(first.entityId).toBe(second.entityId);
  });

  it("shows where the identifier will go rather than inventing one", () => {
    const addresses = ssoServiceProviderAddresses({
      baseUrl: "https://app.acme.test",
      connectionId: null,
    });

    expect(addresses.redirectUrl).toBe("https://app.acme.test/api/auth/sso/callback/{connection}");
    expect(addresses.metadataUrl).toContain("providerId={connection}");
  });

  it("does not double the slash a base address ends on", () => {
    const addresses = ssoServiceProviderAddresses({
      baseUrl: "https://app.acme.test//",
      connectionId: "connection-1",
    });

    expect(addresses.redirectUrl).toBe("https://app.acme.test/api/auth/sso/callback/connection-1");
  });
});
