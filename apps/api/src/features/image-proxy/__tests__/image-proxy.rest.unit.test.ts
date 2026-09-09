/**
 * The declaration the image relay publishes: two addresses the dashboard's
 * pages link, open to a browser holding nothing, writing an upstream's bytes.
 */
import { describe, expect, it } from "vitest";

import { imageProxyRest } from "../image-proxy.rest.ts";

describe("given the image relay declaration", () => {
  const declaration = imageProxyRest.router();

  it("publishes exactly the one read address, which the /api/v1 twin doubles", () => {
    expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "get /api/image-proxy",
    ]);
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(true);
  });

  describe("when a page asks the relay for an image", () => {
    it("answers without a credential the door resolved, and names why", () => {
      for (const route of declaration.routes) {
        expect(route.access?.kind).toBe("public");
        expect(route.access?.reason).toContain("SSRF-guarded");
      }
    });

    it("writes the upstream's own bytes, so no schema describes the answer", () => {
      for (const route of declaration.routes) {
        expect(route.rawResponse?.produces).toEqual(["image/*"]);
      }
    });

    it("takes the url as an OPTIONAL query, so a caller naming none reads our sentence", () => {
      for (const route of declaration.routes) {
        expect(route.query?.safeParse({})).toMatchObject({ success: true });
      }
    });
  });
});
