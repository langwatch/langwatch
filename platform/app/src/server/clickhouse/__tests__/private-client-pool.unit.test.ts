import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  create: vi.fn(() => ({ close: stubs.close })),
  unregister: vi.fn(),
}));

vi.mock("../client", () => ({
  _getSharedClickHouseClient: () => null,
}));

vi.mock("../managedClient", () => ({
  createManagedClickHouseClient: stubs.create,
}));

vi.mock("../metrics", () => ({
  unregisterClickHouseLimiter: stubs.unregister,
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

const firstRoute = "CLICKHOUSE_URL__private-one__org-1";
const secondRoute = "CLICKHOUSE_URL__private-two__org-2";

describe("private ClickHouse pool ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env[firstRoute] = "http://user:secret@clickhouse.internal:8123";
    process.env[secondRoute] = "http://user:secret@clickhouse.internal:8123";
  });

  afterEach(() => {
    delete process.env[firstRoute];
    delete process.env[secondRoute];
  });

  it("owns one client and limiter for organizations on the same endpoint", async () => {
    const {
      clearCustomClientCache,
      getClickHouseClientForOrganization,
      getCustomClientCacheSize,
    } = await import("../clickhouseClient");

    const first = await getClickHouseClientForOrganization("org-1");
    const second = await getClickHouseClientForOrganization("org-2");

    expect(second).toBe(first);
    expect(stubs.create).toHaveBeenCalledTimes(1);
    expect(getCustomClientCacheSize()).toBe(1);

    await clearCustomClientCache();

    expect(stubs.close).toHaveBeenCalledOnce();
    expect(stubs.unregister).toHaveBeenCalledWith("org-1");
  });
});
