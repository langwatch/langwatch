/**
 * @vitest-environment node
 *
 * Which address a request came from, and the fallback that stops every
 * header-less caller sharing one rate-limit bucket.
 *
 * Regression guard: the application's reader used to build a request stub with
 * headers only, so its socket fallback was permanently dead for every Hono
 * caller. With no proxy header present — a caller behind no CDN or load
 * balancer, or one that stripped them — the resolved address silently
 * collapsed to "unknown" for all of them, merging every such caller into a
 * single bucket so the first to spend the window locked out the rest. The
 * fallback is `getConnInfo`, the raw socket address `@hono/node-server`
 * attaches to `c.env.incoming`.
 *
 * The `NextApiRequest` half of the old module did not come with it: this
 * process serves Hono and nothing else, and a reader for a request shape it
 * never sees would be an untested branch pretending to be coverage.
 *
 * @regression
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConnInfo } = vi.hoisted(() => ({ getConnInfo: vi.fn() }));
vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo }));

import { apiClientAddress } from "../api-client-address";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("apiClientAddress()", () => {
  async function contextFrom(headers: Record<string, string>) {
    let captured: unknown;
    const app = new Hono();
    app.get("/", (c) => {
      captured = apiClientAddress(c);
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
