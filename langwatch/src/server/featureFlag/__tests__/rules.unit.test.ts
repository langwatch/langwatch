import { describe, it, expect } from "vitest";
import {
  evaluateRules,
  parseRules,
  type FeatureFlagRules,
} from "../rules";

describe("evaluateRules", () => {
  describe("when no rule matches", () => {
    it("returns null so callers can fall back to the row default", () => {
      const rules: FeatureFlagRules = [
        { match: { organizationId: "org_other" }, enabled: true },
      ];
      expect(evaluateRules(rules, { organizationId: "org_self" })).toBeNull();
    });
  });

  describe("when an organization-scoped rule matches the context", () => {
    it("returns the rule's enabled value without consulting later rules", () => {
      const rules: FeatureFlagRules = [
        { match: { organizationId: "org_a" }, enabled: true },
        { match: { organizationId: "org_a" }, enabled: false },
      ];
      expect(evaluateRules(rules, { organizationId: "org_a" })).toBe(true);
    });
  });

  describe("when a project-scoped rule overrides a broader earlier rule", () => {
    it("returns the first matching rule's value (order wins)", () => {
      const rules: FeatureFlagRules = [
        { match: { projectId: "proj_x" }, enabled: false },
        { match: { organizationId: "org_a" }, enabled: true },
      ];
      const enabled = evaluateRules(rules, {
        projectId: "proj_x",
        organizationId: "org_a",
      });
      expect(enabled).toBe(false);
    });
  });

  describe("when a rule has an empty match", () => {
    it("matches every context so it acts as a default-rule", () => {
      const rules: FeatureFlagRules = [
        { match: { projectId: "proj_other" }, enabled: false },
        { match: {}, enabled: true },
      ];
      expect(evaluateRules(rules, { projectId: "proj_self" })).toBe(true);
    });
  });

  describe("when both projectId and organizationId are required", () => {
    it("only matches when every specified field equals the context", () => {
      const rules: FeatureFlagRules = [
        {
          match: { projectId: "proj_a", organizationId: "org_a" },
          enabled: true,
        },
      ];
      expect(
        evaluateRules(rules, { projectId: "proj_a", organizationId: "org_b" }),
      ).toBeNull();
      expect(
        evaluateRules(rules, { projectId: "proj_a", organizationId: "org_a" }),
      ).toBe(true);
    });
  });
});

describe("parseRules", () => {
  describe("when given null or undefined", () => {
    it("returns an empty list rather than throwing", () => {
      expect(parseRules(null)).toEqual([]);
      expect(parseRules(undefined)).toEqual([]);
    });
  });

  describe("when given a malformed payload", () => {
    it("returns an empty list so a bad row never 500s a flag check", () => {
      expect(parseRules({ not: "an array" })).toEqual([]);
      expect(parseRules([{ match: "wrong" }])).toEqual([]);
    });
  });

  describe("when the payload carries unknown match fields", () => {
    it("preserves them via passthrough so a newer writer's rule still parses", () => {
      const parsed = parseRules([
        {
          match: { organizationId: "org_a", futureField: "x" },
          enabled: true,
        },
      ]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.enabled).toBe(true);
      expect(parsed[0]?.match.organizationId).toBe("org_a");
    });
  });
});
