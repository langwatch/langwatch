/**
 * The cost and latency labels of the suites page.
 * @see specs/scenarios/suites-page-metrics-display.feature
 */
import { describe, expect, it } from "vitest";

import { formatCost, formatLatency } from "../formatters.ts";

describe("formatCost()", () => {
  it("prints three decimals, so 0.024 reads $0.024 and 0.003 reads $0.003", () => {
    expect(formatCost(0.024)).toBe("$0.024");
    expect(formatCost(0.003)).toBe("$0.003");
  });

  it("keeps the fourth decimal when it is not zero", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("reads a missing cost as a dash", () => {
    expect(formatCost(null)).toBe("-");
  });
});

describe("formatLatency()", () => {
  it("reads 3200ms as 3.2s and 450ms as 450ms", () => {
    expect(formatLatency(3_200)).toBe("3.2s");
    expect(formatLatency(450)).toBe("450ms");
  });
});
