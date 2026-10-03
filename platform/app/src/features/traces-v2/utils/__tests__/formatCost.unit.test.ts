/**
 * @vitest-environment node
 * @unit
 *
 * Costs as a reader meets them in the trace drawer and table.
 *
 * @see specs/traces-v2/metrics.feature
 */
import { describe, expect, it } from "vitest";

import { formatCost } from "../formatters";

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
      expect(formatCost(0.00001)).toBe("$0.000010");
      expect(formatCost(0.0005)).toBe("$0.00050");
      expect(formatCost(0.00000012)).toBe("$0.00000012");
    });

    it("keeps the estimate prefix", () => {
      expect(formatCost(0.0000358, true)).toBe("~$0.000036");
    });
  });

  describe("given a cost between a tenth of a cent and a cent", () => {
    it("reads with four decimals", () => {
      expect(formatCost(0.001)).toBe("$0.0010");
      expect(formatCost(0.003)).toBe("$0.0030");
      expect(formatCost(0.003, true)).toBe("~$0.0030");
    });
  });

  describe("given a cent or more", () => {
    it("reads with two decimals", () => {
      expect(formatCost(0.04)).toBe("$0.04");
      expect(formatCost(1.24)).toBe("$1.24");
      expect(formatCost(142)).toBe("$142.00");
    });
  });
});
