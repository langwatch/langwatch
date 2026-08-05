import { describe, expect, it, vi } from "vitest";
import {
  createTenantRouter,
  DuplicateRouteError,
  parseRoutingTable,
  type TenantDirectory,
  UnknownTenantError,
} from "./tenancy";

const directoryOf = (mapping: Record<string, string>): TenantDirectory => ({
  organizationForTenant: async (tenantId) => mapping[tenantId] ?? null,
});

const tableOf = (routes: Record<string, string>) => ({
  routes: new Map(Object.entries(routes)),
  skipped: [],
});

describe("parseRoutingTable", () => {
  describe("given well-formed entries", () => {
    it("keys the route by the organisation id, ignoring the human label", () => {
      const table = parseRoutingTable({
        CLICKHOUSE_URL__acme__org_1: "http://acme:8123",
        UNRELATED: "x",
      });

      expect(table.routes.get("org_1")).toBe("http://acme:8123");
      expect(table.routes.size).toBe(1);
    });

    it("tolerates a label containing the separator", () => {
      const table = parseRoutingTable({
        CLICKHOUSE_URL__acme__eu__org_1: "http://acme:8123",
      });

      expect(table.routes.get("org_1")).toBe("http://acme:8123");
    });
  });

  describe("given unusable entries", () => {
    it.each([
      ["an empty value", { CLICKHOUSE_URL__acme__org_1: "" }],
      ["a whitespace value", { CLICKHOUSE_URL__acme__org_1: "   " }],
      ["no organisation id", { CLICKHOUSE_URL__: "http://x:8123" }],
    ])("skips %s rather than routing on it", (_label, env) => {
      const table = parseRoutingTable(env);

      expect(table.routes.size).toBe(0);
      expect(table.skipped).toHaveLength(1);
    });

    it("collects every problem instead of dying on the first", () => {
      const table = parseRoutingTable({
        CLICKHOUSE_URL__a__org_1: "",
        CLICKHOUSE_URL__b__org_2: "  ",
      });

      expect(table.skipped).toHaveLength(2);
    });
  });

  describe("given two routes for one organisation", () => {
    it("refuses to guess which instance holds their data", () => {
      expect(() =>
        parseRoutingTable({
          CLICKHOUSE_URL__acme__org_1: "http://one:8123",
          CLICKHOUSE_URL__acme_eu__org_1: "http://two:8123",
        }),
      ).toThrow(DuplicateRouteError);
    });
  });
});

describe("createTenantRouter", () => {
  describe("given a tenant in an organisation with no private instance", () => {
    it("routes to the shared instance", async () => {
      const router = createTenantRouter({
        table: tableOf({}),
        directory: directoryOf({ project_1: "org_1" }),
      });

      await expect(router.route("project_1")).resolves.toEqual({
        kind: "shared",
      });
    });
  });

  describe("given a tenant in an organisation with a private instance", () => {
    it("routes to that instance", async () => {
      const router = createTenantRouter({
        table: tableOf({ org_1: "http://acme:8123" }),
        directory: directoryOf({ project_1: "org_1" }),
      });

      await expect(router.route("project_1")).resolves.toEqual({
        kind: "private",
        organizationId: "org_1",
        url: "http://acme:8123",
      });
    });
  });

  describe("given a tenant the directory does not know", () => {
    it("fails closed rather than falling back to shared", async () => {
      // Falling back would run the statement against the shared instance,
      // which succeeds and returns plausible rows belonging to someone else.
      const router = createTenantRouter({
        table: tableOf({}),
        directory: directoryOf({}),
      });

      await expect(router.route("project_unknown")).rejects.toBeInstanceOf(
        UnknownTenantError,
      );
    });

    it("fails closed on an empty tenant id without asking the directory", async () => {
      const directory = { organizationForTenant: vi.fn() };
      const router = createTenantRouter({ table: tableOf({}), directory });

      await expect(router.route("")).rejects.toBeInstanceOf(UnknownTenantError);
      expect(directory.organizationForTenant).not.toHaveBeenCalled();
    });
  });

  describe("given repeated lookups for the same tenant", () => {
    it("asks the directory once while the answer is fresh", async () => {
      const organizationForTenant = vi.fn(async () => "org_1");
      const router = createTenantRouter({
        table: tableOf({}),
        directory: { organizationForTenant },
      });

      await router.route("project_1");
      await router.route("project_1");

      expect(organizationForTenant).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a tenant that moves organisation", () => {
    it("stops using the old organisation once the entry expires", async () => {
      // The bug this replaces cached forever, so a moved project kept reading
      // its previous organisation's ClickHouse until the process restarted.
      let organizationId = "org_old";
      let now = 0;
      const router = createTenantRouter({
        table: tableOf({
          org_old: "http://old:8123",
          org_new: "http://new:8123",
        }),
        directory: { organizationForTenant: async () => organizationId },
        cacheTtlMs: 1_000,
        clock: { now: () => now },
      });

      await expect(router.route("project_1")).resolves.toMatchObject({
        organizationId: "org_old",
      });

      organizationId = "org_new";
      now = 1_001;

      await expect(router.route("project_1")).resolves.toMatchObject({
        organizationId: "org_new",
        url: "http://new:8123",
      });
    });

    it("can be corrected immediately by invalidating the tenant", async () => {
      let organizationId = "org_old";
      const router = createTenantRouter({
        table: tableOf({
          org_old: "http://old:8123",
          org_new: "http://new:8123",
        }),
        directory: { organizationForTenant: async () => organizationId },
      });

      await expect(router.route("project_1")).resolves.toMatchObject({
        organizationId: "org_old",
      });

      organizationId = "org_new";
      router.invalidate("project_1");

      await expect(router.route("project_1")).resolves.toMatchObject({
        organizationId: "org_new",
        url: "http://new:8123",
      });
    });
  });

  describe("given more tenants than the cache bound", () => {
    it("stays bounded instead of growing for the life of the process", async () => {
      const router = createTenantRouter({
        table: tableOf({}),
        directory: { organizationForTenant: async () => "org_1" },
        maxCacheEntries: 3,
      });

      for (let i = 0; i < 10; i++) await router.route(`project_${i}`);

      expect(router.size()).toBeLessThanOrEqual(3);
    });
  });
});
