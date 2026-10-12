import { describe, expect, it } from "vitest";

import { governanceGatewayBaseUrl } from "../governance.config.ts";

const noVendorBases = {
  openAiAdminApiBase: undefined,
  anthropicAdminApiBase: undefined,
  microsoftLoginBase: undefined,
  microsoftGraphApiBase: undefined,
  databricksWorkspaceBase: undefined,
  dataverseEnvironmentBase: undefined,
};

describe("where an issued personal key tells its holder to send traffic", () => {
  it("prefers the public gateway URL over the legacy base URL", () => {
    expect(
      governanceGatewayBaseUrl({
        config: {
          gatewayPublicUrl: "https://gw.example",
          gatewayInternalUrl: undefined,
          gatewayLegacyUrl: "https://old.example",
          isSaas: false,
          publicBaseUrl: undefined,
          blockLocalHttpCalls: false,
          allowedProxyHosts: [],
          ingestRateLimitDisabled: false,
          ...noVendorBases,
        },
      }),
    ).toBe("https://gw.example");
  });

  it("falls back to the legacy base URL, as main did", () => {
    expect(
      governanceGatewayBaseUrl({
        config: {
          gatewayPublicUrl: undefined,
          gatewayInternalUrl: undefined,
          gatewayLegacyUrl: "https://old.example",
          isSaas: false,
          publicBaseUrl: undefined,
          blockLocalHttpCalls: false,
          allowedProxyHosts: [],
          ingestRateLimitDisabled: false,
          ...noVendorBases,
        },
      }),
    ).toBe("https://old.example");
  });

  it("answers the hosted gateway on SaaS and the local one otherwise when neither is set", () => {
    const unset = {
      gatewayPublicUrl: undefined,
      gatewayInternalUrl: undefined,
      gatewayLegacyUrl: undefined,
      publicBaseUrl: undefined,
      blockLocalHttpCalls: false,
      allowedProxyHosts: [],
      ingestRateLimitDisabled: false,
      ...noVendorBases,
    };

    expect(governanceGatewayBaseUrl({ config: { ...unset, isSaas: true } })).toBe(
      "https://gateway.langwatch.ai",
    );
    expect(governanceGatewayBaseUrl({ config: { ...unset, isSaas: false } })).toBe(
      "http://localhost:5563",
    );
  });
});
