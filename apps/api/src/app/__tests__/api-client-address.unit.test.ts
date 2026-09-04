/**
 * @vitest-environment node
 *
 * Which address a request came from: the socket, unless the hop it arrived
 * from is one the deployment named.
 *
 * Two regressions are pinned here. The reader used to trust the first
 * forwarding header that PARSED, from any peer — so a caller sending
 * `cf-connecting-ip: 203.0.113.<n>` landed every sign-in attempt in its own
 * rate-limit bucket and never met the limit. And before that it built a
 * request stub with headers only, so the socket fallback was dead and every
 * header-less caller shared one bucket.
 *
 * @regression
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConnInfo } = vi.hoisted(() => ({ getConnInfo: vi.fn() }));
vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo }));

import { apiClientAddress, trpcClientAddress } from "../api-client-address";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("apiClientAddress()", () => {
  async function contextFrom(
    headers: Record<string, string>,
    options?: { trustedProxies?: readonly string[] },
  ) {
    let captured: unknown;
    const app = new Hono();
    app.get("/", (c) => {
      captured = options ? apiClientAddress(c, options) : apiClientAddress(c);
      return c.json({ ok: true });
    });
    await app.request("/", { headers });
    return captured as string | undefined;
  }

  describe("when a forwarding header arrives from a peer that is not a trusted proxy", () => {
    /** @scenario "A forwarding header from an untrusted peer is ignored" */
    it("keys on the socket address rather than on the header the caller chose", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "198.51.100.4" } });

      const ip = await contextFrom(
        { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.8" },
        { trustedProxies: [] },
      );

      expect(ip).toBe("198.51.100.4");
    });
  });

  describe("when the request arrives from a configured trusted proxy", () => {
    /** @scenario "A trusted proxy's chain resolves to the rightmost hop it did not write" */
    it("takes the rightmost hop of the chain that no trusted proxy wrote", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "10.0.0.9" } });

      const ip = await contextFrom(
        { "x-forwarded-for": "203.0.113.1, 198.51.100.23, 10.0.0.9" },
        { trustedProxies: ["10.0.0.9"] },
      );

      expect(ip).toBe("198.51.100.23");
    });

    it("accepts the proxy by IPv4 range as well as by address", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "10.4.7.2" } });

      const ip = await contextFrom(
        { "cf-connecting-ip": "198.51.100.77" },
        { trustedProxies: ["10.0.0.0/8"] },
      );

      expect(ip).toBe("198.51.100.77");
    });

    it("falls back to the proxy itself when every hop in the chain is a trusted proxy", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "10.0.0.9" } });

      const ip = await contextFrom(
        { "x-forwarded-for": "10.0.0.8, 10.0.0.9" },
        { trustedProxies: ["10.0.0.8", "10.0.0.9"] },
      );

      expect(ip).toBe("10.0.0.9");
    });
  });

  describe("when no trusted proxies are configured in the environment", () => {
    it("ignores the forwarding header the caller supplied", async () => {
      vi.stubEnv("TRUSTED_PROXY_ADDRESSES", "");
      getConnInfo.mockReturnValue({ remote: { address: "198.51.100.4" } });

      expect(await contextFrom({ "x-forwarded-for": "203.0.113.7" })).toBe("198.51.100.4");
    });
  });

  describe("when the environment names the proxy in front of this process", () => {
    it("reads the chain that proxy forwarded", async () => {
      vi.stubEnv("TRUSTED_PROXY_ADDRESSES", "198.51.100.4, 172.16.0.0/12");
      getConnInfo.mockReturnValue({ remote: { address: "198.51.100.4" } });

      expect(await contextFrom({ "x-forwarded-for": "203.0.113.7, 198.51.100.4" })).toBe(
        "203.0.113.7",
      );
    });
  });

  describe("when no proxy header is present and getConnInfo resolves a socket address", () => {
    it("falls back to the connection's remote address", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "203.0.113.9" } });
      const ip = await contextFrom({}, { trustedProxies: [] });
      expect(ip).toBe("203.0.113.9");
    });
  });

  describe("when getConnInfo throws", () => {
    it("returns undefined instead of crashing the request", async () => {
      // Mirrors app.request()/non-node-server adapters, where c.env carries
      // no `.incoming` and getConnInfo's property access throws.
      getConnInfo.mockImplementation(() => {
        throw new TypeError("Cannot read properties of undefined");
      });
      const ip = await contextFrom({ "x-forwarded-for": "203.0.113.7" }, { trustedProxies: [] });
      expect(ip).toBeUndefined();
    });
  });

  describe("when getConnInfo resolves an address that fails IP validation", () => {
    it("returns undefined rather than a malformed rate-limit key", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "not-an-ip" } });
      const ip = await contextFrom({}, { trustedProxies: [] });
      expect(ip).toBeUndefined();
    });
  });

  /** @scenario "The shared-trace limit reads the same resolver" */
  describe("when the shared-trace read resolves an address off the tRPC request", () => {
    it("ignores the forwarding header a caller sent to an untrusted peer", () => {
      const resolved = trpcClientAddress(
        {
          headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },
          socket: { remoteAddress: "198.51.100.9" },
        },
        { trustedProxies: [] },
      );

      expect(resolved).toBe("198.51.100.9");
    });

    it("reads the rightmost untrusted hop when the peer is a configured proxy", () => {
      const resolved = trpcClientAddress(
        {
          headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },
          socket: { remoteAddress: "198.51.100.9" },
        },
        { trustedProxies: ["198.51.100.9"] },
      );

      expect(resolved).toBe("203.0.113.7");
    });
  });
});
