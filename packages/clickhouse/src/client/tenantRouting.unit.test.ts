import { describe, expect, it } from "vitest";
import {
  createPoolRegistry,
  mappedTenantRouter,
  sharedDatabaseRouter,
  type TenantTarget,
} from "./tenantRouting";

const primary: TenantTarget = { url: "https://ch-primary:8443", database: "langwatch" };
const dedicated: TenantTarget = { url: "https://ch-dedicated:8443", database: "acme" };

describe("given sharedDatabaseRouter", () => {
  it("resolves every tenant to the same target", () => {
    const router = sharedDatabaseRouter(primary);

    expect(router.resolve("tenant-a")).toEqual(primary);
    expect(router.resolve("tenant-b")).toEqual(primary);
  });

  describe("when the target is incomplete", () => {
    it("throws at build time for an empty database", () => {
      expect(() => sharedDatabaseRouter({ url: primary.url, database: "" })).toThrow(/empty database/);
    });

    it("throws at build time for an empty url", () => {
      expect(() => sharedDatabaseRouter({ url: "", database: primary.database })).toThrow(/empty url/);
    });
  });
});

describe("given mappedTenantRouter", () => {
  const router = mappedTenantRouter({
    fallback: primary,
    overrides: new Map([["tenant-dedicated", dedicated]]),
  });

  it("routes an overridden tenant to its own target", () => {
    expect(router.resolve("tenant-dedicated")).toEqual(dedicated);
  });

  describe("when a tenant has no override", () => {
    it("resolves an unknown tenant to the fallback rather than throwing", () => {
      expect(router.resolve("tenant-never-seen-before")).toEqual(primary);
    });
  });

  describe("when an override target is malformed", () => {
    it("throws when the router is built, naming the offending tenant", () => {
      expect(() =>
        mappedTenantRouter({
          fallback: primary,
          overrides: new Map([["tenant-bad", { url: "", database: "acme" }]]),
        })
      ).toThrow(/tenant-bad/);
    });
  });

  describe("when listing known targets", () => {
    it("deduplicates repeated targets and returns a stable order", () => {
      const withDuplicateOverride = mappedTenantRouter({
        fallback: primary,
        overrides: new Map([
          ["tenant-dedicated", dedicated],
          ["tenant-dedicated-2", dedicated],
        ]),
      });

      expect(withDuplicateOverride.knownTargets()).toEqual([primary, dedicated]);
      expect(withDuplicateOverride.knownTargets()).toEqual(withDuplicateOverride.knownTargets());
    });
  });
});

describe("given createPoolRegistry", () => {
  describe("when the same target is acquired twice", () => {
    it("returns the same pool instance for both acquisitions", () => {
      let createCount = 0;
      const registry = createPoolRegistry<{ id: number }>({
        create: () => ({ id: ++createCount }),
      });

      const first = registry.acquire(primary);
      const second = registry.acquire({ ...primary });

      expect(second).toBe(first);
      expect(registry.size()).toBe(1);
    });
  });

  describe("when two targets share a url but not a database", () => {
    it("builds a pool per database, so neither tenant queries the other's schema", () => {
      const registry = createPoolRegistry<{ url: string; database: string }>({
        create: (target) => ({ url: target.url, database: target.database }),
      });

      const first = registry.acquire(primary);
      const second = registry.acquire({ url: primary.url, database: "a-different-database" });

      expect(second).not.toBe(first);
      expect(second.database).toBe("a-different-database");
      expect(registry.size()).toBe(2);
    });
  });

  describe("when two targets have distinct urls", () => {
    it("creates a distinct pool per url", () => {
      const registry = createPoolRegistry<{ url: string }>({
        create: (target) => ({ url: target.url }),
      });

      registry.acquire(primary);
      registry.acquire(dedicated);

      expect(registry.size()).toBe(2);
    });
  });

  describe("when maxPools is exceeded", () => {
    it("throws and names the configured limit instead of evicting a pool", () => {
      const registry = createPoolRegistry<{ url: string }>({
        create: (target) => ({ url: target.url }),
        maxPools: 1,
      });

      registry.acquire(primary);

      expect(() => registry.acquire(dedicated)).toThrow(/limit of 1/);
      expect(registry.size()).toBe(1);
    });
  });

  describe("when closeAll is called", () => {
    it("destroys every pool exactly once and empties the registry", async () => {
      const destroyed: string[] = [];
      const registry = createPoolRegistry<{ url: string }>({
        create: (target) => ({ url: target.url }),
        destroy: async (pool) => {
          destroyed.push(pool.url);
        },
      });

      registry.acquire(primary);
      registry.acquire(dedicated);
      registry.acquire(primary);

      await registry.closeAll();

      expect(destroyed.sort()).toEqual([dedicated.url, primary.url].sort());
      expect(registry.size()).toBe(0);
    });

    it("resolves without a destroy callback provided", async () => {
      const registry = createPoolRegistry<{ url: string }>({
        create: (target) => ({ url: target.url }),
      });

      registry.acquire(primary);

      await expect(registry.closeAll()).resolves.toBeUndefined();
      expect(registry.size()).toBe(0);
    });
  });
});
