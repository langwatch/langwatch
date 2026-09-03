import { describe, expect, it } from "vitest";
import { retentionDaysInputSchema, resolveRetention } from "../index";

describe("data-retention contract", () => {
  /** @scenario "Reject invalid retention values" */
  it("accepts only the indefinite sentinel or aligned retention values", () => {
    // Acceptance stated as acceptance. `parse(0)).toBe(0)` passed for any
    // schema that lets 0 through, which is every schema that does not reject it.
    expect(retentionDaysInputSchema.safeParse(0).success).toBe(true);
    expect(retentionDaysInputSchema.safeParse(49).success).toBe(true);
    expect(retentionDaysInputSchema.safeParse(42).success).toBe(false);
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
