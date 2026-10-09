/**
 * The email domain rule in the one-line targeting summary under a flag's
 * toggle: an enabling domain rule names its domains, a disabling one is not
 * named, and a domain rule that also names an organization speaks for that
 * organization alone.
 *
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it } from "vitest";
import { summarizeTargeting, targetingLabel } from "../targetingSummary";

describe("given a rule enabling the flag for users at acme.com", () => {
  describe("when the summary is rendered", () => {
    /** @scenario "the note under the toggle names the domains a rule switched the flag on for" */
    it("names the domain", () => {
      const summary = summarizeTargeting([
        { match: { emailDomain: "acme.com" }, enabled: true },
      ]);
      expect(summary.enabledEmailDomains).toEqual(["acme.com"]);
      expect(targetingLabel(summary)).toBe("Enabled for users at acme.com");
    });
  });
});

describe("given a rule enabling the flag for users at several domains", () => {
  describe("when the summary is rendered", () => {
    it("names every domain", () => {
      const summary = summarizeTargeting([
        { match: { emailDomain: ["acme.com", "acme.io"] }, enabled: true },
      ]);
      expect(targetingLabel(summary)).toBe(
        "Enabled for users at acme.com, acme.io",
      );
    });
  });
});

describe("given a domain rule that disables the flag", () => {
  describe("when the summary is rendered", () => {
    it("names no domain, because the rule switches no one on", () => {
      const summary = summarizeTargeting([
        { match: { emailDomain: "acme.com" }, enabled: false },
      ]);
      expect(summary.enabledEmailDomains).toEqual([]);
      expect(targetingLabel(summary)).toBeNull();
    });
  });
});

describe("given a domain rule scoped to one organization", () => {
  describe("when the summary is rendered", () => {
    it("counts the organization and not the domain", () => {
      const summary = summarizeTargeting([
        {
          match: {
            organizationId: "organization_acme",
            emailDomain: "acme.com",
          },
          enabled: true,
        },
      ]);
      expect(summary.enabledEmailDomains).toEqual([]);
      expect(summary.enabledOrganizationCount).toBe(1);
      expect(targetingLabel(summary)).toBe("Enabled for 1 organization");
    });
  });
});

describe("given a domain rule next to a percentage rule", () => {
  describe("when the summary is rendered", () => {
    it("names both, in the order the label lists them", () => {
      const summary = summarizeTargeting([
        { match: { emailDomain: "acme.com" }, enabled: true },
        { match: { percentageRollout: 50 }, enabled: true },
      ]);
      expect(targetingLabel(summary)).toBe(
        "Enabled for 50% of users, users at acme.com",
      );
    });
  });
});
