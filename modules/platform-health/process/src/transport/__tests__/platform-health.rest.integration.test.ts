/**
 * @vitest-environment node
 */
import type { RestIdentity } from "@langwatch/api/hosting";
import { bindRestCredential, BearerIdentity, RestHost } from "@langwatch/api/rest";
import type { PlatformHealthApi as PlatformHealthCapability } from "@langwatch/platform-health-contract";
import { ScopedSecrets, type SecretHandle } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { PlatformHealthModule } from "../../app/platform-health.app.ts";
import { platformHealthRest } from "../platform-health.rest.ts";

/** The door the module builds from PLATFORM_HEALTH_API_KEY, unset where `key` is null. */
async function monitorDoor(key: string | null): Promise<RestIdentity> {
  const secrets = new ScopedSecrets(async (_handle: SecretHandle<unknown>, build) =>
    build(key ?? void 0),
  );
  const app = await PlatformHealthModule.create({
    dependencies: {},
    config: { publicBaseUrl: undefined },
    secrets,
  } as never);

  return app.monitorDoor;
}

/** The family as the module mounts it: the monitoring key is its bearer door. */
async function mount(app: PlatformHealthCapability, key: string | null = "monitor-key") {
  const door = await monitorDoor(key);
  const closed = BearerIdentity.create({ name: "unbound", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  host.mount(platformHealthRest.router(), () => app, {
    facts: [bindRestCredential("internal_secret", () => door)],
  });

  return host.app;
}

const healthyReport = {
  status: "healthy" as const,
  checkedAt: "2026-09-17T12:00:00.000Z",
  checks: [
    {
      name: "collector" as const,
      status: "healthy" as const,
      durationMs: 4,
    },
  ],
};

describe("platform health REST family", () => {
  /** @scenario "A request with no key runs no probe" */
  it("refuses a missing monitoring key before running a probe", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = await mount(createApiFixture<PlatformHealthCapability>({ checkAll }));

    const response = await hono.request("/api/v1/platform-health");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "unauthorized" });
    expect(checkAll).not.toHaveBeenCalled();
  });

  /** @scenario "A working platform answers success" */
  it("serves the canonical monitoring route when the key and probes are healthy", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = await mount(
      createApiFixture<PlatformHealthCapability>({
        checkAll,
      }),
    );

    const response = await hono.request("/api/v1/platform-health", {
      headers: { authorization: "Bearer monitor-key" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(healthyReport);
    expect(checkAll).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  });

  /** @scenario "A request with the wrong key runs no probe" */
  it("refuses a key that is not this deployment's before running a probe", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = await mount(
      createApiFixture<PlatformHealthCapability>({
        checkAll,
      }),
    );

    const response = await hono.request("/api/v1/platform-health", {
      headers: { authorization: "Bearer not-the-key" },
    });

    expect(response.status).toBe(401);
    expect(checkAll).not.toHaveBeenCalled();
  });

  /** @scenario "Each subsystem is reachable on its own path" */
  it("probes only the subsystem the path names and answers with it", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const checkOne = vi.fn(async () => healthyReport);
    const hono = await mount(
      createApiFixture<PlatformHealthCapability>({
        checkAll,
        checkOne,
      }),
    );

    const response = await hono.request("/api/v1/platform-health/collector", {
      headers: { authorization: "Bearer monitor-key" },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).checks[0].name).toBe("collector");
    expect(checkOne).toHaveBeenCalledWith("collector", expect.objectContaining({}));
    expect(checkAll).not.toHaveBeenCalled();
  });

  /** @scenario "A subsystem this platform does not have is not found" */
  it("answers 404 for a subsystem name the platform does not have", async () => {
    const checkOne = vi.fn(async () => healthyReport);
    const hono = await mount(createApiFixture<PlatformHealthCapability>({ checkOne }));

    const response = await hono.request("/api/v1/platform-health/nonexistent", {
      headers: { authorization: "Bearer monitor-key" },
    });

    expect(response.status).toBe(404);
    expect(checkOne).not.toHaveBeenCalled();
  });

  /** @scenario "One broken subsystem makes the whole answer a failure" */
  it("answers 503 when the report says the platform is unhealthy", async () => {
    const hono = await mount(
      createApiFixture<PlatformHealthCapability>({
        checkAll: async () => ({
          ...healthyReport,
          status: "unhealthy" as const,
          checks: [{ name: "collector" as const, status: "unhealthy" as const, durationMs: 4 }],
        }),
      }),
    );

    const response = await hono.request("/api/v1/platform-health", {
      headers: { authorization: "Bearer monitor-key" },
    });

    expect(response.status).toBe(503);
  });

  /** @scenario "A deployment with no key serves no platform health routes" */
  it("answers 404 to every caller where the deployment set no key", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = await mount(createApiFixture<PlatformHealthCapability>({ checkAll }), null);

    const bare = await hono.request("/api/v1/platform-health");
    const keyed = await hono.request("/api/v1/platform-health", {
      headers: { authorization: "Bearer monitor-key" },
    });

    expect([bare.status, keyed.status]).toEqual([404, 404]);
    await expect(bare.json()).resolves.toMatchObject({ code: "not_found" });
    expect(checkAll).not.toHaveBeenCalled();
  });

  /** @scenario "A key of a different length is refused without a byte-by-byte comparison" */
  it("refuses a longer, a shorter and an empty key before any probe", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = await mount(createApiFixture<PlatformHealthCapability>({ checkAll }));

    for (const key of ["monitor-key-that-is-longer", "short", ""]) {
      const response = await hono.request("/api/v1/platform-health", {
        headers: { authorization: `Bearer ${key}` },
      });
      expect(response.status).toBe(401);
    }
    expect(checkAll).not.toHaveBeenCalled();
  });

  it.each(["/api/health/langy", "/api/health/scenarios"])(
    "does not revive retired tenant canary route %s",
    async (path) => {
      const hono = await mount(createApiFixture<PlatformHealthCapability>());

      expect((await hono.request(path)).status).toBe(404);
    },
  );
});
