import { describe, it, expect } from "vitest";
import {
  evaluateRules,
  parseRules,
  resolveEffectiveForListing,
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

  describe("when a rule carries an unknown match key (forward-compat)", () => {
    it("fails closed so a newer writer's condition doesn't silently match everyone", () => {
      // A future writer ships { match: { percentageRollout: 10 }, enabled: true }.
      // An older reader doesn't know about percentageRollout — without
      // the fail-closed guard this would degenerate to an empty match
      // and turn into a global on-switch.
      const rules: FeatureFlagRules = [
        {
          match: { percentageRollout: 10 } as unknown as FeatureFlagRules[number]["match"],
          enabled: true,
        },
      ];
      expect(
        evaluateRules(rules, {
          projectId: "proj_a",
          organizationId: "org_a",
        }),
      ).toBeNull();
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

describe("resolveEffectiveForListing", () => {
  describe("when an env override is set", () => {
    it("wins over rules, row default, and registry default", () => {
      expect(
        resolveEffectiveForListing({
          envOverride: false,
          rules: [{ match: {}, enabled: true }],
          rowEnabled: true,
          registryDefault: true,
        }),
      ).toBe(false);
    });
  });

  describe("when an empty-match rule disables the flag", () => {
    it("returns false even when the row toggle is on (regression: ops UI must not contradict the resolver)", () => {
      // Resolver semantics: an empty-match rule matches every context
      // and wins via first-match. Before this helper existed, the Ops
      // table read `row.enabled` directly and showed "on" while the
      // resolver returned false for every caller.
      expect(
        resolveEffectiveForListing({
          envOverride: null,
          rules: [{ match: {}, enabled: false }],
          rowEnabled: true,
          registryDefault: true,
        }),
      ).toBe(false);
    });
  });

  describe("when only per-target rules are present", () => {
    it("falls through to the row toggle because the listing has no context", () => {
      // Per-org/per-project rules don't match the empty default context
      // so the listing falls through to the row-level toggle, then to
      // the registry default. The targeting UI surfaces those rules
      // separately.
      expect(
        resolveEffectiveForListing({
          envOverride: null,
          rules: [{ match: { organizationId: "org_a" }, enabled: true }],
          rowEnabled: false,
          registryDefault: true,
        }),
      ).toBe(false);
    });
  });

  describe("when nothing else applies", () => {
    it("returns the registry default", () => {
      expect(
        resolveEffectiveForListing({
          envOverride: null,
          rules: [],
          rowEnabled: null,
          registryDefault: true,
        }),
      ).toBe(true);
    });
  });
});
