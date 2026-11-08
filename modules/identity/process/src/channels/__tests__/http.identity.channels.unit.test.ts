/**
 * @vitest-environment node
 * @see specs/identity/sso-issuer-endpoint-origins.feature
 * The per-sign-in trust lookup reads the discovery document on the SSO engine's route.
 */
import type * as Egress from "@langwatch/egress";
import { parseOutboundProxyConfig, type SsrfValidationResult } from "@langwatch/egress";
import { describe, expect, it, vi } from "vitest";

import { SsoIssuerEndpointOriginsService } from "../../features/sso-arrival/services/sso-issuer-endpoint-origins.service.ts";
import { issuerDiscoveryChannels } from "../http/http.identity.channels.ts";

const GOOGLE = "https://accounts.google.com";
const GOOGLE_DISCOVERY = {
  issuer: GOOGLE,
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
};
const PROXY = "http://proxy.corp.example:3128";

const { fetched } = vi.hoisted(() => ({ fetched: [] as { proxied: boolean }[] }));

/** The fence admits every public name, and the network behind it is a proxy that
 *  refuses the identity provider while a direct connection reaches it. */
vi.mock("@langwatch/egress", async (importOriginal) => {
  const actual = await importOriginal<typeof Egress>();
  const admitted = async (url: string): Promise<SsrfValidationResult> => {
    const parsed = new URL(url);
    return {
      type: "resolved",
      originalUrl: url,
      hostname: parsed.hostname,
      port: 443,
      protocol: parsed.protocol,
      path: parsed.pathname,
      resolvedIp: "142.250.185.78",
    };
  };
  return {
    ...actual,
    createSsrfUrlValidator: () => admitted,
    fetchValidatedDestination: async (
      _validated: SsrfValidationResult,
      init: { proxy?: { httpsProxy?: string } },
    ) => {
      const proxied = init.proxy?.httpsProxy !== undefined;
      fetched.push({ proxied });
      if (proxied) {
        throw new actual.OutboundProxyUnreachableError({
          proxy: new URL(PROXY),
          detail: "CONNECT refused with 403",
        });
      }
      return { ok: true, status: 200, json: async () => GOOGLE_DISCOVERY };
    },
  };
});

function channelsBehindRefusingProxy({ signInThroughProxy = false } = {}) {
  return issuerDiscoveryChannels({
    proxy: parseOutboundProxyConfig({ HTTPS_PROXY: PROXY }),
    signInThroughProxy,
    dialableInternalOrigins: () => [],
  });
}

describe("issuerDiscoveryChannels", () => {
  describe("given an outbound proxy that refuses the identity provider, and global fetch direct", () => {
    /** @scenario "Google's endpoints on googleapis.com are trusted for a Google connection" */
    it("trusts the cross-origin endpoints at sign-in, read without the proxy", async () => {
      fetched.length = 0;
      const channels = channelsBehindRefusingProxy();
      const origins = SsoIssuerEndpointOriginsService.create({
        discovery: channels.ssoSignInIssuerDiscovery,
        resolveHost: async () => ["142.250.185.78"],
      });

      expect(await origins.findEndpointOrigins({ issuers: [GOOGLE] })).toEqual([
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        "https://openidconnect.googleapis.com",
        "https://www.googleapis.com",
      ]);
      expect(fetched).toEqual([{ proxied: false }]);
    });

    /** @scenario "The sign-in trust lookup takes the route Node's fetch takes" */
    it("reads the sign-in lookup directly, as the SSO engine will", async () => {
      fetched.length = 0;
      const channels = channelsBehindRefusingProxy();

      await expect(
        channels.ssoSignInIssuerDiscovery.discover({ issuer: GOOGLE }),
      ).resolves.toMatchObject({ reachable: true });
      expect(fetched).toEqual([{ proxied: false }]);
    });

    /** @scenario "Registering a connection reads the discovery document through the outbound proxy" */
    it("keeps registration's discovery on the proxy", async () => {
      fetched.length = 0;
      const channels = channelsBehindRefusingProxy();

      await expect(
        channels.ssoRegistrationIssuerDiscovery.discover({ issuer: GOOGLE }),
      ).resolves.toEqual({
        reachable: false,
        reason: "proxy_unreachable",
      });
      expect(fetched).toEqual([{ proxied: true }]);
    });
  });

  describe("given Node sends global fetch through the proxy too", () => {
    /** @scenario "The sign-in trust lookup takes the route Node's fetch takes" */
    it("reads the sign-in lookup through the proxy, as the SSO engine will", async () => {
      fetched.length = 0;
      const channels = channelsBehindRefusingProxy({ signInThroughProxy: true });

      await expect(
        channels.ssoSignInIssuerDiscovery.discover({ issuer: GOOGLE }),
      ).resolves.toMatchObject({ reachable: false, reason: "proxy_unreachable" });
      expect(fetched).toEqual([{ proxied: true }]);
    });
  });
});
