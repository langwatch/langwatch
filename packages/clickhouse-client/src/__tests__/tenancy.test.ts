import { describe, expect, it, vi } from "vitest";
import {
  createTenantRouter,
  DuplicateRouteError,
  parseRoutingTable,
  type TenantDirectory,
  UnknownTenantError,
} from "../tenancy";

const directoryOf = (mapping: Record<string, string>): TenantDirectory => ({
  organizationForTenant: async (tenantId) => mapping[tenantId] ?? null,
});

const tableOf = (routes: Record<string, string>) => ({
  routes: new Map(Object.entries(routes)),
  skipped: [],
  ambiguous: [],
});

describe("parseRoutingTable", () => {
  describe("given well-formed entries", () => {
    describe("when the table is parsed", () => {
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
  });

  describe("given unusable entries", () => {
    describe("when the table is parsed", () => {
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
  });

  describe("given an organisation id that contains the separator", () => {
    describe("when the name cannot be split unambiguously", () => {
      it("reports the split as a guess rather than making it silently", () => {
        // Guessing wrong is a fail-open: the intended organisation gets no
        // route, so every one of its tenants falls through to the shared
        // instance.
        const table = parseRoutingTable({
          CLICKHOUSE_URL__acme__organization__x1: "http://acme:8123",
        });

        expect(table.ambiguous).toEqual([
          {
            envVar: "CLICKHOUSE_URL__acme__organization__x1",
            organizationId: "x1",
          },
        ]);
      });
    });

    describe("when the name has a single separator", () => {
      it("does not flag it", () => {
        expect(
          parseRoutingTable({ CLICKHOUSE_URL__org_1: "http://x:8123" }).ambiguous,
        ).toEqual([]);
      });
    });
  });

  describe("given two routes for one organisation", () => {
    describe("when the table is parsed", () => {
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
});

describe("createTenantRouter", () => {
  describe("given an invalid cache bound", () => {
    describe("when the router is built", () => {
      it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
        "refuses to be built with %s",
        (maxCacheEntries) => {
          // `cache.size >= NaN` and `>= Infinity` are both false forever, so an
          // unvalidated value removes the bound and lets a long-lived worker
          // grow the map for the life of the process.
          expect(() =>
            createTenantRouter({
              table: tableOf({}),
              directory: directoryOf({}),
              maxCacheEntries,
            }),
          ).toThrow(RangeError);
        },
      );
    });
  });

  describe("given a tenant in an organisation with no private instance", () => {
    describe("when it is routed", () => {
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
  });

  describe("given a tenant in an organisation with a private instance", () => {
    describe("when it is routed", () => {
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
  });

  describe("given a tenant the directory does not know", () => {
    describe("when it is routed", () => {
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
    });

    describe("when the tenant id is empty", () => {
      it("fails closed without asking the directory", async () => {
        const directory = { organizationForTenant: vi.fn() };
        const router = createTenantRouter({ table: tableOf({}), directory });

        await expect(router.route("")).rejects.toBeInstanceOf(UnknownTenantError);
        expect(directory.organizationForTenant).not.toHaveBeenCalled();
      });
    });
  });

  describe("given repeated lookups for the same tenant", () => {
    describe("when it is routed twice", () => {
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

    describe("when it is routed many times", () => {
      it("asks the directory once, because the mapping cannot change", async () => {
        // A project belongs to a team and a team to an organisation, and
        // neither link is reassignable, so a resolved answer is final. There is
        // nothing for an expiry to protect against; the bound below covers
        // memory.
        const organizationForTenant = vi.fn(async () => "org_1");
        const router = createTenantRouter({
          table: tableOf({ org_1: "http://acme:8123" }),
          directory: { organizationForTenant },
        });

        for (let i = 0; i < 50; i++) {
          await expect(router.route("project_1")).resolves.toMatchObject({
            organizationId: "org_1",
          });
        }

        expect(organizationForTenant).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a tenant that does not exist yet", () => {
    describe("when it is created between two lookups", () => {
      it("does not cache the failure, so it routes once it is created", async () => {
        let known = false;
        const router = createTenantRouter({
          table: tableOf({}),
          directory: {
            organizationForTenant: async () => (known ? "org_1" : null),
          },
        });

        await expect(router.route("project_new")).rejects.toBeInstanceOf(
          UnknownTenantError,
        );
        known = true;

        await expect(router.route("project_new")).resolves.toEqual({
          kind: "shared",
        });
      });
    });
  });

  describe("given more tenants than the cache bound", () => {
    describe("when they are all routed", () => {
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
});
