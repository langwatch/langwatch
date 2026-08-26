import { describe, expect, it } from "vitest";
import { FACET_REGISTRY } from "../../facet-registry";
import { FIELD_VALUES } from "@langwatch/trace-contract";

/**
 * Regression contract for the "Errored pill filtered the wrong bucket"
 * bug: the sidebar's erroredCount is countIf(Status = 'error'), so the
 * verdict facet expression must route Status='error' rows to a
 * dedicated 'error' value — with precedence over Passed — and the
 * query language must accept that value. Before this contract existed,
 * the pill emitted `evaluatorVerdict:unknown`, which is the
 * Passed-is-null-but-not-errored bucket.
 */
describe("evaluatorVerdict facet", () => {
  const def = FACET_REGISTRY.find((d) => d.key === "evaluatorVerdict");

  describe("when mapping evaluation rows to verdict values", () => {
    it("routes Status='error' to 'error' before consulting Passed", () => {
      expect(def).toBeDefined();
      const expression = (def as { expression?: string }).expression ?? "";
      const errorIdx = expression.indexOf("Status = 'error'");
      const passedIdx = expression.indexOf("Passed = 1");
      expect(errorIdx).toBeGreaterThanOrEqual(0);
      expect(passedIdx).toBeGreaterThan(errorIdx);
      expect(expression).toContain("'error'");
    });

    it("routes Status='skipped' to 'skipped' before consulting Passed (#6835)", () => {
      // A skipped run is "nothing to evaluate", not an unknown verdict —
      // burying it in 'unknown' next to score-only runs made it unfilterable.
      const expression = (def as { expression?: string }).expression ?? "";
      const skippedIdx = expression.indexOf("Status = 'skipped'");
      const passedIdx = expression.indexOf("Passed = 1");
      expect(skippedIdx).toBeGreaterThanOrEqual(0);
      expect(passedIdx).toBeGreaterThan(skippedIdx);
    });

    it("offers 'skipped' in the query-language vocabulary", () => {
      expect(FIELD_VALUES.evaluatorVerdict).toContain("skipped");
    });

    it("keeps FIELD_VALUES in sync with the expression's output set", () => {
      const expression = (def as { expression?: string }).expression ?? "";
      for (const value of FIELD_VALUES.evaluatorVerdict ?? []) {
        expect(expression).toContain(`'${value}'`);
      }
    });
  });
});
