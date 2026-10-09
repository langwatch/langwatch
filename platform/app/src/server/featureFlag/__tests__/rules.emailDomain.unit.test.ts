/**
 * @vitest-environment node
 *
 * The email domain condition: a rule that names the domain of the signed-in
 * user's email instead of an id, matching every user at that domain and no
 * one else. The comparison is on the part after the last `@`, ignores case,
 * and is exact, so a subdomain only matches when listed. A read with no user
 * email never matches: a condition the matcher cannot evaluate must not
 * become a rule with no condition.
 *
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it } from "vitest";
import {
  emailDomainsOf,
  evaluateRules,
  type FeatureFlagRules,
  featureFlagRulesWriteSchema,
} from "../rules";

function domainRule(emailDomain: string | string[]): FeatureFlagRules {
  return [{ match: { emailDomain }, enabled: true }];
}

function readFor(
  rules: FeatureFlagRules,
  userEmail: string | undefined,
): boolean | null {
  return evaluateRules(rules, {
    organizationId: "organization_1",
    distinctId: "user_1",
    flagKey: "experiment_onboarding_langy_guided",
    userEmail,
  });
}

describe("given a rule enabling the flag for users at acme.com", () => {
  const rules = domainRule("acme.com");

  describe("when the flag is read for a user at that domain", () => {
    /** @scenario "an email domain rule enables the flag for a user at that domain" */
    it("resolves enabled from the rule", () => {
      expect(readFor(rules, "qa@acme.com")).toBe(true);
    });
  });

  describe("when the flag is read for a user at another domain", () => {
    /** @scenario "a user at another domain sees no change" */
    it("matches nothing, so the read falls through to the row-level default", () => {
      expect(readFor(rules, "someone@example.com")).toBeNull();
    });
  });

  describe("when the email's domain differs only in case", () => {
    /** @scenario "the domain comparison ignores the case of the email" */
    it("matches", () => {
      expect(readFor(rules, "QA@Acme.COM")).toBe(true);
    });
  });

  describe("when the email is at a subdomain", () => {
    /** @scenario "a subdomain only matches when it is listed" */
    it("does not match, because the comparison is exact", () => {
      expect(readFor(rules, "qa@eu.acme.com")).toBeNull();
      expect(
        readFor(domainRule(["acme.com", "eu.acme.com"]), "qa@eu.acme.com"),
      ).toBe(true);
    });
  });

  describe("when the flag is read with no user email", () => {
    /** @scenario "a read with no user email matches no email domain rule" */
    it("matches nothing rather than every caller whose email is unknown", () => {
      expect(readFor(rules, undefined)).toBeNull();
      expect(readFor(rules, "")).toBeNull();
      expect(
        evaluateRules(rules, { organizationId: "organization_1" }),
      ).toBeNull();
    });
  });

  describe("when the email has no @ at all", () => {
    it("matches nothing", () => {
      expect(readFor(rules, "acme.com")).toBeNull();
    });
  });

  describe("when the local part itself contains an @", () => {
    it("compares the part after the last @", () => {
      expect(readFor(rules, '"a@b"@acme.com')).toBe(true);
      expect(readFor(rules, "acme.com@example.com")).toBeNull();
    });
  });
});

describe("given a rule naming several domains", () => {
  const rules = domainRule(["acme.com", "acme.io"]);

  describe("when the flag is read for users at each of them", () => {
    /** @scenario "a rule may name several domains" */
    it("matches either domain and no third one", () => {
      expect(readFor(rules, "qa@acme.com")).toBe(true);
      expect(readFor(rules, "qa@acme.io")).toBe(true);
      expect(readFor(rules, "qa@acme.dev")).toBeNull();
    });
  });
});

describe("given a rule naming both an organization and a domain", () => {
  const rules: FeatureFlagRules = [
    {
      match: { organizationId: "organization_acme", emailDomain: "acme.com" },
      enabled: true,
    },
  ];

  describe("when a user at that domain reads from another organization", () => {
    /** @scenario "an email domain rule combines with the other conditions" */
    it("does not match, and matches from the named organization", () => {
      expect(
        evaluateRules(rules, {
          organizationId: "organization_other",
          userEmail: "qa@acme.com",
        }),
      ).toBeNull();
      expect(
        evaluateRules(rules, {
          organizationId: "organization_acme",
          userEmail: "qa@acme.com",
        }),
      ).toBe(true);
      expect(
        evaluateRules(rules, {
          organizationId: "organization_acme",
          userEmail: "qa@example.com",
        }),
      ).toBeNull();
    });
  });
});

describe("given rules where a domain rule sits above a catch-all", () => {
  describe("when users inside and outside the domain read the flag", () => {
    it("keeps first-match-wins", () => {
      const rules: FeatureFlagRules = [
        { match: { emailDomain: "acme.com" }, enabled: false },
        { match: {}, enabled: true },
      ];
      expect(readFor(rules, "qa@acme.com")).toBe(false);
      expect(readFor(rules, "qa@example.com")).toBe(true);
    });
  });
});

describe("given an operator writing an email domain rule", () => {
  describe("when a domain is blank, padded, carries an @ or is not lowercase", () => {
    /** @scenario "an operator cannot save an email domain rule that cannot match" */
    it("is rejected with a message naming the expected form", () => {
      for (const bad of [
        "",
        " acme.com",
        "@acme.com",
        "Acme.com",
        "acme .com",
      ]) {
        const result = featureFlagRulesWriteSchema.safeParse(domainRule(bad));
        expect(result.success, bad).toBe(false);
        if (result.success) continue;
        expect(result.error.issues[0]?.message).toContain(
          "lowercase domains without the @",
        );
      }
      expect(
        featureFlagRulesWriteSchema.safeParse(domainRule([])).success,
      ).toBe(false);
      expect(
        featureFlagRulesWriteSchema.safeParse(domainRule(["acme.com", ""]))
          .success,
      ).toBe(false);
    });
  });

  describe("when the domains are in their stored form", () => {
    it("is accepted, as one domain or several", () => {
      expect(
        featureFlagRulesWriteSchema.safeParse(domainRule("acme.com")).success,
      ).toBe(true);
      expect(
        featureFlagRulesWriteSchema.safeParse(
          domainRule(["acme.com", "acme.io"]),
        ).success,
      ).toBe(true);
    });
  });
});

describe("emailDomainsOf", () => {
  it("lists one domain, several, or none", () => {
    expect(emailDomainsOf("acme.com")).toEqual(["acme.com"]);
    expect(emailDomainsOf(["acme.com", "acme.io"])).toEqual([
      "acme.com",
      "acme.io",
    ]);
    expect(emailDomainsOf(undefined)).toEqual([]);
  });
});
