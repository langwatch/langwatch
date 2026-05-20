import { describe, it, expect } from "vitest";
import { resolveRetentionDays } from "../resolveRetentionDays";
import { retentionPolicySchema } from "../retentionPolicy.schema";

describe("resolveRetentionDays", () => {
  describe("when project policy is set", () => {
    it("returns project-level value for the category", () => {
      const result = resolveRetentionDays({
        category: "traces",
        projectRetentionPolicy: { traces: 90, scenarios: 30, experiments: null },
        orgDefaultRetentionPolicy: { traces: 30, scenarios: 30, experiments: 30 },
      });
      expect(result).toBe(90);
    });
  });

  describe("when project policy category is null", () => {
    it("falls through to org default", () => {
      const result = resolveRetentionDays({
        category: "experiments",
        projectRetentionPolicy: { traces: 90, scenarios: 30, experiments: null },
        orgDefaultRetentionPolicy: { traces: 30, scenarios: 30, experiments: 60 },
      });
      expect(result).toBe(60);
    });
  });

  describe("when both project and org are null for category", () => {
    it("returns 0 (indefinite)", () => {
      const result = resolveRetentionDays({
        category: "scenarios",
        projectRetentionPolicy: { traces: 90, scenarios: null, experiments: null },
        orgDefaultRetentionPolicy: { traces: 30, scenarios: null, experiments: 30 },
      });
      expect(result).toBe(0);
    });
  });

  describe("when project policy is null entirely", () => {
    it("falls through to org default", () => {
      const result = resolveRetentionDays({
        category: "traces",
        projectRetentionPolicy: null,
        orgDefaultRetentionPolicy: { traces: 45, scenarios: 30, experiments: 30 },
      });
      expect(result).toBe(45);
    });
  });

  describe("when both policies are null", () => {
    it("returns 0 (indefinite)", () => {
      const result = resolveRetentionDays({
        category: "traces",
        projectRetentionPolicy: null,
        orgDefaultRetentionPolicy: null,
      });
      expect(result).toBe(0);
    });
  });
});

describe("retentionPolicySchema", () => {
  describe("when valid", () => {
    it("parses a complete policy", () => {
      const result = retentionPolicySchema.parse({
        traces: 30,
        scenarios: 60,
        experiments: null,
      });
      expect(result).toEqual({
        traces: 30,
        scenarios: 60,
        experiments: null,
      });
    });
  });

  describe("when below minimum", () => {
    it("rejects retention below 30 days", () => {
      expect(() =>
        retentionPolicySchema.parse({
          traces: 15,
          scenarios: 30,
          experiments: 30,
        }),
      ).toThrow();
    });
  });

  describe("when non-integer", () => {
    it("rejects floating-point values", () => {
      expect(() =>
        retentionPolicySchema.parse({
          traces: 30.5,
          scenarios: 30,
          experiments: 30,
        }),
      ).toThrow();
    });
  });
});
