/**
 * @vitest-environment node
 *
 * Regression guard: `honoFetchForNode` (src/start.ts) is the exact function
 * `@hono/node-server`'s `getRequestListener` calls as `fetchCallback(req, {
 * incoming, outgoing })` — two arguments. A one-parameter wrapper silently
 * drops that second argument (JS call semantics don't error on unused extra
 * arguments), so every route handler's `c.env` was `undefined` in production,
 * making `@hono/node-server/conninfo`'s `getConnInfo(c)` throw unconditionally
 * (it reads `c.env.incoming.socket`) — dead code for any caller relying on it
 * (see `~/utils/getClientIp.ts`'s `getConnInfo` fallback). The fix forwards
 * every argument the wrapper receives straight through to `honoApp.fetch`.
 *
 * @regression
 */
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { honoFetchForNode } from "~/start";

describe("honoFetchForNode()", () => {
  describe("when called the way getRequestListener actually calls it", () => {
    it("forwards the second (env) argument to honoApp.fetch", async () => {
      const fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      const honoApp = { fetch } as unknown as Hono;
      const env = { incoming: { socket: {} }, outgoing: {} };

      await honoFetchForNode(honoApp)(new Request("http://localhost/"), env);

      expect(fetch).toHaveBeenCalledWith(expect.any(Request), env);
    });
  });

  describe("when called with only a request (existing single-arg call sites)", () => {
    it("still works, forwarding no extra arguments", async () => {
      const fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      const honoApp = { fetch } as unknown as Hono;

      const response = await honoFetchForNode(honoApp)(
        new Request("http://localhost/"),
      );

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(expect.any(Request));
    });
  });
});
