import { describe, expect, it } from "vitest";

import { buildAxisLabels, commonLabelPrefix } from "../chartAxisLabels";

describe("commonLabelPrefix", () => {
  describe("given names sharing a prefix that ends at a separator", () => {
    it("returns the prefix up to that separator", () => {
      expect(
        commonLabelPrefix([
          "support-assistant-warm",
          "support-assistant-formal",
          "support-assistant-blunt",
        ]),
      ).toBe("support-assistant-");
    });
  });

  describe("given one name is a prefix of another", () => {
    // A raw longest-common-prefix here would be "support-warm", leaving the
    // first name with nothing at all.
    it("backs off so every name keeps a remainder", () => {
      expect(commonLabelPrefix(["support-warm", "support-warm-premium"])).toBe(
        "support-",
      );
    });
  });

  describe("given names with nothing in common", () => {
    it("returns no prefix", () => {
      expect(commonLabelPrefix(["alpha", "beta", "gamma"])).toBe("");
    });
  });

  describe("given a shared prefix that does not reach a separator", () => {
    it("returns no prefix rather than splitting a word", () => {
      expect(commonLabelPrefix(["supported", "supporting"])).toBe("");
    });
  });

  describe("given a single name", () => {
    it("returns no prefix, since there is nothing to share it with", () => {
      expect(commonLabelPrefix(["support-assistant-warm"])).toBe("");
    });
  });
});

describe("buildAxisLabels", () => {
  describe("given four variants sharing a long prefix", () => {
    // The bug this exists for: these all truncate to "support-assista…", so
    // one chart rendered four identical labels and its sibling rendered
    // "(1) (2) (3) (4)". Dropping the shared prefix removes the collision at
    // source, so neither workaround is needed.
    /** @scenario "Labels name the part that tells the variants apart" */
    it("labels them by the part that differs", () => {
      const labels = buildAxisLabels(
        [
          "support-assistant-warm",
          "support-assistant-warm-premium",
          "support-assistant-formal",
          "support-assistant-blunt",
        ],
        16,
      );

      expect(labels).toEqual(["…warm", "…warm-premium", "…formal", "…blunt"]);
    });

    it("needs no disambiguation suffixes", () => {
      const labels = buildAxisLabels(
        ["support-assistant-warm", "support-assistant-formal", "support-assistant-blunt"],
        16,
      );

      expect(labels.some((l) => /\(\d\)$/.test(l))).toBe(false);
    });
  });

  describe("given names with no shared prefix", () => {
    /** @scenario "Names that already fit are shown in full" */
    it("leaves them alone", () => {
      expect(buildAxisLabels(["warm", "formal", "blunt"], 16)).toEqual([
        "warm",
        "formal",
        "blunt",
      ]);
    });
  });

  describe("given a name longer than the limit even after stripping", () => {
    it("truncates it", () => {
      const labels = buildAxisLabels(
        ["support-assistant-extremely-verbose-variant-name", "support-assistant-blunt"],
        12,
      );

      expect(labels[0]!.length).toBeLessThanOrEqual(12);
      expect(labels[0]!.endsWith("…")).toBe(true);
    });
  });

  describe("when two labels still collide after trimming", () => {
    it("indexes them so no two bars are labelled the same", () => {
      const labels = buildAxisLabels(["identical-name", "identical-name", "other"], 20);

      expect(labels[0]).toBe("identical-name (1)");
      expect(labels[1]).toBe("identical-name (2)");
      expect(labels[2]).toBe("other");
    });
  });

  describe("given a single name", () => {
    it("returns it untouched", () => {
      expect(buildAxisLabels(["support-assistant-warm"], 30)).toEqual([
        "support-assistant-warm",
      ]);
    });
  });

  describe("given no names", () => {
    it("returns an empty list rather than throwing", () => {
      expect(buildAxisLabels([], 16)).toEqual([]);
    });
  });
});
