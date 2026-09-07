import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const redis = { kind: "migration-redis" };
  const order: string[] = [];
  return {
    order,
    redis,
    run: vi.fn(),
    idle: vi.fn(async () => order.push("queue-idle")),
  };
});

vi.mock("@langwatch/ksuid", () => ({
  setEnvironment: () => stubs.order.push("environment"),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    redis: stubs.redis,
    eventSourcing: { globalQueue: { waitUntilPreflightIdle: stubs.idle } },
  }),
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
    expect(stubs.run).toHaveBeenCalledWith({
      redis: stubs.redis,
      awaitPassEffects: expect.any(Function),
    });
    await stubs.run.mock.calls[0]?.[0].awaitPassEffects();
    expect(stubs.idle).toHaveBeenCalledOnce();
  });

  it("propagates a preflight failure so startup exits non-zero", async () => {
    const failure = new Error("did not converge");
    stubs.run.mockRejectedValueOnce(failure);

    await expect(runSystemMigrations()).rejects.toBe(failure);
    expect(stubs.order).toEqual(["environment", "app", "redis-ready"]);
  });
});
