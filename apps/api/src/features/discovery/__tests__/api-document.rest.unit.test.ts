/**
 * The declarations the two mounted discovery locations publish: the addresses
 * an integrator's generator is already pointed at, and nothing beside them.
 */
import { describe, expect, it } from "vitest";

import { apiDiscoveryRest } from "../api-discovery.rest.ts";
import { gatewayOpenApiRest } from "../gateway-openapi.rest.ts";

describe("given the gateway description location", () => {
  const declaration = gatewayOpenApiRest.router();

  it("publishes exactly the canonical gateway address, read-only", () => {
    expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "get /api/gateway/v1/openapi.json",
    ]);
  });

  it("owns no prefix and publishes no /api/v1 twin, because its path names v1 already", () => {
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(false);
  });
});

describe("given the description location under the API namespace", () => {
  const declaration = apiDiscoveryRest.router();

  it("publishes exactly the one address, read-only", () => {
    expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "get /api/openapi.json",
    ]);
  });

  it("keeps the /api/v1 twin the location has answered at since it was published", () => {
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(true);
  });
});

describe("when a caller reaches either location", () => {
  it("answers without a credential the door resolved, and names why", () => {
    for (const declaration of [gatewayOpenApiRest.router(), apiDiscoveryRest.router()]) {
      for (const route of declaration.routes) {
        expect(route.access?.kind).toBe("public");
        expect(route.access?.reason).toContain("carries no tenant data");
      }
    }
  });

  it("writes its own bytes, so nothing re-serialises the document per request", () => {
    for (const declaration of [gatewayOpenApiRest.router(), apiDiscoveryRest.router()]) {
      for (const route of declaration.routes) {
        expect(route.rawResponse?.produces).toEqual(["application/json"]);
      }
    }
  });
});
