import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import type { RpcChain } from "../definition.js";
import type { MountedRoute } from "../types.js";

// ---------------------------------------------------------------------------
// register(): an RPC endpoint is a dotted name mounted as a real POST. The
// name carries the verb so the method never does, and every argument travels
// in the JSON body. Versioning, forward-copying and withdrawal are untouched
// because endpoint identity is already `method:path`.
// ---------------------------------------------------------------------------

function buildRpcService() {
  const mounted: MountedRoute[] = [];
  const app = createService({
    name: "things",
    basePath: "/api/things",
    onRouteMounted: (route) => mounted.push(route),
  })
    .register(
      "things.create",
      "2026-08-07",
      async (_c, input: { name: string }) => input,
      (b) =>
        b
          .withInput(z.object({ name: z.string() }))
          .withOutput(z.object({ name: z.string() })),
    )
    .register(
      "things.list",
      "2026-08-07",
      async () => ["one"],
      (b) => b.withOutput(z.array(z.string())),
    )
    .build();
  return { app, mounted };
}

describe("register", () => {
  describe("given an RPC endpoint is registered", () => {
    describe("when the service builds", () => {
      it("mounts it as a POST at the dated and latest paths only", () => {
        const { mounted } = buildRpcService();

        const created = mounted
          .filter((r) => r.path.endsWith("/things.create"))
          .map((r) => `${r.method.toUpperCase()} ${r.path}`)
          .sort();

        // The bare alias is gone (ADR 002): every URL names its namespace.
        expect(created).toEqual([
          "POST /api/things/2026-08-07/things.create",
          "POST /api/things/latest/things.create",
        ]);
      });

      it("never mounts the RPC under its own name as a method", () => {
        const { mounted } = buildRpcService();

        expect(mounted.map((r) => r.method)).not.toContain("rpc");
      });
    });

    describe("when the endpoint is called", () => {
      it("answers a POST carrying its arguments in the body", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/2026-08-07/things.create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "widget" }),
        });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ name: "widget" });
      });

      it("refuses the GET the REST spelling would have used", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/2026-08-07/things.create");

        expect(res.status).toBe(404);
      });
    });

    /**
     * The zero-argument rule. An RPC with no required arguments declares no
     * `withInput`, so the pipeline installs no json validator and a bodyless
     * POST is accepted. `withInput(z.object({}).optional())` would reinstate
     * the parse and 4xx this call, which is why the rule forbids it.
     */
    describe("when an argument-free RPC is called with no body at all", () => {
      it("succeeds rather than failing body validation", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/2026-08-07/things.list", {
          method: "POST",
        });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual(["one"]);
      });

      it("also accepts an empty JSON object", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/2026-08-07/things.list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });

        expect(res.status).toBe(200);
      });
    });
  });

  describe("given a later version inherits an RPC endpoint", () => {
    function buildTwoVersionService() {
      return createService({ name: "things", basePath: "/api/things" })
        .register(
          "things.list",
          "2026-08-07",
          async () => ["old"],
          (b) => b.withOutput(z.array(z.string())),
        )
        .register(
          "things.get",
          "2026-08-07",
          async () => "kept",
          (b) => b.withOutput(z.string()),
        )
        .register(
          "things.count",
          "2026-08-07",
          async () => 1,
          (b) => b.withOutput(z.number()),
        )
        .register(
          "things.list",
          "2026-09-01",
          async () => ["new"],
          (b) => b.withOutput(z.array(z.string())),
        )
        .withdraw("things.get", "2026-09-01")
        .build();
    }

    it("forward-copies the untouched RPC into the newer version", async () => {
      const app = buildTwoVersionService();

      const res = await app.request("/api/things/2026-09-01/things.count", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toBe(1);
    });

    it("answers gone on the newer version for an RPC it withdrew", async () => {
      const app = buildTwoVersionService();

      const res = await app.request("/api/things/2026-09-01/things.get", {
        method: "POST",
      });

      expect(res.status).toBe(410);
    });

    it("serves the override on the newer version and the original on the older", async () => {
      const app = buildTwoVersionService();

      const newer = await app.request("/api/things/2026-09-01/things.list", {
        method: "POST",
      });
      const older = await app.request("/api/things/2026-08-07/things.list", {
        method: "POST",
      });

      await expect(newer.json()).resolves.toEqual(["new"]);
      await expect(older.json()).resolves.toEqual(["old"]);
    });
  });

  /**
   * The pipeline installs a validator for whichever of `params` / `query` a
   * definition declares. Left unchecked, an RPC could take arguments from the
   * URL — which is the one thing the dotted name is supposed to rule out — and
   * nothing would have said so. The casts are the case under test: a caller
   * the chain facade cannot reach.
   */
  describe("given an RPC definition that declares URL-borne arguments", () => {
    function registerWith(tamper: (b: RpcChain) => void): () => void {
      return () =>
        void createService({
          name: "things",
          basePath: "/api/things",
        }).register(
          "things.get",
          "2026-08-07",
          async () => "x",
          (b) => {
            tamper(b);
            return b.withOutput(z.string());
          },
        );
    }

    it("rejects a query schema", () => {
      expect(
        registerWith((b) => {
          (b as unknown as Record<string, (s: unknown) => void>).withQuery(
            z.object({ q: z.string() }),
          );
        }),
      ).toThrow(/declares query/);
    });

    it("rejects a params schema", () => {
      expect(
        registerWith((b) => {
          (b as unknown as Record<string, (s: unknown) => void>).withParams(
            z.object({ id: z.string() }),
          );
        }),
      ).toThrow(/declares params/);
    });

    it("accepts a body-only definition", () => {
      expect(() =>
        createService({ name: "things", basePath: "/api/things" }).register(
          "things.get",
          "2026-08-07",
          async (_c, input: { id: string }) => input.id,
          (b) => b.withInput(z.object({ id: z.string() })).withOutput(z.string()),
        ),
      ).not.toThrow();
    });
  });
});
