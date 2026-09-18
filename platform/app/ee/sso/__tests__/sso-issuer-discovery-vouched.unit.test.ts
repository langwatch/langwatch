/** @vitest-environment node */

/**
 * Asking a vouched issuer whether it is one.
 *
 * The guard refuses a private address because the issuer came off a form.
 * These are the cases where refusing it is the bug: an identity provider
 * inside the customer's own network, and the simulator a developer walks the
 * journey against. Both are addresses somebody named in advance.
 *
 * The third test is the one that keeps the other two honest. An allowlist
 * that survived a redirect would not be an allowlist, it would be a tunnel:
 * vouch for one origin and reach the whole network through whatever it
 * chooses to redirect at.
 *
 * Corresponds to specs/identity/sso-connection-lifecycle.feature.
 */
import { Response } from "undici";
import { describe, expect, it, vi } from "vitest";
import type { EgressFetch } from "~/server/app-layer/identity/public-egress";
import { HttpSsoIssuerDiscovery } from "../sso-issuer-discovery";

const DISCOVERY_DOCUMENT = {
  authorization_endpoint: "https://idp.internal.example/authorize",
  token_endpoint: "https://idp.internal.example/token",
};

/** A fetch that answers one discovery document and records where it was asked. */
function fetchAnswering(document: unknown) {
  const calls: string[] = [];
  const fetchImpl = vi.fn<EgressFetch>(async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(document), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchImpl, calls };
}

/** A fetch that redirects the first hop somewhere else, then answers. */
function fetchRedirectingTo(location: string) {
  const calls: string[] = [];
  const fetchImpl = vi.fn<EgressFetch>(async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location } });
    }
    return new Response(JSON.stringify(DISCOVERY_DOCUMENT), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchImpl, calls };
}

describe("given an issuer that answers inside a private network", () => {
  describe("when nobody vouched for it", () => {
    it("is not an address we will dial", async () => {
      const { fetchImpl, calls } = fetchAnswering(DISCOVERY_DOCUMENT);
      const discovery = new HttpSsoIssuerDiscovery(
        fetchImpl,
        async () => ["10.0.0.5"],
        [],
      );

      const outcome = await discovery.discover({
        issuer: "https://idp.internal.example",
      });

      expect(outcome).toEqual({
        reachable: false,
        reason: "not an address we will dial",
      });
      // Refused before a socket was opened, not after reading the answer.
      expect(calls).toEqual([]);
    });
  });

  describe("when an operator vouched for its origin", () => {
    /** @scenario "An issuer inside the network an operator vouched for is dialled" */
    it("is asked whether it is a provider", async () => {
      const { fetchImpl, calls } = fetchAnswering(DISCOVERY_DOCUMENT);
      const discovery = new HttpSsoIssuerDiscovery(
        fetchImpl,
        async () => ["10.0.0.5"],
        ["https://idp.internal.example"],
      );

      const outcome = await discovery.discover({
        issuer: "https://idp.internal.example",
      });

      expect(outcome).toEqual({ reachable: true });
      expect(calls).toEqual([
        "https://idp.internal.example/.well-known/openid-configuration",
      ]);
    });

    /** @scenario "An issuer inside the network an operator vouched for is dialled" */
    it("vouches for that origin only, not for its neighbours", async () => {
      const { fetchImpl } = fetchAnswering(DISCOVERY_DOCUMENT);
      const discovery = new HttpSsoIssuerDiscovery(
        fetchImpl,
        async () => ["10.0.0.6"],
        ["https://idp.internal.example"],
      );

      const outcome = await discovery.discover({
        issuer: "https://other.internal.example",
      });

      expect(outcome).toEqual({
        reachable: false,
        reason: "not an address we will dial",
      });
    });
  });
});

describe("given a vouched origin that redirects", () => {
  describe("when it redirects into the rest of our network", () => {
    /** @scenario "Vouching for an origin does not vouch for where it redirects" */
    it("judges the second hop on its own address and refuses", async () => {
      const { fetchImpl, calls } = fetchRedirectingTo(
        "https://169.254.169.254/latest/meta-data",
      );
      const discovery = new HttpSsoIssuerDiscovery(
        fetchImpl,
        async (host) =>
          host === "idp.internal.example" ? ["10.0.0.5"] : ["169.254.169.254"],
        ["https://idp.internal.example"],
      );

      const outcome = await discovery.discover({
        issuer: "https://idp.internal.example",
      });

      expect(outcome).toEqual({
        reachable: false,
        reason: "not an address we will dial",
      });
      // The vouched hop was dialled; the one it pointed at never was.
      expect(calls).toEqual([
        "https://idp.internal.example/.well-known/openid-configuration",
      ]);
    });
  });
});
