/**
 * The percentage rule in the one-line targeting summary under a flag's
 * toggle: an enabling percentage rule is named, a disabling one is not, and a
 * percentage that also names an organization speaks for that organization
 * alone.
 */
import { describe, expect, it } from "vitest";
import { summarizeTargeting, targetingLabel } from "../targetingSummary";

describe("given a rule enabling the flag for half the users", () => {
  const rules = [{ match: { percentageRollout: 50 }, enabled: true }];

  describe("when the summary is rendered", () => {
    it("names the share", () => {
      const summary = summarizeTargeting(rules);
      expect(summary.enabledPercentage).toBe(50);
      expect(targetingLabel(summary)).toBe("Enabled for 50% of users");
    });
  });
});

describe("given a percentage rule that disables the flag", () => {
  describe("when the summary is rendered", () => {
    it("names no share, because the rule switches nobody on", () => {
      const summary = summarizeTargeting([
        { match: { percentageRollout: 50 }, enabled: false },
      ]);
      expect(summary.enabledPercentage).toBeNull();
      expect(targetingLabel(summary)).toBeNull();
    });
  });
});

describe("given a percentage rule scoped to one organization", () => {
  describe("when the summary is rendered", () => {
    it("counts the organization and not the share", () => {
      const summary = summarizeTargeting([
        {
          match: { organizationId: "organization_acme", percentageRollout: 50 },
          enabled: true,
        },
      ]);
      expect(summary.enabledPercentage).toBeNull();
      expect(summary.enabledOrganizationCount).toBe(1);
      expect(targetingLabel(summary)).toBe("Enabled for 1 organization");
    });
  });
});
