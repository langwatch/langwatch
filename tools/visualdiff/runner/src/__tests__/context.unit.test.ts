import { describe, expect, it } from "vitest";

import { asRegExp, fillPath, sideFixtures } from "../flows/context";

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

describe("sideFixtures", () => {
  const plan = {
    fixtures: { trace: "trace_visualdiff_0", dataset: "static" },
    sides: [
      { name: "base", baseUrl: "http://base", fixtures: { dataset: "base-id" } },
      { name: "candidate", baseUrl: "http://candidate", fixtures: { dataset: "candidate-id" } },
    ],
  };

  describe("given each side seeded its own dataset id", () => {
    it("fills a side's route with that side's id over the static one", () => {
      expect(sideFixtures({ plan, side: "candidate" })).toEqual({
        trace: "trace_visualdiff_0",
        dataset: "candidate-id",
      });
      expect(sideFixtures({ plan, side: "base" }).dataset).toBe("base-id");
    });
  });

  describe("given a side with no seeded ids", () => {
    it("falls back to the static fixtures", () => {
      expect(sideFixtures({ plan: { fixtures: { team: "t" }, sides: [] }, side: "base" })).toEqual({
        team: "t",
      });
    });
  });
});

describe("asRegExp", () => {
  describe("given a path with two slashes", () => {
    it("matches it literally, not as /pattern/flags", () => {
      expect(asRegExp("/simulations/scenarios").test("/p/simulations/scenarios")).toBe(true);
    });
  });

  describe("given a regex literal with real flags", () => {
    it("builds that regex", () => {
      expect(asRegExp("/comparison/i").test("Comparison")).toBe(true);
    });
  });
});
