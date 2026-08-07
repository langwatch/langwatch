/**
 * @vitest-environment node
 *
 * A request with no `Content-Length` must reach its handler.
 *
 * `hono/body-limit` measures such a body by draining it and then rebuilding the
 * request with `new Request(c.req.raw, { body })`. Under `@hono/node-server`
 * the incoming request is not an undici `Request`, so undici's constructor
 * throws reading a private field off it and the route answers 500. Every OTLP
 * signal, the collector, the legacy evaluation routes and scenario-events
 * carried that middleware, and the OpenTelemetry JS exporter sends
 * `Transfer-Encoding: chunked`, so a Node SDK pointed straight at the app had
 * every export refused.
 *
 * These run through `getRequestListener` with `overrideGlobalObjects: false`,
 * which is how `src/start.ts` mounts the API, and that option is the whole
 * trigger. Left at its default the adapter installs its own `Request` as the
 * process global, so hono's `new Request(...)` resolves to the same class the
 * adapter handed it and the reconstruction works. Pinned off, as it is here so
 * the app's globals stay untouched, the global is undici's while the request is
 * the adapter's, and undici refuses to read a foreign object. A test on plain
 * `serve()` or on `app.fetch` therefore passes against the broken middleware,
 * which is exactly how this reached production.
 *
 * Spec: specs/otlp/body-size-limits.feature
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit as honoBodyLimit } from "hono/body-limit";
import { afterEach, describe, expect, it } from "vitest";

import { bodyLimit } from "../bodyLimit";

const MAX = 1024;

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/** A listening app, mounted the way `src/start.ts` mounts it. */
async function listen(app: Hono): Promise<number> {
  const server = http.createServer(
    getRequestListener(app.fetch, { overrideGlobalObjects: false }),
  );
  servers.push(server);
  return await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

/**
 * POST without a `Content-Length`, which is what node's http client does when
 * you write a body it was not told the size of. This is the shape the whole
 * bug is about, so it is sent over a real socket rather than constructed.
 */
async function postChunked({
  port,
  path,
  body,
}: {
  port: number;
  path: string;
  body: string;
}): Promise<{ status: number; text: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** POST declaring its length, the path that always worked. */
async function postMeasured({
  port,
  path,
  body,
}: {
  port: number;
  path: string;
  body: string;
}): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
  return { status: res.status, text: await res.text() };
}

/** Echoes what the handler actually received, so a silently emptied body fails. */
function appWith(middleware: ReturnType<typeof bodyLimit>): Hono {
  const app = new Hono();
  app.post("/ingest", middleware, async (c) => {
    const raw = await c.req.raw.arrayBuffer();
    return c.json({ bytes: raw.byteLength, body: Buffer.from(raw).toString() });
  });
  return app;
}

describe("bodyLimit", () => {
  describe("given a request that declares no Content-Length", () => {
    /** @scenario "A sender that declares no length is served" */
    it("passes the whole body to the handler", async () => {
      const port = await listen(appWith(bodyLimit({ maxSize: MAX })));
      const body = JSON.stringify({ resourceSpans: [] });

      const res = await postChunked({ port, path: "/ingest", body });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.text)).toEqual({
        bytes: Buffer.byteLength(body),
        body,
      });
    });

    /** @scenario "An undeclared body is refused once it passes the cap" */
    it("refuses a body over the cap", async () => {
      const port = await listen(appWith(bodyLimit({ maxSize: MAX })));

      const res = await postChunked({
        port,
        path: "/ingest",
        body: "x".repeat(MAX + 1),
      });

      expect(res.status).toBe(413);
    });
  });

  describe("given a request that declares its Content-Length", () => {
    /** @scenario "A sender that declares its length is served" */
    it("passes a body within the cap", async () => {
      const port = await listen(appWith(bodyLimit({ maxSize: MAX })));
      const body = JSON.stringify({ ok: true });

      const res = await postMeasured({ port, path: "/ingest", body });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.text).body).toBe(body);
    });

    /** @scenario "A declared length over the cap is refused before the body is read" */
    it("refuses a declared length over the cap", async () => {
      const port = await listen(appWith(bodyLimit({ maxSize: MAX })));

      const res = await postMeasured({
        port,
        path: "/ingest",
        body: "x".repeat(MAX + 1),
      });

      expect(res.status).toBe(413);
    });
  });

  // The reason this module exists rather than re-exporting hono's. If this
  // ever stops failing, hono has fixed the reconstruction upstream and the
  // local copy can go.
  describe("given hono's own body-limit on the same request", () => {
    it("crashes on the chunked body this module handles", async () => {
      const port = await listen(appWith(honoBodyLimit({ maxSize: MAX })));

      const res = await postChunked({
        port,
        path: "/ingest",
        body: JSON.stringify({ resourceSpans: [] }),
      });

      expect(res.status).toBe(500);
    });
  });
});
