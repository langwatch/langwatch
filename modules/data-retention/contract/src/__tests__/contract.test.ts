import { describe, expect, it } from "vitest";

import { retentionDaysInputSchema, resolveRetention } from "../index.ts";

describe("data-retention contract", () => {
  /** @scenario "Reject invalid retention values" */
  it("accepts only the indefinite sentinel or aligned retention values", () => {
    // Acceptance stated as acceptance. `parse(0)).toBe(0)` passed for any
    // schema that lets 0 through, which is every schema that does not reject it.
    expect(retentionDaysInputSchema.validate(0)).toBe(true);
    expect(retentionDaysInputSchema.validate(49)).toBe(true);
    expect(retentionDaysInputSchema.validate(42)).toBe(false);
  });

  /** @scenario "Resolve retention through the scope cascade" */
  it("resolves each category from the nearest scope", () => {
    expect(
      resolveRetention({
        rows: [
          {
            scopeType: "ORGANIZATION",
            scopeId: "org",
            category: "traces",
            retentionDays: 63,
          },
          {
            scopeType: "PROJECT",
            scopeId: "project",
            category: "scenarios",
            retentionDays: 91,
          },
        ],
        chain: [
          { scopeType: "PROJECT", scopeId: "project" },
          { scopeType: "TEAM", scopeId: "team" },
          { scopeType: "ORGANIZATION", scopeId: "org" },
        ],
        defaultRetentionDays: 49,
      }),
    ).toEqual({ traces: 63, scenarios: 91, experiments: 49 });
  });
});
