import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  create: vi.fn(() => ({ close: stubs.close })),
  unregister: vi.fn(),
}));

vi.mock("../managedClient", () => ({
  platformManagedClickHouseClientFactory: { create: stubs.create },
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

const privateEndpointUrl = "http://user:secret@clickhouse.internal:8123";

describe("private ClickHouse pool ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("owns one client and limiter for organizations on the same endpoint", async () => {
    const {
      AppClickHouseRuntime,
      clearCustomClientCache,
      configureClickHouseRuntime,
      getClickHouseClientForOrganization,
      getCustomClientCacheSize,
    } = await import("../clickhouseClient");
    configureClickHouseRuntime(
      AppClickHouseRuntime.create({
        privateRoutes: [
          { organizationId: "org-1", url: privateEndpointUrl, cluster: "private-one" },
          { organizationId: "org-2", url: privateEndpointUrl, cluster: "private-two" },
        ],
        poolSizing: {},
        directory: { organizationForTenant: async () => null },
        buildTime: false,
      }),
    );

    const first = await getClickHouseClientForOrganization("org-1");
    const second = await getClickHouseClientForOrganization("org-2");

    expect(second).toBe(first);
    expect(stubs.create).toHaveBeenCalledTimes(1);
    expect(getCustomClientCacheSize()).toBe(1);

    await clearCustomClientCache();

    expect(stubs.close).toHaveBeenCalledOnce();
    expect(stubs.unregister).not.toHaveBeenCalled();

    await getClickHouseClientForOrganization("org-1");
    expect(stubs.create).toHaveBeenCalledTimes(2);
  });

  it("drains the process connection and refuses new endpoint resolution", async () => {
    const {
      AppClickHouseRuntime,
      configureClickHouseRuntime,
      getClickHouseClientForOrganization,
      shutdownClickHouseConnections,
    } = await import("../clickhouseClient");
    configureClickHouseRuntime(
      AppClickHouseRuntime.create({
        privateRoutes: [
          { organizationId: "org-1", url: privateEndpointUrl, cluster: "private-one" },
        ],
        poolSizing: {},
        directory: { organizationForTenant: async () => null },
        buildTime: false,
      }),
    );

    await getClickHouseClientForOrganization("org-1");
    await shutdownClickHouseConnections();

    await expect(getClickHouseClientForOrganization("org-1")).rejects.toThrow(
      "ClickHouse runtime has not been composed",
    );
    expect(stubs.close).toHaveBeenCalledOnce();
  });

  it("is inert during BUILD_TIME and permits a fresh runtime after exact shutdown", async () => {
    const {
      AppClickHouseRuntime,
      _getSharedClickHouseClient,
      configureClickHouseRuntime,
      getAllClickHouseInstances,
      getClickHouseClientForOrganization,
      isClickHouseEnabled,
      shutdownComposedClickHouseRuntime,
    } = await import("../clickhouseClient");
    const buildRuntime = AppClickHouseRuntime.create({
      privateRoutes: [{ organizationId: "org-1", url: privateEndpointUrl, cluster: "private-one" }],
      poolSizing: {},
      directory: { organizationForTenant: async () => null },
      buildTime: true,
    });
    configureClickHouseRuntime(buildRuntime);

    expect(isClickHouseEnabled()).toBe(false);
    expect(_getSharedClickHouseClient()).toBeNull();
    await expect(getAllClickHouseInstances()).resolves.toEqual([]);
    await expect(getClickHouseClientForOrganization("org-1")).rejects.toThrow("BUILD_TIME");
    expect(stubs.create).not.toHaveBeenCalled();

    const replacement = AppClickHouseRuntime.create({
      privateRoutes: [],
      poolSizing: {},
      directory: { organizationForTenant: async () => null },
      buildTime: false,
    });
    expect(() => configureClickHouseRuntime(replacement)).toThrow("already configured");

    await shutdownComposedClickHouseRuntime(buildRuntime);

    expect(() => configureClickHouseRuntime(replacement)).not.toThrow();

    await shutdownComposedClickHouseRuntime(buildRuntime);
    expect(() =>
      configureClickHouseRuntime(
        AppClickHouseRuntime.create({
          privateRoutes: [],
          poolSizing: {},
          directory: { organizationForTenant: async () => null },
          buildTime: false,
        }),
      ),
    ).toThrow("already configured");
  });

  it("registers the exact runtime shutdown before ClickHouse enablement decisions", () => {
    const presets = readFileSync(
      fileURLToPath(new URL("../../app-layer/presets.ts", import.meta.url)),
      "utf8",
    );
    const production = presets.slice(
      presets.indexOf("export function initializeDefaultApp"),
      presets.indexOf("export function createTestApp"),
    );
    const shutdownStart = production.indexOf(
      "const shutdownResources = new AppShutdownResources();",
    );
    const registration = production.indexOf(
      'shutdownResources.register("clickhouse", "clickhouse", () =>',
      shutdownStart,
    );
    const firstEnablementDecision = production.indexOf("clickhouseEnabled ?", shutdownStart);

    expect(registration).toBeGreaterThan(shutdownStart);
    expect(registration).toBeLessThan(firstEnablementDecision);
    expect(production.slice(registration - 80, registration)).not.toContain(
      "if (clickhouseEnabled)",
    );
    expect(production.slice(registration, registration + 180)).toContain(
      "shutdownComposedClickHouseRuntime(clickhouseRuntime)",
    );
  });

  it("releases an endpoint-disabled runtime after its exact shutdown", async () => {
    const { AppClickHouseRuntime, configureClickHouseRuntime, shutdownComposedClickHouseRuntime } =
      await import("../clickhouseClient");
    const disabledRuntime = AppClickHouseRuntime.create({
      privateRoutes: [],
      poolSizing: {},
      directory: { organizationForTenant: async () => null },
      buildTime: false,
    });
    configureClickHouseRuntime(disabledRuntime);

    expect(disabledRuntime.enabled()).toBe(false);
    await shutdownComposedClickHouseRuntime(disabledRuntime);

    expect(() =>
      configureClickHouseRuntime(
        AppClickHouseRuntime.create({
          privateRoutes: [],
          poolSizing: {},
          directory: { organizationForTenant: async () => null },
          buildTime: false,
        }),
      ),
    ).not.toThrow();
  });

  it("invalidates tenant-to-organization resolution without clearing endpoint clients", async () => {
    const {
      AppClickHouseRuntime,
      clearTenantOrgCache,
      configureClickHouseRuntime,
      getClickHouseClientForTenant,
    } = await import("../clickhouseClient");
    const organizationForTenant = vi.fn(async () => "org-1");
    configureClickHouseRuntime(
      AppClickHouseRuntime.create({
        privateRoutes: [
          { organizationId: "org-1", url: privateEndpointUrl, cluster: "private-one" },
        ],
        poolSizing: {},
        directory: { organizationForTenant },
        buildTime: false,
      }),
    );

    await getClickHouseClientForTenant("project-1");
    await getClickHouseClientForTenant("project-1");
    clearTenantOrgCache();
    await getClickHouseClientForTenant("project-1");

    expect(organizationForTenant).toHaveBeenCalledTimes(2);
    expect(stubs.create).toHaveBeenCalledOnce();
  });
});
