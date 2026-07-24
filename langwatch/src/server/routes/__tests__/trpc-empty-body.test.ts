/**
 * @vitest-environment node
 *
 * Regression guard for langwatch#5219.
 *
 * Bug: the tRPC HTTP route could return a 0-byte response body. When an
 * exception escaped tRPC's `fetchRequestHandler` (a throw in `createContext`,
 * or a synchronous throw such as the ClickHouse "client not available" guard
 * at clickhouse-analytics.service.ts), tRPC never serialized a JSON error
 * body, and the server-entry bridge wrote the null Hono body to the wire as
 * an EMPTY response. The browser tRPC client's `response.json()` then threw
 * `TRPCClientError: ... Unexpected end of JSON input`
 * (analytics.getTimeseries, ~271ms fast-fail).
 *
 * Two server-side guarantees are pinned here:
 *
 *   1. src/server/routes/trpc.ts wraps `fetchRequestHandler` in try/catch and
 *      returns a tRPC-shaped JSON error envelope on ANY throw, so the route
 *      itself never yields an empty/0-byte body and the client surfaces a
 *      proper TRPCClientError rather than a JSON-parse crash.
 *
 *   2. src/start.ts `honoFetchForNode` (the fetch wrapper the Node server
 *      mounts via @hono/node-server's getRequestListener) never lets a
 *      null-body response through on a status that should carry a body — it
 *      substitutes a parseable JSON error.
 *
 * Red -> green is explicit on each surface below.
 *
 * @see src/server/routes/trpc.ts
 * @see src/start.ts (honoFetchForNode)
 * @see src/server/api/trpc.ts (transformer: superjson, errorFormatter)
 */

import type { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchRequestHandler is the adapter the route delegates to. We replace it
// with a throwing stub so the route takes its error path. The mock is hoisted
// by vitest above the route module import below.
const fetchRequestHandler = vi.fn();
vi.mock("@trpc/server/adapters/fetch", () => ({
  fetchRequestHandler: (...args: unknown[]) => fetchRequestHandler(...args),
}));

// Force "no session" so createContext's auth lookup is inert; the throw we
// care about comes from the mocked adapter, not from auth.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null),
}));

const BOOM = "client not available"; // mirrors the ClickHouse synchronous throw

describe("tRPC route empty-body guard (langwatch#5219)", () => {
  beforeEach(() => {
    fetchRequestHandler.mockReset();
  });

  describe("when fetchRequestHandler throws", () => {
    /**
     * GREEN (post-fix): the route's try/catch returns a tRPC error envelope.
     *
     * RED (pre-fix): the throw escaped the handler. Hono's onError returns a
     * generic `{ error: "Internal server error", message }` shape whose
     * `error` is a STRING, so `body.error.json` is undefined — and in the
     * raw repro the body could be 0 bytes once it reached routeThroughHono.
     * Either way `body.error?.json?.data?.code` is NOT
     * "INTERNAL_SERVER_ERROR", so this assertion fails before the fix.
     */
    it("returns a NON-EMPTY, JSON-parseable tRPC error envelope with a 5xx status", async () => {
      fetchRequestHandler.mockImplementation(() => {
        throw new Error(BOOM);
      });

      const { app } = await import("~/server/routes/trpc");

      const res = await app.request(
        "http://localhost/api/trpc/analytics.getTimeseries",
        { method: "GET" },
      );

      // Body must never be empty (the root of "Unexpected end of JSON input").
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);

      // It must be parseable JSON — re-parse the text we already read.
      const body = JSON.parse(text) as {
        error?: {
          json?: {
            message?: string;
            code?: number;
            data?: { code?: string; httpStatus?: number };
          };
        };
      };

      // 5xx status.
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).toBeLessThan(600);

      // tRPC-shaped envelope (superjson `json` wrapper) so the client decodes
      // it into a TRPCClientError instead of throwing a parse error.
      expect(body.error?.json?.data?.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error?.json?.data?.httpStatus).toBe(500);
      expect(typeof body.error?.json?.message).toBe("string");
      expect(body.error?.json?.message).toContain(BOOM);
    });
  });
});

/**
 * Direct red -> green on the proven 0-byte sink: the server entry's fetch
 * wrapper (`honoFetchForNode`). We drive it with a fake Hono app that returns
 * a null-body Response and assert on the Response the wrapper hands to
 * @hono/node-server's listener — which writes exactly that body to the wire.
 *
 * RED (pre-fix): the null body passed through -> 0 bytes on the wire ->
 * client "Unexpected end of JSON input".
 * GREEN (post-fix): the wrapper substitutes a parseable JSON error.
 */
describe("honoFetchForNode null-body guard (langwatch#5219)", () => {
  it("never returns a null-body non-404 response on a status that should carry a body", async () => {
    const { honoFetchForNode } = await import("~/start");

    // Hono app whose fetch yields a 500 with NO body — the exact shape that
    // used to reach the wire as 0 bytes.
    const honoApp = {
      fetch: vi.fn().mockResolvedValue(
        new Response(null, {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    } as unknown as Hono;

    const response = await honoFetchForNode(honoApp)(
      new Request("http://localhost/api/trpc/analytics.getTimeseries"),
    );

    expect(response.status).toBe(500);

    // The body MUST be non-empty...
    const payload = await response.text();
    expect(payload.length).toBeGreaterThan(0);

    // ...and parseable JSON, so the client never throws on .json().
    expect(() => JSON.parse(payload)).not.toThrow();
  });

  /**
   * Regression guard for PR #5220: the null-body fallback must be gated on
   * STATUS, not merely a null body. A 204/205/304 No-Content response
   * legitimately has `body === null` (e.g. gateway-internal 204 long-poll
   * no-diff, 304 revision-poll Not-Modified, 204 prompt-tag delete). Injecting
   * the `{ error, message }` JSON body into those breaks real clients — a 304
   * revision-poll would receive an "Internal server error" body on every
   * no-change poll.
   *
   * RED (status guard removed): the response falls into the JSON-error fallback
   * and the body is non-null — this assertion fails.
   * GREEN (status guard present): 204/304 pass through with a null body.
   */
  it.each([204, 304])(
    "passes a null-body %i No-Content response through untouched (no injected JSON)",
    async (status) => {
      const { honoFetchForNode } = await import("~/start");

      // No-Content response: null body, as Hono's `c.body(null, 204|304)`
      // produces at the real call sites.
      const honoApp = {
        fetch: vi.fn().mockResolvedValue(
          new Response(null, {
            status,
            headers: { "X-LangWatch-Revision": "42" },
          }),
        ),
      } as unknown as Hono;

      const response = await honoFetchForNode(honoApp)(
        new Request("http://localhost/api/prompts/v1"),
      );

      expect(response.status).toBe(status);
      // No-Content statuses MUST stay empty — nothing injected.
      expect(response.body).toBeNull();
      expect(response.headers.get("X-LangWatch-Revision")).toBe("42");
    },
  );

  it("turns Hono's default not-found sentinel into the uniform JSON 404", async () => {
    const { honoFetchForNode } = await import("~/start");

    const honoApp = {
      fetch: vi
        .fn()
        .mockResolvedValue(new Response("404 Not Found", { status: 404 })),
    } as unknown as Hono;

    const response = await honoFetchForNode(honoApp)(
      new Request("http://localhost/api/nope"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
  });

  it("passes a route's own 404 body through untouched", async () => {
    const { honoFetchForNode } = await import("~/start");

    const honoApp = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "prompt not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    } as unknown as Hono;

    const response = await honoFetchForNode(honoApp)(
      new Request("http://localhost/api/prompts/v1/nope"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "prompt not found" });
  });
});
