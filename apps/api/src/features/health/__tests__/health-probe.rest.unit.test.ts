/**
 * The declaration the five subsystem probes publish: the paths an orchestrator
 * already has configured, and nothing beside them.
 */
import { describe, expect, it } from "vitest";

import { healthProbeRest } from "../health-probe.rest.ts";

describe("given the health probe declaration", () => {
  const declaration = healthProbeRest.router();

  it("publishes exactly the five probe paths, read-only", () => {
    expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "get /api/health/collector",
      "get /api/health/evaluations",
      "get /api/health/processor",
      "get /api/health/triggers",
      "get /api/health/workflows",
    ]);
  });

  describe("when a caller reaches one of them", () => {
    it("answers without a credential the door resolved, and names why", () => {
      for (const route of declaration.routes) {
        expect(route.access?.kind).toBe("public");
        expect(route.access?.reason).toContain("X-Auth-Token");
      }
    });
  });

  it("owns no prefix and publishes no /api/v1 twin", () => {
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(false);
  });

  it("reads the caller's key from both headers the family has always accepted", () => {
    for (const route of declaration.routes) {
      expect(route.middleware?.map((fact) => fact.name)).toEqual([
        "healthProbeAuthToken",
        "healthProbeAuthorization",
      ]);
    }
  });
});
