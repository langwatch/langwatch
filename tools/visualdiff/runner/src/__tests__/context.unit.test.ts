import { describe, expect, it } from "vitest";

import { fillPath } from "../flows/context";

describe("fillPath", () => {
  describe("given a route with the project slug and a seeded fixture placeholder", () => {
    it("fills both, so a dynamic screen renders the seeded entity", () => {
      expect(
        fillPath({
          path: "/{slug}/traces/{trace}",
          slug: "local-dev-project",
          fixtures: { trace: "trace_visualdiff_0" },
        }),
      ).toBe("/local-dev-project/traces/trace_visualdiff_0");
    });
  });

  describe("given no fixtures", () => {
    it("fills the slug alone", () => {
      expect(fillPath({ path: "/{slug}/datasets", slug: "p" })).toBe("/p/datasets");
    });
  });
});
