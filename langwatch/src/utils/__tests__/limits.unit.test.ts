/**
 * Unit tests for project limits utility functions.
 */
import { describe, it, expect } from "vitest";
import { isAtMaxProjects, canAddProjects, type UsageData } from "../limits";

describe("isAtMaxProjects", () => {
  describe("when usage data is undefined", () => {
    it("returns false", () => {
      expect(isAtMaxProjects(undefined)).toBe(false);
    });
  });

  describe("when below max projects", () => {
    it("returns false", () => {
      const usage: UsageData = {
        projectsCount: 3,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      expect(isAtMaxProjects(usage)).toBe(false);
    });
  });

  describe("when at max projects", () => {
    it("returns true when override is disabled", () => {
      const usage: UsageData = {
        projectsCount: 5,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      expect(isAtMaxProjects(usage)).toBe(true);
    });

    it("returns false when override is enabled", () => {
      const usage: UsageData = {
        projectsCount: 5,
        activePlan: { maxProjects: 5, overrideAddingLimitations: true },
      };
      expect(isAtMaxProjects(usage)).toBe(false);
    });

    it("returns false when override is undefined (treated as false)", () => {
      const usage: UsageData = {
        projectsCount: 5,
        activePlan: { maxProjects: 5 },
      };
      expect(isAtMaxProjects(usage)).toBe(true);
    });
  });

  describe("when over max projects", () => {
    it("returns true when override is disabled", () => {
      const usage: UsageData = {
        projectsCount: 10,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      expect(isAtMaxProjects(usage)).toBe(true);
    });

    it("returns false when override is enabled", () => {
      const usage: UsageData = {
        projectsCount: 10,
        activePlan: { maxProjects: 5, overrideAddingLimitations: true },
      };
      expect(isAtMaxProjects(usage)).toBe(false);
    });
  });
});

describe("canAddProjects", () => {
  describe("when usage data is undefined", () => {
    it("returns true", () => {
      expect(canAddProjects(undefined)).toBe(true);
    });
  });

  describe("when below max projects", () => {
    it("returns true", () => {
      const usage: UsageData = {
        projectsCount: 3,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      expect(canAddProjects(usage)).toBe(true);
    });
  });

  describe("when at max projects", () => {
    it("returns false when override is disabled", () => {
      const usage: UsageData = {
        projectsCount: 5,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      expect(canAddProjects(usage)).toBe(false);
    });

    it("returns true when override is enabled", () => {
      const usage: UsageData = {
        projectsCount: 5,
        activePlan: { maxProjects: 5, overrideAddingLimitations: true },
      };
      expect(canAddProjects(usage)).toBe(true);
    });
  });
});
