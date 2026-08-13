import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createService } from "../builder.js";
import type { MountedRoute } from "../types.js";

// ---------------------------------------------------------------------------
// v.rpc (ADR-094): a pseudo-method that mounts as a real POST, following the
// v.sse precedent. The dotted name carries the verb, every argument travels in
// the body, and versioning / forward-copying / withdrawal are untouched because
// endpoint identity is already `${method}:${path}`.
// ---------------------------------------------------------------------------

function buildRpcService() {
  const mounted: MountedRoute[] = [];
  const app = createService({
    name: "things",
    basePath: "/api/things",
    onRouteMounted: (route) => mounted.push(route),
  })
    .version("2026-08-07", (v) => {
      v.rpc(
        "/things.create",
        {
          input: z.object({ name: z.string() }),
          output: z.object({ name: z.string() }),
          status: 201,
        },
        async (_c, { input }) => input,
      );
      v.rpc("/things.list", { output: z.array(z.string()) }, async () => [
        "one",
      ]);
    })
    .build();
  return { app, mounted };
}

describe("v.rpc", () => {
  describe("given an RPC endpoint is registered", () => {
    describe("when the service builds", () => {
      it("mounts it as a POST at the dated, latest and bare paths", () => {
        const { mounted } = buildRpcService();

        const created = mounted
          .filter((r) => r.path.endsWith("/things.create"))
          .map((r) => `${r.method.toUpperCase()} ${r.path}`)
          .sort();

        expect(created).toEqual([
          "POST /api/things/2026-08-07/things.create",
          "POST /api/things/latest/things.create",
          "POST /api/things/things.create",
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

        const res = await app.request("/api/things/things.create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "widget" }),
        });

        expect(res.status).toBe(201);
        await expect(res.json()).resolves.toEqual({ name: "widget" });
      });

      it("refuses the GET the REST spelling would have used", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/things.create");

        expect(res.status).toBe(404);
      });
    });

    /**
     * The zero-argument rule from ADR-094. An RPC with no required arguments
     * declares no `input`, so the pipeline installs no json validator and a
     * bodyless POST is accepted. `input: z.object({}).optional()` would
     * reinstate the parse and 4xx this call, which is why the ADR forbids it.
     */
    describe("when an argument-free RPC is called with no body at all", () => {
      it("succeeds rather than failing body validation", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/things.list", {
          method: "POST",
        });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual(["one"]);
      });

      it("also accepts an empty JSON object", async () => {
        const { app } = buildRpcService();

        const res = await app.request("/api/things/things.list", {
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
        .version("2026-08-07", (v) => {
          v.rpc("/things.list", { output: z.array(z.string()) }, async () => [
            "old",
          ]);
          v.rpc("/things.get", { output: z.string() }, async () => "kept");
        })
        .version("2026-09-01", (v) => {
          v.rpc("/things.list", { output: z.array(z.string()) }, async () => [
            "new",
          ]);
          v.withdraw("post", "/things.get");
        })
        .build();
    }

    it("forward-copies the untouched RPC into the newer version", async () => {
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

  describe("given a name that breaks the RPC grammar", () => {
    function register(path: string): () => void {
      return () =>
        void createService({ name: "things", basePath: "/api/things" })
          .version("2026-08-07", (v) => {
            v.rpc(path, { output: z.string() }, async () => "x");
          })
          .build();
    }

    it("rejects a REST-shaped path with a parameter", () => {
      expect(register("/endpoints/:id")).toThrow(/dotted <resource>\.<verb>/);
    });

    it("rejects a name with no dot at all", () => {
      expect(register("/endpoints")).toThrow(/dotted <resource>\.<verb>/);
    });

    it("rejects snake_case and PascalCase segments", () => {
      expect(register("/endpoints.roll_secret")).toThrow(
        /dotted <resource>\.<verb>/,
      );
      expect(register("/Endpoints.rollSecret")).toThrow(
        /dotted <resource>\.<verb>/,
      );
    });

    it("accepts a multi-dot lower camelCase name", () => {
      expect(register("/endpoints.deliveries.list")).not.toThrow();
    });

    /**
     * The reserved-namespace check still runs underneath the grammar, but it
     * has nothing to say about a dotted name — `latest` alone is reserved,
     * `latest.list` is an ordinary resource. Kept as a regression: widening
     * `assertRpcPath` must not open a hole in `assertEndpointPath`.
     */
    it("does not treat a dotted name as a version namespace", () => {
      expect(register("/latest.list")).not.toThrow();
    });
  });
});
