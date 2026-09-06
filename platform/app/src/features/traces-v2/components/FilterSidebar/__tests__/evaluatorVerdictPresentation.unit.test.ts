import { describe, expect, it } from "vitest";
import {
  FACET_DEFAULTS,
  FACET_VALUE_ORDER,
  VIBRANT_FIELDS,
} from "../constants";
import { buildFacetItems, orderValues } from "../hooks/useFilterSidebarData";
import type { CategoricalSection } from "../types";

/** A verdict facet as discover hands it over: counts, no order, no colour. */
const verdictSection = (
  topValues: { value: string; count: number }[],
): CategoricalSection =>
  ({
    kind: "categorical",
    key: "evaluatorVerdict",
    label: "Evaluator Verdict",
    topValues: topValues.map((v) => ({ ...v, label: v.value })),
    totalDistinct: topValues.length,
  }) as unknown as CategoricalSection;

/**
 * The Evaluator Verdict facet and the evaluator drilldown render the same
 * verdicts on the same screen, one directly above the other. They are wired
 * through completely different code (a facet colour map vs `buildVerdictSpecs`
 * in EvaluatorDrilldown), so nothing but a test stops them drifting back into
 * disagreement — which is how they got there: with no entry in FACET_COLORS
 * the facet fell through to `hashColor`, and the two surfaces showed the same
 * words in different colours.
 */
describe("evaluator verdict presentation", () => {
  describe("given verdict rows built for the section", () => {
    /** @scenario "Verdicts carry the drilldown's traffic light" */
    it("hands each row the drilldown's colour for its verdict", () => {
      const rows = buildFacetItems(
        verdictSection([
          { value: "pass", count: 72 },
          { value: "fail", count: 24 },
          { value: "error", count: 3 },
        ]),
        false,
      );

      expect(
        Object.fromEntries(rows.map((r) => [r.value, r.dotColor])),
      ).toEqual({
        pass: "green.solid",
        fail: "red.solid",
        error: "yellow.solid",
      });
    });

    it("keeps the non-verdicts neutral so they do not compete", () => {
      const rows = buildFacetItems(
        verdictSection([
          { value: "skipped", count: 2 },
          { value: "unknown", count: 1 },
        ]),
        false,
      );

      expect(
        Object.fromEntries(rows.map((r) => [r.value, r.dotColor])),
      ).toEqual({ skipped: "gray.solid", unknown: "gray.solid" });
    });

    it("renders the curated palette at full strength rather than dimmed", () => {
      const rows = buildFacetItems(
        verdictSection([{ value: "pass", count: 1 }]),
        false,
      );

      expect(rows.map((r) => r.dimmed)).toEqual([false]);
      expect(VIBRANT_FIELDS.has("evaluatorVerdict")).toBe(true);
    });

    /** @scenario "Verdicts read pass, fail, error regardless of counts" */
    it("lists pass, then fail, then error however the counts fall", () => {
      const rows = buildFacetItems(
        verdictSection([
          { value: "fail", count: 90 },
          { value: "error", count: 40 },
          { value: "pass", count: 2 },
        ]),
        false,
      );

      expect(rows.map((r) => r.value)).toEqual(["pass", "fail", "error"]);
    });

    /** @scenario "Ordering the facet does not invent verdict rows" */
    it("lists no row for a verdict the project never emitted", () => {
      const rows = buildFacetItems(
        verdictSection([
          { value: "fail", count: 24 },
          { value: "pass", count: 72 },
        ]),
        false,
      );

      expect(rows.map((r) => r.value)).toEqual(["pass", "fail"]);
    });

    it("leaves a facet with no colour rule on the generic hash", () => {
      const rows = buildFacetItems(
        {
          ...verdictSection([{ value: "pass", count: 1 }]),
          key: "someUncuratedFacet",
        } as CategoricalSection,
        false,
      );

      expect(rows[0]?.dotColor).not.toBe("green.solid");
    });
  });

  describe("given the display order", () => {
    it("reads pass, fail, error — the drilldown's own sequence", () => {
      expect(FACET_VALUE_ORDER.evaluatorVerdict).toEqual([
        "pass",
        "fail",
        "error",
      ]);
    });

    /**
     * The regression this guards: ordering the facet through FACET_DEFAULTS
     * also SEEDS it. That map feeds `synthesizeDefaultDescriptors` and renders
     * its entries as zero-count rows, so a verdict the project has never
     * emitted would take up a permanent row in an already-dense section.
     * Order ranks what is present; it must not conjure anything.
     */
    it("does not seed the facet with verdict rows", () => {
      expect(FACET_DEFAULTS.evaluatorVerdict).toBeUndefined();
    });
  });

  describe("given values arriving in count order", () => {
    const verdictOrder = FACET_VALUE_ORDER.evaluatorVerdict;

    it("lifts the ranked verdicts above the count sort", () => {
      expect(
        orderValues({
          defaults: undefined,
          order: verdictOrder,
          fallback: ["fail", "pass", "error"],
          keys: ["fail", "pass", "error"],
        }),
      ).toEqual(["pass", "fail", "error"]);
    });

    it("leaves out a verdict the project never emitted", () => {
      expect(
        orderValues({
          defaults: undefined,
          order: verdictOrder,
          fallback: ["fail", "pass"],
          keys: ["fail", "pass"],
        }),
      ).toEqual(["pass", "fail"]);
    });

    it("trails the unranked verdicts behind, in the order they arrived", () => {
      expect(
        orderValues({
          defaults: undefined,
          order: verdictOrder,
          fallback: ["skipped", "unknown", "fail", "pass"],
          keys: ["skipped", "unknown", "fail", "pass"],
        }),
      ).toEqual(["pass", "fail", "skipped", "unknown"]);
    });
  });

  describe("given a facet with no order rule", () => {
    it("hands back the count sort untouched", () => {
      expect(
        orderValues({
          defaults: undefined,
          order: undefined,
          fallback: ["b", "a", "c"],
          keys: ["b", "a", "c"],
        }),
      ).toEqual(["b", "a", "c"]);
    });
  });
});
