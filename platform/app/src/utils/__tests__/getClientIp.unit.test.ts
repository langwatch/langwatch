/**
 * @vitest-environment node
 *
 * Regression guard: `getClientIpFromHonoContext` used to build a
 * `NextApiRequest` stub with headers only, so its `req.socket?.remoteAddress`
 * fallback was permanently dead for every Hono caller. When no proxy header
 * was present (a caller behind no CDN/LB, or one that stripped them), the
 * resolved IP silently collapsed to "unknown" for every such caller, merging
 * them into a single shared rate-limit bucket. The fix falls back to
 * `getConnInfo` (the raw socket address `@hono/node-server` attaches to
 * `c.env.incoming`).
 *
 * @regression
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConnInfo } = vi.hoisted(() => ({ getConnInfo: vi.fn() }));
vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo }));

import { getClientIp, getClientIpFromHonoContext } from "../getClientIp";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClientIp()", () => {
  describe("when a trusted proxy header carries a valid IP", () => {
    it("prefers cf-connecting-ip over x-forwarded-for", () => {
      const ip = getClientIp({
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.1",
        },
      } as any);
      expect(ip).toBe("203.0.113.7");
    });

    it("takes the first entry of a comma-separated x-forwarded-for chain", () => {
      const ip = getClientIp({
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      } as any);
      expect(ip).toBe("203.0.113.7");
    });
  });

  describe("when the header value is not a valid IP", () => {
    it("falls through instead of returning garbage", () => {
      const ip = getClientIp({
        headers: { "x-forwarded-for": "not-an-ip" },
      } as any);
      expect(ip).toBeUndefined();
    });
  });

  describe("when no proxy header is present", () => {
    it("falls back to the request socket", () => {
      const ip = getClientIp({
        headers: {},
        socket: { remoteAddress: "203.0.113.9" },
      } as any);
      expect(ip).toBe("203.0.113.9");
    });

    it("returns undefined when the socket has no address either", () => {
      const ip = getClientIp({ headers: {}, socket: {} } as any);
      expect(ip).toBeUndefined();
    });
  });

  describe("when req is undefined", () => {
    it("returns undefined", () => {
      expect(getClientIp(undefined)).toBeUndefined();
    });
  });
});

describe("getClientIpFromHonoContext()", () => {
  async function contextFrom(headers: Record<string, string>) {
    let captured: unknown;
    const app = new Hono();
    app.get("/", (c) => {
      captured = getClientIpFromHonoContext(c);
      return c.json({ ok: true });
    });
    await app.request("/", { headers });
    return captured as string | undefined;
  }

  describe("when a proxy header is present", () => {
    it("resolves from the header without consulting getConnInfo", async () => {
      const ip = await contextFrom({ "x-forwarded-for": "203.0.113.7" });
      expect(ip).toBe("203.0.113.7");
      expect(getConnInfo).not.toHaveBeenCalled();
    });
  });

  describe("when no proxy header is present and getConnInfo resolves a socket address", () => {
    it("falls back to the connection's remote address", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "203.0.113.9" } });
      const ip = await contextFrom({});
      expect(ip).toBe("203.0.113.9");
    });
  });

  describe("when no proxy header is present and getConnInfo throws", () => {
    it("returns undefined instead of crashing the request", async () => {
      // Mirrors app.request()/non-node-server adapters, where c.env carries
      // no `.incoming` and getConnInfo's property access throws.
      getConnInfo.mockImplementation(() => {
        throw new TypeError("Cannot read properties of undefined");
      });
      const ip = await contextFrom({});
      expect(ip).toBeUndefined();
    });
  });

  describe("when getConnInfo resolves an address that fails IP validation", () => {
    it("returns undefined rather than a malformed rate-limit key", async () => {
      getConnInfo.mockReturnValue({ remote: { address: "not-an-ip" } });
      const ip = await contextFrom({});
      expect(ip).toBeUndefined();
    });
  });
});
