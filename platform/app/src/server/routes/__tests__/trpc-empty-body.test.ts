/**
 * @vitest-environment node
 *
 * Regression guard for langwatch#5219.
 *
 * Bug: the tRPC HTTP route could return a 0-byte response body. When an
 * exception escaped tRPC's `fetchRequestHandler` (a throw in `createContext`,
 * or a synchronous throw such as the ClickHouse "client not available" guard
 * at clickhouse-analytics.service.ts), tRPC never serialized a JSON error
 * body. The server-entry wiring (`routeThroughHono` in src/start.ts) then did
 * `res.end(await honoRes.text())`, which writes an EMPTY body when the Hono
 * response body is null. The browser tRPC client's `response.json()` then
 * threw `TRPCClientError: ... Unexpected end of JSON input`
 * (analytics.getTimeseries, ~271ms fast-fail).
 *
 * Two server-side guarantees are pinned here:
 *
 *   1. src/server/routes/trpc.ts wraps `fetchRequestHandler` in try/catch and
 *      returns a tRPC-shaped JSON error envelope on ANY throw, so the route
 *      itself never yields an empty/0-byte body and the client surfaces a
 *      proper TRPCClientError rather than a JSON-parse crash.
 *
 *   2. src/start.ts `routeThroughHono` never writes a 0-byte body even for a
 *      null-body Hono response — it falls back to a parseable JSON error.
 *
 * Red -> green is explicit on each surface below.
 *
 * @see src/server/routes/trpc.ts
 * @see src/start.ts (routeThroughHono)
 * @see src/server/api/trpc.ts (transformer: superjson, errorFormatter)
 */

import type { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "http";
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
 * Direct red -> green on the proven 0-byte sink: routeThroughHono's null-body
 * branch. We drive it with a fake Hono app that returns a null-body Response
 * and a fake ServerResponse that records exactly what bytes get written.
 *
 * RED (pre-fix): the branch was `res.end(await honoRes.text())`, which writes
 * "" for a null body -> 0 bytes -> client "Unexpected end of JSON input".
 * GREEN (post-fix): the branch writes a parseable JSON error instead.
 */
describe("routeThroughHono null-body guard (langwatch#5219)", () => {
  it("never writes a 0-byte body for a null-body non-404 response", async () => {
    const { routeThroughHono } = await import("~/start");

    // Hono app whose fetch yields a 500 with NO body — the exact shape that
    // used to produce res.end("").
    const honoApp = {
      fetch: vi.fn().mockResolvedValue(
        new Response(null, {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    } as unknown as Hono;

    // Minimal IncomingMessage: GET so routeThroughHono skips readBody.
    const req = {
      method: "GET",
      url: "/api/trpc/analytics.getTimeseries",
      headers: {},
    } as unknown as IncomingMessage;

    // Fake ServerResponse capturing the written payload + headers.
    const writes: Buffer[] = [];
    let ended = "";
    const headers: Record<string, string | number | string[]> = {};
    const res = {
      statusCode: 200,
      setHeader(key: string, value: string | number | string[]) {
        headers[key.toLowerCase()] = value;
      },
      getHeader(key: string) {
        return headers[key.toLowerCase()];
      },
      write(chunk: Buffer) {
        writes.push(chunk);
        return true;
      },
      end(chunk?: string) {
        if (chunk) ended = chunk;
      },
    } as unknown as ServerResponse;

    const handled = await routeThroughHono(
      honoApp,
      req,
      res,
      "localhost",
      3000,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);

    // The payload is everything streamed + ended. It MUST be non-empty.
    const streamed = Buffer.concat(writes).toString("utf8");
    const payload = streamed + ended;
    expect(payload.length).toBeGreaterThan(0);

    // ...and parseable JSON, so the client never throws on .json().
    expect(() => JSON.parse(payload)).not.toThrow();
  });

  /**
   * Regression guard for PR #5220: the null-body fallback must be gated on
   * STATUS, not merely `honoRes.body`. A 204/205/304 No-Content response
   * legitimately has `body === null` (e.g. gateway-internal 204 long-poll
   * no-diff, 304 revision-poll Not-Modified, 204 prompt-tag delete). Injecting
   * the `{ error, message }` JSON body into those breaks real clients — a 304
   * revision-poll would receive an "Internal server error" body on every
   * no-change poll.
   *
   * RED (status guard removed): the response falls into the JSON-error fallback
   * and `payload.length` is > 0 — this assertion fails.
   * GREEN (status guard present): 204/304 write NOTHING, payload stays empty.
   */
  it.each([
    204, 304,
  ])("writes a 0-byte body for a null-body %i No-Content response (no injected JSON)", async (status) => {
    const { routeThroughHono } = await import("~/start");

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

    const req = {
      method: "GET",
      url: "/api/prompts/v1",
      headers: {},
    } as unknown as IncomingMessage;

    const writes: Buffer[] = [];
    let ended = "";
    const headers: Record<string, string | number | string[]> = {};
    const res = {
      statusCode: 200,
      setHeader(key: string, value: string | number | string[]) {
        headers[key.toLowerCase()] = value;
      },
      getHeader(key: string) {
        return headers[key.toLowerCase()];
      },
      write(chunk: Buffer) {
        writes.push(chunk);
        return true;
      },
      end(chunk?: string) {
        if (chunk) ended = chunk;
      },
    } as unknown as ServerResponse;

    const handled = await routeThroughHono(
      honoApp,
      req,
      res,
      "localhost",
      3000,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(status);

    // No-Content statuses MUST stay empty — nothing injected.
    const streamed = Buffer.concat(writes).toString("utf8");
    const payload = streamed + ended;
    expect(payload.length).toBe(0);
  });
});
