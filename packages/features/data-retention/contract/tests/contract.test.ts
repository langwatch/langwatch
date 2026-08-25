import { describe, expect, it } from "vitest";
import { retentionDaysInputSchema, resolveRetention } from "../src";

describe("data-retention contract", () => {
  it("accepts only the indefinite sentinel or aligned retention values", () => {
    expect(retentionDaysInputSchema.parse(0)).toBe(0);
    expect(retentionDaysInputSchema.parse(49)).toBe(49);
    expect(() => retentionDaysInputSchema.parse(42)).toThrow();
  });

  it("resolves each category from the nearest scope", () => {
    expect(resolveRetention({
      rows: [
        { scopeType: "ORGANIZATION", scopeId: "org", category: "traces", retentionDays: 63 },
        { scopeType: "PROJECT", scopeId: "project", category: "scenarios", retentionDays: 91 },
      ],
      chain: [
        { scopeType: "PROJECT", scopeId: "project" },
        { scopeType: "TEAM", scopeId: "team" },
        { scopeType: "ORGANIZATION", scopeId: "org" },
      ],
      defaultRetentionDays: 49,
    })).toEqual({ traces: 63, scenarios: 91, experiments: 49 });
  });
});
