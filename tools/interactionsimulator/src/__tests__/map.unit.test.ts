import { describe, expect, it } from "vitest";

import {
  mergeMaps,
  publishFeatures,
  renderMap,
  type JourneyResult,
  type ProductMap,
} from "../map.ts";

const result = (status: JourneyResult["status"], run: string): JourneyResult => ({
  goal: "Create a dataset",
  status,
  reason: "because",
  run,
  evidence: { screens: [], held: [], failing: [] },
});

const earlier: ProductMap = {
  url: "https://app.x",
  features: {
    dataset: { create: result("broken", "r1"), delete: result("works", "r1") },
    prompt: { save: result("works", "r1") },
  },
};

describe("mergeMaps", () => {
  describe("when a run walks one journey of a feature again", () => {
    it("replaces that journey and keeps every other", () => {
      const merged = mergeMaps({
        previous: earlier,
        next: { url: "https://app.x", features: { dataset: { create: result("works", "r2") } } },
      });
      expect(merged.features.dataset?.create?.status).toBe("works");
      expect(merged.features.dataset?.delete?.run).toBe("r1");
      expect(merged.features.prompt?.save?.status).toBe("works");
    });
  });
});

describe("renderMap", () => {
  it("lists a catalogue feature nobody walked as not walked", () => {
    const text = renderMap({ map: earlier, featureIds: ["dataset", "prompt", "trace"] });
    expect(text).toContain("| dataset | 1 | 1 | 0 | 0 |");
    expect(text).toContain("| trace | | | | not walked |");
  });
});

describe("publishFeatures", () => {
  const body = [
    "intro",
    "<!-- parity-status:start -->",
    "### features",
    "",
    "| area | state | proven live | still untested |",
    "|---|---|---|---|",
    "| datasets | ❌ | none | the whole journey |",
    "| tracing | 🟢 | ingestion | share |",
    "",
    "<!-- parity-status:end -->",
    "outro",
  ].join("\n");

  describe("when a walked feature has a row", () => {
    it("adds its tally to the proven-live cell once, however often it is published", () => {
      const once = publishFeatures({ body, map: earlier });
      const twice = publishFeatures({ body: once, map: earlier });
      expect(twice).toBe(once);
      expect(once).toContain(
        "| datasets | ❌ | none · sim: 1 works, 1 broken, 0 blocked, 0 untested | the whole journey |",
      );
      expect(once).toContain("| tracing | 🟢 | ingestion | share |");
    });
  });

  describe("when a walked feature has no row", () => {
    it("adds one inside the table", () => {
      const lines = publishFeatures({ body, map: earlier }).split("\n");
      expect(lines[lines.indexOf("| tracing | 🟢 | ingestion | share |") + 1]).toBe(
        "| prompt | 🟢 | sim: 1 works, 0 broken, 0 blocked, 0 untested | |",
      );
    });
  });

  describe("when the body has no parity markers", () => {
    it("leaves it alone", () => {
      expect(publishFeatures({ body: "no markers", map: earlier })).toBe("no markers");
    });
  });
});
