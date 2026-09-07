/**
 * The monitoring-keyed platform-health family, over the real composed app.
 * @vitest-environment node
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createPlatformHealthRestApp } from "@langwatch/platform-health-server";
import { ResourceScope } from "@langwatch/runtime-composition";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { HealthProbeRestPorts } from "../../health/health-probe-rest.ts";
import { composeApiPlatformHealthRest } from "../platform-health-rest.mount.ts";

const MONITORING_KEY = "monitoring-key";

describe("given a deployment that configured a platform health key", () => {
  describe("when a monitor asks without a key", () => {
    /** @scenario "A request with no key runs no probe" */
    it("refuses it as unauthorized and probes nothing", async () => {
      const world = mount();

      const response = await world.fetch("/api/v1/platform-health");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "platform_health_unauthorized",
      });
      expect(world.fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a monitor asks with a key that is not this deployment's", () => {
    /** @scenario "A request with the wrong key runs no probe" */
    it("refuses it as unauthorized and probes nothing", async () => {
      const world = mount();

      const response = await world.fetch("/api/v1/platform-health", {
        headers: { authorization: "Bearer someone-elses-key" },
      });

      expect(response.status).toBe(401);
      expect(world.fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a monitor asks for one named subsystem", () => {
    /** @scenario "Each subsystem is reachable on its own path" */
    it("probes only that subsystem and names it in the answer", async () => {
      const world = mount();

      const response = await world.fetch("/api/v1/platform-health/evaluations", {
        headers: { authorization: `Bearer ${MONITORING_KEY}` },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.checks.map((check: { name: string }) => check.name)).toEqual(["evaluations"]);
      for (const call of world.fetchSpy.mock.calls) {
        expect(String(call[0])).toContain("/api/evaluations/");
      }
    });
  });

  describe("when a monitor asks for the whole platform", () => {
    /** @scenario "The aggregate runs every subsystem" */
    it("reports one entry per subsystem, with how long each took", async () => {
      const world = mount();

      const response = await world.fetch("/api/v1/platform-health?triggerId=trigger-1", {
        headers: { authorization: `Bearer ${MONITORING_KEY}` },
      });

      const body = await response.json();
      expect(body.checks.map((check: { name: string }) => check.name)).toEqual([
        "collector",
        "evaluations",
        "processor",
        "triggers",
        "workflows",
      ]);
      for (const check of body.checks) {
        expect(typeof check.durationMs).toBe("number");
      }
      expect(Date.parse(body.checkedAt)).not.toBeNaN();
    });
  });

  describe("when every subsystem it can reach answers", () => {
    /** @scenario "A working platform answers success" */
    it("answers a success and reports the platform healthy", async () => {
      const world = mount();

      const response = await world.fetch("/api/v1/platform-health/collector", {
        headers: { authorization: `Bearer ${MONITORING_KEY}` },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "healthy",
        checks: [{ name: "collector", status: "healthy" }],
      });
    });
  });

  describe("when one subsystem does not answer", () => {
    /** @scenario "One broken subsystem makes the whole answer a failure" */
    it("answers a service failure and reports the platform unhealthy", async () => {
      const world = mount({ collectorRefuses: true });

      const response = await world.fetch("/api/v1/platform-health/collector", {
        headers: { authorization: `Bearer ${MONITORING_KEY}` },
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "unhealthy",
        checks: [
          {
            name: "collector",
            status: "unhealthy",
            detail: "the collector did not accept the canary trace",
          },
        ],
      });
    });
  });
});

describe("given a deployment that configured no platform health key", () => {
  describe("when a monitor asks for the platform health", () => {
    /** @scenario "A deployment with no key serves no platform health routes" */
    it("has no such route to answer with", async () => {
      const ports = composeApiPlatformHealthRest({
        apiKey: undefined,
        probeApiKey: "probe-key",
        probes: probeCollaborators(),
        resources: new ResourceScope(),
      });

      expect(ports).toBeUndefined();

      const hono = new Hono();
      const response = await hono.fetch(new Request("http://api.test/api/v1/platform-health"));
      expect(response.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------

function probeCollaborators(): HealthProbeRestPorts {
  return {
    resolveProjectByApiKey: async () => ({ id: "project-1" }),
    publicBaseUrl: "https://app.langwatch.test",
    automation: () => ({
      tryGetById: async () => ({ id: "trigger-1" }),
      getRecentFires: async () => [{ createdAt: new Date() }],
    }),
    workflowExists: async () => true,
  };
}

function mount(options: { collectorRefuses?: boolean } = {}) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const refused = options.collectorRefuses === true && url.includes("/api/collector");
    return new Response(JSON.stringify({ ok: !refused }), {
      status: refused ? 500 : 200,
      headers: { "content-type": "application/json" },
    });
  });

  const ports = composeApiPlatformHealthRest({
    apiKey: MONITORING_KEY,
    probeApiKey: "probe-key",
    probes: probeCollaborators(),
    resources: new ResourceScope(),
  });
  if (!ports) throw new Error("the family must compose from a configured deployment");

  const hono = new Hono().route(
    "/",
    createPlatformHealthRestApp({ security: passThroughSecurity(), ports }),
  );

  return {
    fetchSpy,
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/** The refusal, rendered the way the canonical boundary renders it. */
const renderHandled: ErrorHandler = (error, c) =>
  error instanceof HandledError
    ? c.json({ code: error.code, message: error.code }, error.httpStatus)
    : c.json({ code: "unknown", message: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
