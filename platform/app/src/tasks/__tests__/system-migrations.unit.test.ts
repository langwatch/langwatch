import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const redis = { kind: "migration-redis" };
  return {
    order: [] as string[],
    redis,
    run: vi.fn(),
  };
});

vi.mock("@langwatch/ksuid", () => ({
  setEnvironment: () => stubs.order.push("environment"),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: stubs.redis }),
}));

vi.mock("~/server/app-layer/presets", () => ({
  initializeMigrationApp: () => stubs.order.push("app"),
}));

vi.mock("~/server/app-layer/redis-readiness", () => ({
  assertRedisReady: async () => {
    stubs.order.push("redis-ready");
  },
}));

vi.mock("~/server/app-layer/system-migrations/boot", () => ({
  runSystemMigrationsToQuiescence: stubs.run.mockImplementation(async () => {
    stubs.order.push("migrations");
  }),
}));

import runSystemMigrations from "../system-migrations";

describe("system-migrations task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.order.length = 0;
  });

  it("initializes the migration app and waits for quiescence", async () => {
    await runSystemMigrations();

    expect(stubs.order).toEqual([
      "environment",
      "app",
      "redis-ready",
      "migrations",
    ]);
    expect(stubs.run).toHaveBeenCalledWith({ redis: stubs.redis });
  });

  it("propagates a preflight failure so startup exits non-zero", async () => {
    const failure = new Error("did not converge");
    stubs.run.mockRejectedValueOnce(failure);

    await expect(runSystemMigrations()).rejects.toBe(failure);
    expect(stubs.order).toEqual(["environment", "app", "redis-ready"]);
  });
});
