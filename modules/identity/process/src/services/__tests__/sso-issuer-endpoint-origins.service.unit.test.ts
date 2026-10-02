/**
 * @vitest-environment node
 * The endpoint origins a registered issuer's discovery document names.
 * @see specs/identity/sso-issuer-endpoint-origins.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { SsoIssuerDiscoveryChannel } from "../../channels/sso-issuer-discovery.channel.ts";
import { SsoIssuerEndpointOriginsService } from "../sso-issuer-endpoint-origins.service.ts";

const GOOGLE = "https://accounts.google.com";
const GOOGLE_ENDPOINTS = [
  "https://accounts.google.com/o/oauth2/v2/auth",
  "https://oauth2.googleapis.com/token",
  "https://openidconnect.googleapis.com/v1/userinfo",
  "https://www.googleapis.com/oauth2/v3/certs",
];

const discoveryListing = (endpoints: string[]) => ({
  discover: vi.fn<SsoIssuerDiscoveryChannel["discover"]>(async () => ({
    reachable: true,
    endpoints,
  })),
});

const publicResolver = async () => ["142.250.185.78"];

describe("SsoIssuerEndpointOriginsService", () => {
  describe("when the discovery document serves endpoints from other origins", () => {
    /** @scenario "Google's endpoints on googleapis.com are trusted for a Google connection" */
    it("returns each https endpoint origin", async () => {
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: discoveryListing(GOOGLE_ENDPOINTS),
        resolveHost: publicResolver,
      });

      expect(await origins.findEndpointOrigins({ issuers: [GOOGLE] })).toEqual([
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        "https://openidconnect.googleapis.com",
        "https://www.googleapis.com",
      ]);
    });
  });

  describe("when an AWS Cognito user pool serves its endpoints from the hosted UI domain", () => {
    /** @scenario "An AWS Cognito user pool's hosted UI domain is trusted for its connection" */
    it("returns the hosted UI origin and the issuer's own origin", async () => {
      const pool = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Acme";
      const hostedUi = "https://acme.auth.eu-central-1.amazoncognito.com";
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: discoveryListing([
          `${hostedUi}/oauth2/authorize`,
          `${hostedUi}/oauth2/token`,
          `${hostedUi}/oauth2/userInfo`,
          `${hostedUi}/oauth2/revoke`,
          `${pool}/.well-known/jwks.json`,
        ]),
        resolveHost: async () => ["3.120.0.10"],
      });

      expect(await origins.findEndpointOrigins({ issuers: [pool] })).toEqual([
        hostedUi,
        "https://cognito-idp.eu-central-1.amazonaws.com",
      ]);
    });
  });

  describe("when an endpoint is plain http or resolves into a private network", () => {
    /** @scenario "An endpoint origin that is not public https is not trusted" */
    it("leaves it out", async () => {
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: discoveryListing([
          "https://idp.acme.example/authorize",
          "http://idp.acme.example/token",
          "https://metadata.acme.example/userinfo",
          "https://169.254.169.254/keys",
        ]),
        resolveHost: async (host) =>
          host === "metadata.acme.example" ? ["10.0.0.5"] : ["93.184.216.34"],
      });

      expect(await origins.findEndpointOrigins({ issuers: ["https://idp.acme.example"] })).toEqual([
        "https://idp.acme.example",
      ]);
    });

    it("keeps a private origin an operator vouched for", async () => {
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: discoveryListing(["https://idp.internal.acme/token"]),
        resolveHost: async () => ["10.0.0.5"],
        dialableInternalOrigins: () => ["https://idp.internal.acme"],
      });

      expect(await origins.findEndpointOrigins({ issuers: ["https://idp.internal.acme"] })).toEqual(
        ["https://idp.internal.acme"],
      );
    });

    it("leaves out a host that resolves to nothing", async () => {
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: discoveryListing(["https://gone.acme.example/token"]),
        resolveHost: async () => [],
      });

      expect(await origins.findEndpointOrigins({ issuers: [GOOGLE] })).toEqual([]);
    });
  });

  describe("when the same issuer is asked about again", () => {
    it("answers from the cache until the entry expires", async () => {
      let now = 0;
      const discovery = discoveryListing(GOOGLE_ENDPOINTS);
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery,
        resolveHost: publicResolver,
        now: () => now,
      });

      await origins.findEndpointOrigins({ issuers: [GOOGLE] });
      await origins.findEndpointOrigins({ issuers: [GOOGLE] });
      expect(discovery.discover).toHaveBeenCalledTimes(1);

      now = 11 * 60_000;
      await origins.findEndpointOrigins({ issuers: [GOOGLE] });
      expect(discovery.discover).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the issuer does not answer", () => {
    it("trusts nothing extra", async () => {
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: { discover: async () => ({ reachable: false, reason: "TimeoutError" }) },
        resolveHost: publicResolver,
      });

      expect(await origins.findEndpointOrigins({ issuers: [GOOGLE] })).toEqual([]);
    });

    it("trusts nothing extra when discovery throws", async () => {
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: {
          discover: async () => {
            throw new Error("boom");
          },
        },
        resolveHost: publicResolver,
      });

      expect(await origins.findEndpointOrigins({ issuers: [GOOGLE] })).toEqual([]);
    });
  });
});
