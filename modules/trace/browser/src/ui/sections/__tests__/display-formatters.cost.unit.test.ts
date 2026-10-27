import { formatCost } from "@langwatch/design-system/display-formatters";
/**
 * @vitest-environment node
 * @unit
 * @see specs/traces-v2/metrics.feature
 */
import { describe, expect, it } from "vitest";

describe("formatCost", () => {
  describe("given no cost", () => {
    it("reads as the empty placeholder", () => {
      expect(formatCost(0)).toBe("—");
    });
  });

  describe("given a cost below a tenth of a cent", () => {
    /** @scenario "A cost below a tenth of a cent keeps its leading digits" */
    it("keeps the two leading digits", () => {
      expect(formatCost(0.0000358)).toBe("$0.000036");
      expect(formatCost(0.00015)).toBe("$0.00015");
      expect(formatCost(0.00000012)).toBe("$0.00000012");
    });

    it("adds no padding after them", () => {
      expect(formatCost(0.0005)).toBe("$0.0005");
      expect(formatCost(0.00001)).toBe("$0.00001");
    });

    it("reads as a tenth of a cent when it rounds up to one", () => {
      expect(formatCost(0.0009999)).toBe("$0.0010");
    });

    it("stays above zero for a cost far below any real price", () => {
      expect(formatCost(1.5e-15)).toBe("$0.0000000000000015");
    });

    it("keeps the estimate prefix", () => {
      expect(formatCost(0.0000358, true)).toBe("~$0.000036");
    });
  });

  describe("given a cost between a tenth of a cent and a cent", () => {
    /** @scenario "Sub-cent cost shows four decimal places" */
    it("reads with four decimals", () => {
      expect(formatCost(0.001)).toBe("$0.0010");
      expect(formatCost(0.003)).toBe("$0.0030");
    });

    /** @scenario "Estimated cost shows tilde prefix" */
    it("marks an estimate with a tilde", () => {
      expect(formatCost(0.003, true)).toBe("~$0.0030");
    });
  });

  describe("given a cent or more", () => {
    /** @scenario "Cent-range cost shows two decimal places" */
    it("reads cents with two decimals", () => {
      expect(formatCost(0.04)).toBe("$0.04");
    });

    /** @scenario "Dollar-range cost shows two decimal places" */
    it("reads dollars with two decimals", () => {
      expect(formatCost(1.24)).toBe("$1.24");
    });

    /** @scenario "High cost still uses two decimal places" */
    it("reads a high cost with two decimals", () => {
      expect(formatCost(142)).toBe("$142.00");
    });
  });
});
