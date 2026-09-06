import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createService } from "../builder.js";
import type { MountedRoute } from "../types.js";

// ---------------------------------------------------------------------------
// onRouteMounted contract: one callback per mounted route, with the absolute
// path exactly as the Hono route table reports it. The app builds its route
// policy registry from these callbacks, so completeness (guards and withdrawn
// mounts included) is the whole point.
// ---------------------------------------------------------------------------

const GUARD_PATH =
  "/api/test/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
const GUARD_WILDCARD_PATH = `${GUARD_PATH}/*`;

type Summary = Pick<
  MountedRoute,
  "method" | "path" | "version" | "status" | "withdrawn"
> & { isNamespaceGuard: boolean };

function summarize(route: MountedRoute): Summary {
  return {
    method: route.method,
    path: route.path,
    version: route.version,
    status: route.status,
    withdrawn: route.withdrawn,
    isNamespaceGuard: route.isNamespaceGuard ?? false,
  };
}

function bySummary(a: Summary, b: Summary): number {
  return (
    a.path.localeCompare(b.path) ||
    a.method.localeCompare(b.method) ||
    (a.version ?? "").localeCompare(b.version ?? "") ||
    a.status.localeCompare(b.status) ||
    Number(a.withdrawn) - Number(b.withdrawn) ||
    Number(a.isNamespaceGuard) - Number(b.isNamespaceGuard)
  );
}

describe("onRouteMounted", () => {
  describe("when a single-version service is built", () => {
    function buildSingleVersionService() {
      const mounted: MountedRoute[] = [];
      const app = createService({
        name: "test",
        basePath: "/api/test",
        onRouteMounted: (route) => mounted.push(route),
      })
        .version("2025-03-15", (v) => {
          v.get("/items", { noPermission: { reason: "framework test endpoint" }, output: z.array(z.string()) }, async () => []);
          v.post(
            "/items",
            { noPermission: { reason: "framework test endpoint" },
              input: z.object({ name: z.string() }),
              output: z.object({ name: z.string() }),
              status: 201,
            },
            async (_c, { input }) => input,
          );
        })
        .build();
      return { app, mounted };
    }

    it("fires exactly once per mount: dated, latest, bare, and both namespace guards", () => {
      const { mounted } = buildSingleVersionService();

      const expected: Summary[] = [
        // dated version
        {
          method: "get",
          path: "/api/test/2025-03-15/items",
          version: "2025-03-15",
          status: "stable",
          withdrawn: false,
          isNamespaceGuard: false,
        },
        {
          method: "post",
          path: "/api/test/2025-03-15/items",
          version: "2025-03-15",
          status: "stable",
          withdrawn: false,
          isNamespaceGuard: false,
        },
        // latest
        {
          method: "get",
          path: "/api/test/latest/items",
          version: "latest",
          status: "latest",
          withdrawn: false,
          isNamespaceGuard: false,
        },
        {
          method: "post",
          path: "/api/test/latest/items",
          version: "latest",
          status: "latest",
          withdrawn: false,
          isNamespaceGuard: false,
        },
        // version-namespace guards (the non-wildcard one is a real, enumerable
        // route and MUST be reported so hosts can register a policy for it)
        {
          method: "all",
          path: GUARD_PATH,
          version: null,
          status: "unversioned",
          withdrawn: false,
          isNamespaceGuard: true,
        },
        {
          method: "all",
          path: GUARD_WILDCARD_PATH,
          version: null,
          status: "unversioned",
          withdrawn: false,
          isNamespaceGuard: true,
        },
        // bare alias
        {
          method: "get",
          path: "/api/test/items",
          version: null,
          status: "unversioned",
          withdrawn: false,
          isNamespaceGuard: false,
        },
        {
          method: "post",
          path: "/api/test/items",
          version: null,
          status: "unversioned",
          withdrawn: false,
          isNamespaceGuard: false,
        },
      ];

      expect(mounted).toHaveLength(8);
      expect(mounted.map(summarize).sort(bySummary)).toEqual(
        [...expected].sort(bySummary),
      );
    });

    it("carries the endpoint config on every mount and null only on the guards", () => {
      const { mounted } = buildSingleVersionService();

      const guardPaths = mounted
        .filter((route) => route.config === null)
        .map((route) => route.path)
        .sort();
      expect(guardPaths).toEqual([GUARD_PATH, GUARD_WILDCARD_PATH].sort());

      for (const route of mounted.filter((r) => !r.isNamespaceGuard)) {
        expect(route.config).not.toBeNull();
      }
    });
  });

  describe("when paths collapse or keep trailing slashes", () => {
    it("reports paths byte-identical to the Hono route table", () => {
      const mounted: MountedRoute[] = [];
      const app = createService({
        name: "test",
        basePath: "/api/test",
        onRouteMounted: (route) => mounted.push(route),
      })
        .version("2025-03-15", (v) => {
          v.get("/", { noPermission: { reason: "framework test endpoint" }, output: z.object({ ok: z.boolean() }) }, async () => ({
            ok: true,
          }));
          v.get(
            "/items/:id",
            { noPermission: { reason: "framework test endpoint" },
              params: z.object({ id: z.string() }),
              output: z.object({ id: z.string() }),
            },
            async (_c, { params }) => ({ id: params.id }),
          );
        })
        .build();

      const table = new Set(
        app.routes.map((route) => `${route.method} ${route.path}`),
      );
      const reported = new Set(
        mounted.map((route) => `${route.method.toUpperCase()} ${route.path}`),
      );

      for (const entry of reported) {
        expect(table).toContain(entry);
      }

      // The other direction, which is the one a route policy registry depends
      // on: a mount Hono holds and the callback never reports lands in
      // production with no policy. `ALL /api/test/*` is the service's own
      // middleware layer rather than a route, so it is the single exclusion.
      const unreported = [...table].filter(
        (entry) => entry !== "ALL /api/test/*" && !reported.has(entry),
      );
      expect(unreported).toEqual([]);
    });
  });

  describe("when an endpoint is withdrawn in a later version", () => {
    it("reports the 410 mounts as withdrawn with the inherited config and meta", () => {
      const meta = { policy: "things:read" };
      const mounted: MountedRoute[] = [];
      createService({
        name: "test",
        basePath: "/api/test",
        onRouteMounted: (route) => mounted.push(route),
      })
        .version("2025-01-01", (v) => {
          v.get(
            "/old",
            { noPermission: { reason: "framework test endpoint" }, meta, output: z.object({ ok: z.boolean() }) },
            async () => ({ ok: true }),
          );
        })
        .version("2025-06-01", (v) => {
          v.withdraw("get", "/old");
        })
        .build();

      // 1 dated 2025-01-01 + 1 dated 2025-06-01 + 1 latest + 2 guards + 1 bare
      expect(mounted).toHaveLength(6);

      const withdrawn = mounted.filter((route) => route.withdrawn);
      expect(
        withdrawn.map(({ path, version, status }) => ({
          path,
          version,
          status,
        })),
      ).toEqual([
        {
          path: "/api/test/2025-06-01/old",
          version: "2025-06-01",
          status: "stable",
        },
        { path: "/api/test/latest/old", version: "latest", status: "latest" },
        { path: "/api/test/old", version: null, status: "unversioned" },
      ]);
      for (const route of withdrawn) {
        expect(route.config?.meta).toBe(meta);
      }

      const live = mounted.find(
        (route) => route.path === "/api/test/2025-01-01/old",
      );
      expect(live?.withdrawn).toBe(false);
    });
  });

  describe("when preview and SSE endpoints are registered", () => {
    it("reports preview mounts with preview status and SSE endpoints as GET", () => {
      const mounted: MountedRoute[] = [];
      createService({
        name: "test",
        basePath: "/api/test",
        onRouteMounted: (route) => mounted.push(route),
      })
        .version("2025-03-15", (v) => {
          v.sse(
            "/stream",
            { noPermission: { reason: "framework test endpoint" }, events: { tick: z.object({ n: z.number() }) } },
            async (_c, _args, stream) => {
              stream.close();
            },
          );
        })
        .preview((v) => {
          v.get(
            "/beta",
            { noPermission: { reason: "framework test endpoint" }, output: z.object({ beta: z.boolean() }) },
            async () => ({ beta: true }),
          );
        })
        .build();

      expect(
        mounted
          .filter((route) => route.status === "preview")
          .map(({ method, path, version }) => ({ method, path, version })),
      ).toEqual([
        { method: "get", path: "/api/test/preview/beta", version: "preview" },
      ]);

      const streamMounts = mounted.filter((route) =>
        route.path.endsWith("/stream"),
      );
      expect(streamMounts.length).toBeGreaterThan(0);
      for (const route of streamMounts) {
        expect(route.method).toBe("get");
      }
    });
  });
});
