/**
 * @vitest-environment node
 *
 * The case a hand-built `Request` cannot reach.
 *
 * `requestStatingCaller` first shipped as `new Request(request, { headers })`,
 * which is correct against a `Request` a test constructs and throws against the
 * one the server actually hands the route. Every unit test passed; every real
 * `/api/auth/*` request 500'd with "Cannot read private member #state".
 *
 * TWO THINGS HAVE TO BE TRUE TOGETHER for that, and a test that arranges only
 * one of them goes green while the bug is live:
 *
 *  1. The adapter hands the route a LAZY request, which materialises a real one
 *     only when something reads its body.
 *  2. `global.Request` is Node's own, so the constructor reaches for internals
 *     that lazy object does not have.
 *
 * `serve()` defaults to patching the globals, which fixes (2) and hides the
 * whole thing. `start.ts:245` passes `overrideGlobalObjects: false` on purpose
 * — "never patch the process's globals" — so production has both. This boots
 * the listener the same way, and is the reason it fails when the implementation
 * is wrong.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestStatingCaller } from "../caller-header";

/** What the handler downstream would see. */
type Seen = { forwardedFor: string | null; method: string; body: string };

let server: Server;
let origin: string;
let seen: Seen | null = null;
let failure: string | null = null;

beforeAll(async () => {
  const app = new Hono();

  app.all("/api/auth/*", async (c) => {
    try {
      // Exactly what the auth route does: restate the caller, then hand the
      // rebuilt request on to what would be Better Auth's handler.
      const stated = requestStatingCaller({
        request: c.req.raw,
        caller: c.req.header("x-test-caller") || undefined,
      });

      seen = {
        forwardedFor: stated.headers.get("x-forwarded-for"),
        method: stated.method,
        body: stated.body ? await stated.text() : "",
      };
      failure = null;
    } catch (error) {
      // Carried out rather than thrown: a 500 here reads as "the route is
      // broken", and the point of this test is to say WHY.
      failure = error instanceof Error ? error.message : String(error);
    }

    return c.json({ ok: true });
  });

  server = createServer(
    getRequestListener(app.fetch, { overrideGlobalObjects: false }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // `close()` alone waits for keep-alive sockets, and `fetch` leaves them open.
  // The unit lane runs files in a shared worker (`isolate: false`), so a
  // teardown that waits here does not just hang this file — it holds the worker
  // and starves whatever runs next.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("given a request delivered by the Node server adapter", () => {
  describe("when a caller resolved from the connection", () => {
    /** @scenario Better Auth counts the same caller the platform counts */
    it("hands the handler that caller, over what the caller claimed", async () => {
      const response = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.8",
          "x-test-caller": "198.51.100.11",
        },
        body: JSON.stringify({ email: "sam@acme.com", password: "hunter2" }),
      });

      expect(response.status).toBe(200);
      expect(failure).toBeNull();
      expect(seen?.forwardedFor).toBe("198.51.100.11");
      expect(seen?.method).toBe("POST");
      expect(seen?.body).toBe(
        JSON.stringify({ email: "sam@acme.com", password: "hunter2" }),
      );
    });
  });

  describe("when no caller could be resolved", () => {
    it("strips what the caller claimed rather than passing it on", async () => {
      const response = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.8",
        },
        body: JSON.stringify({ email: "sam@acme.com" }),
      });

      expect(response.status).toBe(200);
      expect(failure).toBeNull();
      expect(seen?.forwardedFor).toBeNull();
    });
  });

  describe("when the request carries no body", () => {
    it("rebuilds a GET the adapter delivered without one", async () => {
      const response = await fetch(`${origin}/api/auth/session`, {
        headers: { "x-test-caller": "198.51.100.11" },
      });

      expect(response.status).toBe(200);
      expect(failure).toBeNull();
      expect(seen?.forwardedFor).toBe("198.51.100.11");
      expect(seen?.method).toBe("GET");
    });
  });
});
