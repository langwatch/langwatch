/**
 * The declaration the browser telemetry intake publishes: one write address,
 * open to a caller with nothing to present, reading its own body.
 */
import { describe, expect, it } from "vitest";

import { rumRest } from "../rum.rest.ts";

describe("given the browser telemetry declaration", () => {
  const declaration = rumRest.router();

  it("publishes exactly the address the browser exporter posts to", () => {
    expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "post /api/rum/v1/traces",
    ]);
  });

  it("owns no prefix and publishes no /api/v1 twin, because its path names v1 already", () => {
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(false);
  });

  describe("when a browser posts an export", () => {
    it("answers without a credential the door resolved, and names why", () => {
      for (const route of declaration.routes) {
        expect(route.access?.kind).toBe("public");
        expect(route.access?.reason).toContain("untrusted");
      }
    });

    it("names the caller from the two headers the bucket has always been keyed on", () => {
      for (const route of declaration.routes) {
        expect(route.middleware?.map((fact) => fact.name)).toEqual([
          "rumSession",
          "rumForwardedFor",
        ]);
      }
    });

    it("reads the body itself rather than letting a schema parse it", () => {
      for (const route of declaration.routes) {
        expect(route.rawBody).toBeUndefined();
        expect(route.rawResponse?.produces).toEqual(["application/json"]);
      }
    });
  });
});
