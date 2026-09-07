import { describe, expect, it } from "vitest";
import { HttpSsoIssuerDiscovery } from "../sso-issuer-discovery";

/**
 * Asking an issuer whether it is one, without asking our own network
 * (specs/identity/sso-idp-termination.feature).
 *
 * The issuer is a string an organization administrator typed into a
 * registration form, and this process is what dials it. Unguarded, that is an
 * authenticated port scanner: the three answers this port gives back —
 * `answered 403`, `answered 200`, `TimeoutError` — tell the caller whether
 * something is listening at whatever address they named, which is the whole
 * of a reachability oracle. The file-proof ceremony next door grew the guard
 * that stops this; for a while this one did not have it, and the cases below
 * are what keep them the same guard.
 */

const DISCOVERY_URL =
  "https://login.acme.okta.com/.well-known/openid-configuration";

const validDocument = () =>
  new Response(
    JSON.stringify({
      authorization_endpoint: "https://login.acme.okta.com/authorize",
      token_endpoint: "https://login.acme.okta.com/token",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

function discoveryAnswering({
  respond = async () => validDocument(),
  resolveTo = async () => ["93.184.216.34"],
}: {
  respond?: () => Promise<Response>;
  resolveTo?: (host: string) => Promise<string[]>;
} = {}) {
  const asked: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return respond();
  }) as typeof fetch;
  return {
    discovery: new HttpSsoIssuerDiscovery(fetchImpl, resolveTo),
    asked,
  };
}

describe("given an issuer that answers a discovery document", () => {
  describe("when it is reachable and looks like a provider", () => {
    it("reports it reachable", async () => {
      const { discovery, asked } = discoveryAnswering();

      expect(
        await discovery.discover({ issuer: "https://login.acme.okta.com" }),
      ).toEqual({ reachable: true });
      expect(asked).toEqual([DISCOVERY_URL]);
    });
  });

  describe("when it answers something that is not a provider", () => {
    it("says so rather than accepting it", async () => {
      const { discovery } = discoveryAnswering({
        respond: async () =>
          new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
      });

      expect(
        await discovery.discover({ issuer: "https://login.acme.okta.com" }),
      ).toEqual({ reachable: false, reason: "answered something else" });
    });
  });
});

describe("given an issuer aimed at our own network", () => {
  describe("when it names a private address outright", () => {
    it("never connects", async () => {
      const { discovery, asked } = discoveryAnswering();

      const result = await discovery.discover({
        issuer: "https://169.254.169.254/latest/meta-data",
      });

      expect(result.reachable).toBe(false);
      // The CONNECTION that did not happen is the point. A blind fetch still
      // answers a reachability and port oracle for whatever it reached.
      expect(asked).toEqual([]);
    });
  });

  describe("when a public name resolves into private space", () => {
    it("refuses on the resolved address, not the string", async () => {
      const { discovery, asked } = discoveryAnswering({
        resolveTo: async () => ["10.0.0.5"],
      });

      const result = await discovery.discover({
        issuer: "https://issuer.acme.com",
      });

      expect(result.reachable).toBe(false);
      expect(asked).toEqual([]);
    });
  });

  describe("when it is plain http", () => {
    it("refuses, because a document read over http could be anybody's", async () => {
      const { discovery, asked } = discoveryAnswering();

      const result = await discovery.discover({
        issuer: "http://169.254.169.254/latest/meta-data",
      });

      expect(result).toEqual({
        reachable: false,
        reason: "unsupported scheme http:",
      });
      expect(asked).toEqual([]);
    });
  });

  describe("when a public issuer redirects into private space", () => {
    it("stops at the hop rather than following it", async () => {
      // A redirect is a string the customer's own server chooses at request
      // time. `redirect: "follow"` would hand the whole journey to the
      // runtime, which follows a 302 into the metadata endpoint happily.
      const { discovery, asked } = discoveryAnswering({
        respond: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/latest/meta-data" },
          }),
      });

      const result = await discovery.discover({
        issuer: "https://login.acme.okta.com",
      });

      expect(result.reachable).toBe(false);
      // The first hop is the issuer the administrator typed; the second is
      // not made at all.
      expect(asked).toEqual([DISCOVERY_URL]);
    });
  });

  describe("when the refusal is reported back", () => {
    it("says one thing, whichever guard refused", async () => {
      // Which internal name resolved where is not something the person
      // typing an issuer gets to learn from us.
      const privateLiteral = await discoveryAnswering().discovery.discover({
        issuer: "https://10.0.0.5:9200",
      });
      const { discovery } = discoveryAnswering({
        resolveTo: async () => {
          throw Object.assign(new Error("nope"), { code: "EAI_AGAIN" });
        },
      });
      const unresolvable = await discovery.discover({
        issuer: "https://issuer.acme.com",
      });

      expect(privateLiteral).toEqual(unresolvable);
    });
  });

  describe("when the resolver cannot answer", () => {
    it("refuses rather than letting the fetch decide", async () => {
      // Failing closed: a guard that can be skipped by making it throw is
      // not a guard, and a transient EAI_AGAIN did it by accident.
      const { discovery, asked } = discoveryAnswering({
        resolveTo: async () => {
          throw Object.assign(new Error("resolver is busy"), {
            code: "EAI_AGAIN",
          });
        },
      });

      const result = await discovery.discover({
        issuer: "https://issuer.acme.com",
      });

      expect(result.reachable).toBe(false);
      expect(asked).toEqual([]);
    });
  });
});
