import { once } from "node:events";
import { createServer } from "node:http";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { ClientAddress } from "../../policy/client-address.ts";
import { SecurityHeaders } from "../../policy/security-headers.ts";
import { HttpMux } from "../http-mux.ts";

describe("given API and browser routes", () => {
  /** @scenario "The most specific route wins without rewriting the public URL" */
  it("selects the longest prefix regardless of declaration order and preserves API URLs", async () => {
    const api = new Hono().get("/api/project", (context) => context.text("project"));

    const mux = HttpMux.create()
      .route("/", () => new Response("browser"))
      .route("/api", api)
      .route("/api/trpc", () => new Response("trpc"));

    for (const [path, body, status] of [
      ["/api/project", "project", 200],
      ["/api/trpc/query", "trpc", 200],
      ["/api/missing", "404 Not Found", 404],
      ["/api", "404 Not Found", 404],
      ["/apiary", "browser", 200],
      ["/projects/one", "browser", 200],
    ] as const) {
      const response = await mux.fetch(new Request(`http://localhost${path}`));
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(body);
    }
  });

  /** @scenario "Preamble failures retain headers and surface-specific errors" */
  it("keeps security headers on middleware failures and selects the route's error presenter", async () => {
    const mux = HttpMux.create()
      .use({
        handle: () => {
          throw new Error("preamble failed");
        },
      })
      .use(SecurityHeaders.strict({ production: true }))
      .route("/", () => new Response("shell"), {
        onFailure: () => new Response("page error", { status: 500 }),
      })
      .route("/api", () => new Response("api"), {
        onFailure: () => Response.json({ error: "unknown" }, { status: 500 }),
      });

    const response = await mux.fetch(new Request("http://localhost/api/project"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "unknown" });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");

    expect(await (await mux.fetch(new Request("http://localhost/projects"))).text()).toBe(
      "page error",
    );
  });

  /** @scenario "Surface policies override headers and HEAD omits the body" */
  it("applies surface overrides and answers HEAD without a body", async () => {
    const mux = HttpMux.create()
      .use(SecurityHeaders.strict())
      .route("/", () => new Response("body", { headers: { "Referrer-Policy": "same-origin" } }));

    const response = await mux.fetch(new Request("http://localhost/", { method: "HEAD" }));
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.text()).toBe("");
    expect(() => mux.route("/late", () => new Response())).toThrow("sealed");
  });

  /** @scenario "Untrusted forwarding headers cannot replace the socket address" */
  it("passes the actual socket address into the trusted-proxy resolver", async () => {
    const mux = HttpMux.create()
      .use(ClientAddress.fromTrustedProxies({ addresses: [] }))
      .route("/", (request) => Response.json({ address: ClientAddress.resolvedFor(request) }));

    const server = createServer(mux.handler).listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");

      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        headers: { "x-forwarded-for": "198.51.100.7" },
      });

      expect(await response.json()).toEqual({ address: "127.0.0.1" });
    } finally {
      server.closeAllConnections();

      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  /** @scenario "A trusted proxy resolves the first untrusted forwarded hop" */
  it("resolves a forwarded caller only behind a configured proxy", async () => {
    const mux = HttpMux.create()
      .use(ClientAddress.fromTrustedProxies({ addresses: ["10.0.0.0/8"] }))
      .route("/", (request) => Response.json({ address: ClientAddress.resolvedFor(request) }));

    const response = await mux.fetch(
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.2" },
      }),
      "10.0.0.1",
    );

    expect(await response.json()).toEqual({ address: "198.51.100.7" });
  });
});

/** @scenario "A named target retains its error presenter" */
it("uses a named target's error policy when it is a prototype getter", async () => {
  class Target {
    fetch(): Response {
      throw new Error("failed");
    }
    get onFailure() {
      return () => new Response("target failure", { status: 500 });
    }
  }

  const response = await HttpMux.create()
    .route("/", new Target())
    .fetch(new Request("http://localhost/"));

  expect(await response.text()).toBe("target failure");
});

/** @scenario "Security header policy is case insensitive" */
it("overrides and removes security headers regardless of their spelling", () => {
  const strict = SecurityHeaders.strict();
  const policy = strict.with("x-frame-options", "SAMEORIGIN");
  expect(new Headers(policy.headers).get("X-Frame-Options")).toBe("SAMEORIGIN");
  expect(policy.without("X-FRAME-OPTIONS").read("x-frame-options")).toBeUndefined();
  expect(strict.read("X-Frame-Options")).toBe("DENY");
});
