/**
 * The four capabilities a family needed a raw Hono app for: the exact request
 * bytes, an answer outside the JSON contract, headers of its own, and one path
 * answering every method. Spec: packages/api/specs/endpoint-capabilities.feature.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import { declined } from "../response.js";

function service() {
  return createService({ name: "toy-raw", logger: false, tracer: false });
}

const at = (path: string) => `/api/toy-raw/2026-08-07${path}`;

describe("withRawBody", () => {
  describe("given a body that IS the evidence", () => {
    /** @scenario "A handler is given the exact request bytes" */
    it("hands the handler the exact bytes, and reads them exactly once", async () => {
      const seen: { bytes: number[]; digest: string }[] = [];
      const app = service()
        .registerRoute(
          "post",
          "/hook",
          "2026-08-07",
          async (_c, input: { body: Uint8Array }) => {
            seen.push({
              bytes: [...input.body],
              digest: new TextDecoder().decode(input.body),
            });
            return { ok: true };
          },
          (b) => b.withRawBody("bytes").withOutput(z.object({ ok: z.boolean() })),
        )
        .build();

      const response = await app.request(at("/hook"), {
        method: "POST",
        // Deliberately not the JSON a parser would hand back: the signature a
        // sender computed is over these bytes, spacing included.
        body: '{ "a" :  1 }',
        headers: { "content-type": "application/json" },
      });

      expect(response.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.digest).toBe('{ "a" :  1 }');
    });

    /** @scenario "A handler is given the exact request bytes" */
    it("hands text when text is what was declared, beside validated path params", async () => {
      const app = service()
        .registerRoute(
          "post",
          "/hooks/:id",
          "2026-08-07",
          async (_c, input: { id: string; body: string }) => ({
            id: input.id,
            length: input.body.length,
          }),
          (b) =>
            b
              .withParams(z.object({ id: z.string() }))
              .withRawBody("text")
              .withOutput(z.object({ id: z.string(), length: z.number() })),
        )
        .build();

      const response = await app.request(at("/hooks/hook-1"), { method: "POST", body: "abcde" });

      expect(await response.json()).toEqual({ id: "hook-1", length: 5 });
    });
  });

  describe("given a route declares both a raw body and a parsed one", () => {
    /** @scenario "A handler is given the exact request bytes" */
    it("refuses to build, because the body is read once", () => {
      expect(() =>
        service()
          .registerRoute(
            "post",
            "/hook",
            "2026-08-07",
            async () => ({ ok: true }),
            (b) =>
              b
                .withRawBody("bytes")
                .withInput(z.object({ a: z.number() }))
                .withOutput(z.object({ ok: z.boolean() })),
          )
          .build(),
      ).toThrow(/declares both a raw body and a parsed input/);
    });
  });
});

describe("withRawResponse", () => {
  describe("given an answer that is not this framework's JSON", () => {
    /** @scenario "An endpoint answers outside the JSON contract when it declares why" */
    it("writes the handler's own value with the declared content type", async () => {
      const app = service()
        .registerRoute(
          "get",
          "/llms.txt",
          "2026-08-07",
          async () => "# LangWatch\n",
          (b) =>
            b.withRawResponse("the agent discovery file is text", { contentType: "text/plain" }),
        )
        .build();

      const response = await app.request(at("/llms.txt"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(await response.text()).toBe("# LangWatch\n");
    });

    /** @scenario "An endpoint answers outside the JSON contract when it declares why" */
    it("passes a whole Response through untouched, for a redirect or a 304", async () => {
      const app = service()
        .registerRoute(
          "get",
          "/authorize",
          "2026-08-07",
          async () =>
            new Response(null, { status: 302, headers: { location: "https://example.test/next" } }),
          (b) => b.withRawResponse("the OAuth authorize step redirects the browser"),
        )
        .build();

      const response = await app.request(at("/authorize"));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://example.test/next");
    });

    /** @scenario "An endpoint answers outside the JSON contract when it declares why" */
    it("refuses a route that declares both a schema and a raw answer", () => {
      expect(() =>
        service()
          .registerRoute(
            "get",
            "/both",
            "2026-08-07",
            async () => "x",
            (b) => b.withOutput(z.string()).withRawResponse("probe"),
          )
          .build(),
      ).toThrow(/declares both an output schema and a raw response/);
    });

    /** @scenario "An endpoint answers outside the JSON contract when it declares why" */
    it("refuses a raw answer with no written reason", () => {
      expect(() =>
        service().registerRoute(
          "get",
          "/why",
          "2026-08-07",
          async () => "x",
          (b) => b.withRawResponse("   "),
        ),
      ).toThrow(/requires a written reason/);
    });
  });
});

describe("withHeaders", () => {
  /** @scenario "An endpoint declares the headers every answer carries" */
  it("sets them on the answer, beside the framework's own", async () => {
    const app = service()
      .registerRoute(
        "get",
        "/asset",
        "2026-08-07",
        async () => ({ ok: true }),
        (b) =>
          b
            .withOutput(z.object({ ok: z.boolean() }))
            .withHeaders({ "Cache-Control": "public, max-age=3600" }),
      )
      .build();

    const response = await app.request(at("/asset"));

    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("X-API-Version")).toBe("2026-08-07");
  });
});

describe("a header that differs per answer", () => {
  /** @scenario "An endpoint declares the headers every answer carries" */
  it("is set by the handler with c.header, and survives the declared output", async () => {
    const app = service()
      .registerRoute(
        "post",
        "/calls",
        "2026-08-07",
        async (c, input: { retryAfter?: number }) => {
          // A per-answer header needs no seam of its own: the framework
          // serialises through the same context the handler set it on.
          if (input.retryAfter !== undefined) c.header("Retry-After", String(input.retryAfter));
          return { queued: input.retryAfter !== undefined };
        },
        (b) =>
          b
            .withInput(z.object({ retryAfter: z.number().optional() }))
            .withOutput(z.object({ queued: z.boolean() })),
      )
      .build();

    const throttled = await app.request(at("/calls"), {
      method: "POST",
      body: JSON.stringify({ retryAfter: 30 }),
      headers: { "content-type": "application/json" },
    });
    const accepted = await app.request(at("/calls"), {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    expect(throttled.headers.get("retry-after")).toBe("30");
    expect(await throttled.json()).toEqual({ queued: true });
    expect(accepted.headers.get("retry-after")).toBeNull();
  });
});

describe("registerAnyMethodRoute", () => {
  /** @scenario "One path answers every method when that is the surface" */
  it("answers whatever method arrives, and publishes no operation", async () => {
    const methods: string[] = [];
    const app = service()
      .registerAnyMethodRoute(
        "/unsubscribe",
        "2026-08-07",
        async (c) => {
          methods.push(c.req.method);
          return c.req.method === "GET"
            ? new Response("ok", { status: 200 })
            : new Response(null, { status: 405, headers: { allow: "GET" } });
        },
        (b) => b.withoutPermission("the unsubscribe link carries its own signed token"),
      )
      .build();

    const read = await app.request(at("/unsubscribe"));
    const wrong = await app.request(at("/unsubscribe"), { method: "DELETE" });

    expect(read.status).toBe(200);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
    expect(methods).toEqual(["GET", "DELETE"]);
  });
});

describe("an any-method route that declines", () => {
  /** @scenario "An any-method route declines a request that is not its own" */
  it("hands the request to what is mounted after it, which answers as it always did", async () => {
    const seen: string[] = [];
    const alias = createService({
      name: "toy-alias",
      basePath: "/",
      bareMount: true,
      logger: false,
      tracer: false,
    })
      .registerAnyMethodRoute(
        "/api/aliased/*",
        "2026-08-07",
        async (c) => {
          seen.push(c.req.path);
          if (!c.req.path.endsWith("/known")) return declined();
          return new Response("rewritten", { status: 200 });
        },
        (b) => b.withoutPermission("the alias terminates nothing; it rewrites and forwards"),
      )
      .build();

    const host = new Hono();
    host.route("/", alias as never);
    host.get("/api/aliased/its-own", (c) => c.text("the namespace behind the alias", 200));

    const rewritten = await host.request("/api/aliased/known");
    const passedOn = await host.request("/api/aliased/its-own");
    const unknown = await host.request("/api/aliased/nobody-owns-this");

    expect(await rewritten.text()).toBe("rewritten");
    expect(await passedOn.text()).toBe("the namespace behind the alias");
    expect(unknown.status).toBe(404);
    expect(seen).toEqual([
      "/api/aliased/known",
      "/api/aliased/its-own",
      "/api/aliased/nobody-owns-this",
    ]);
  });
});
