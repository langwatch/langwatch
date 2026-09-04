import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import type { MountedRoute } from "../types.js";

// ---------------------------------------------------------------------------
// onRouteMounted contract: one callback per mounted route, with the absolute
// path exactly as the Hono route table reports it. The app builds its route
// policy registry from these callbacks, so completeness (guards and withdrawn
// mounts included) is the whole point. Every mount answers at its bare path
// and at the `/api/v1` twin it reports as `canonicalPath` (ADR 002 s1).
// ---------------------------------------------------------------------------

const GUARD_PATH = "/api/test/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
const GUARD_WILDCARD_PATH = `${GUARD_PATH}/*`;

type Summary = Pick<MountedRoute, "method" | "path" | "version" | "status" | "withdrawn"> & {
  isNamespaceGuard: boolean;
  canonicalPath: string | null;
};

function summarize(route: MountedRoute): Summary {
  return {
    method: route.method,
    path: route.path,
    canonicalPath: route.canonicalPath ?? null,
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
    (a.status ?? "").localeCompare(b.status ?? "") ||
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
        .registerRoute(
          "get",
          "/items",
          "2025-03-15",
          async () => [] as string[],
          (b) => b.withOutput(z.array(z.string())),
        )
        .registerRoute(
          "post",
          "/items.create",
          "2025-03-15",
          async (_c, input: { name: string }) => input,
          (b) =>
            b.withInput(z.object({ name: z.string() })).withOutput(z.object({ name: z.string() })),
        )
        .build();
      return { app, mounted };
    }

    it("fires exactly once per mount: dated, latest, and both namespace guards", () => {
      const { mounted } = buildSingleVersionService();

      const endpoint = (
        method: "get" | "post",
        path: string,
        version: string,
        status: "stable" | "latest",
      ): Summary => ({
        method,
        path,
        canonicalPath: path.replace("/api/", "/api/v1/"),
        version,
        status,
        withdrawn: false,
        isNamespaceGuard: false,
      });

      const expected: Summary[] = [
        // dated version
        endpoint("get", "/api/test/2025-03-15/items", "2025-03-15", "stable"),
        endpoint("post", "/api/test/2025-03-15/items.create", "2025-03-15", "stable"),
        // latest
        endpoint("get", "/api/test/latest/items", "latest", "latest"),
        endpoint("post", "/api/test/latest/items.create", "latest", "latest"),
        // the bare alias, which is the address the document names
        endpoint("get", "/api/test/items", "latest", "latest"),
        endpoint("post", "/api/test/items.create", "latest", "latest"),
        // version-namespace guards (the non-wildcard one is a real, enumerable
        // route and MUST be reported so hosts can register a policy for it)
        {
          method: "all",
          path: GUARD_PATH,
          canonicalPath: GUARD_PATH.replace("/api/", "/api/v1/"),
          version: null,
          status: null,
          withdrawn: false,
          isNamespaceGuard: true,
        },
        {
          method: "all",
          path: GUARD_WILDCARD_PATH,
          canonicalPath: GUARD_WILDCARD_PATH.replace("/api/", "/api/v1/"),
          version: null,
          status: null,
          withdrawn: false,
          isNamespaceGuard: true,
        },
      ];

      // 4 versioned mounts + 2 bare aliases + 2 guards, each reported once.
      expect(mounted).toHaveLength(8);
      expect(mounted.map(summarize).sort(bySummary)).toEqual([...expected].sort(bySummary));
    });

    it("carries the endpoint config on every mount and null only on guards", () => {
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
        .registerRoute(
          "get",
          "/",
          "2025-03-15",
          async () => ({ ok: true }),
          (b) => b.withOutput(z.object({ ok: z.boolean() })),
        )
        .registerRoute(
          "get",
          "/items/:id",
          "2025-03-15",
          async (_c, input: { id: string }) => ({ id: input.id }),
          (b) =>
            b.withParams(z.object({ id: z.string() })).withOutput(z.object({ id: z.string() })),
        )
        .build();

      const table = new Set(app.routes.map((route) => `${route.method} ${route.path}`));
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
      // The service's own middleware layers and every `/api/v1` twin are the
      // exclusions: a twin is the same logical route, reported as the
      // canonical path of the bare mount rather than as a second route.
      const canonical = new Set(
        mounted.flatMap((route) =>
          route.canonicalPath ? [`${route.method.toUpperCase()} ${route.canonicalPath}`] : [],
        ),
      );
      const unreported = [...table].filter(
        (entry) =>
          entry !== "ALL /api/test/*" &&
          entry !== "ALL /api/v1/test/*" &&
          !reported.has(entry) &&
          !canonical.has(entry),
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
        .registerRoute(
          "get",
          "/old",
          "2025-01-01",
          async () => ({ ok: true }),
          (b) => b.withMeta(meta).withOutput(z.object({ ok: z.boolean() })),
        )
        .withdrawRoute("get", "/old", "2025-06-01")
        .build();

      // 1 dated 2025-01-01 + 1 dated 2025-06-01 + 1 latest + 1 bare + 2 guards.
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
        { path: "/api/test/old", version: "latest", status: "latest" },
      ]);
      for (const route of withdrawn) {
        expect(route.config?.meta).toEqual(meta);
      }

      const live = mounted.find((route) => route.path === "/api/test/2025-01-01/old");
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
        .registerSse(
          "things.stream",
          "2025-03-15",
          async (_c, stream) => {
            stream.close();
          },
          (b) => b.withEvents({ tick: z.object({ n: z.number() }) }),
        )
        .registerRoute(
          "post",
          "/things.beta",
          "preview",
          async () => ({ beta: true }),
          (b) => b.withOutput(z.object({ beta: z.boolean() })),
        )
        .build();

      expect(
        mounted
          .filter((route) => route.status === "preview")
          .map(({ method, path, version }) => ({ method, path, version })),
      ).toEqual([
        {
          method: "post",
          path: "/api/test/preview/things.beta",
          version: "preview",
        },
      ]);

      const streamMounts = mounted.filter((route) => route.path.endsWith("/things.stream"));
      expect(streamMounts.length).toBeGreaterThan(0);
      for (const route of streamMounts) {
        expect(route.method).toBe("get");
      }
    });
  });
});
