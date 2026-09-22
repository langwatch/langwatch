/**
 * @vitest-environment node
 *
 * A rule naming the user's email domain instead of an id; no email, no match.
 */
import { describe, expect, it } from "vitest";

import {
  emailDomainsOf,
  evaluateRules,
  type FeatureFlagRules,
  featureFlagRulesWriteSchema,
} from "../feature-flag-rules.ts";

function domainRule(emailDomain: string | string[]): FeatureFlagRules {
  return [{ match: { emailDomain }, enabled: true }];
}

function readFor(rules: FeatureFlagRules, userEmail: string | undefined): boolean | null {
  return evaluateRules(rules, {
    organizationId: "organization_1",
    bucketingId: "user_1",
    userEmail,
  });
}

describe("given a rule enabling the flag for users at acme.com", () => {
  const rules = domainRule("acme.com");

  it("resolves enabled for a user at that domain", () => {
    expect(readFor(rules, "qa@acme.com")).toBe(true);
  });

  it("matches nothing for a user at another domain", () => {
    expect(readFor(rules, "someone@example.com")).toBeNull();
  });

  it("ignores the case of the email", () => {
    expect(readFor(rules, "QA@Acme.COM")).toBe(true);
  });

  it("does not match a subdomain, because the comparison is exact", () => {
    expect(readFor(rules, "qa@eu.acme.com")).toBeNull();
    expect(readFor(domainRule(["acme.com", "eu.acme.com"]), "qa@eu.acme.com")).toBe(true);
  });

  it("matches nothing rather than every caller whose email is unknown", () => {
    expect(readFor(rules, undefined)).toBeNull();
    expect(readFor(rules, "")).toBeNull();
    expect(evaluateRules(rules, { organizationId: "organization_1" })).toBeNull();
  });

  it("matches nothing when the email has no @ at all", () => {
    expect(readFor(rules, "acme.com")).toBeNull();
  });

  it("compares the part after the last @", () => {
    expect(readFor(rules, '"a@b"@acme.com')).toBe(true);
    expect(readFor(rules, "acme.com@example.com")).toBeNull();
  });
});

describe("given a rule naming several domains", () => {
  const rules = domainRule(["acme.com", "acme.io"]);

  it("matches either domain and no third one", () => {
    expect(readFor(rules, "qa@acme.com")).toBe(true);
    expect(readFor(rules, "qa@acme.io")).toBe(true);
    expect(readFor(rules, "qa@acme.dev")).toBeNull();
  });
});

describe("given a rule naming both an organization and a domain", () => {
  const rules: FeatureFlagRules = [
    { match: { organizationId: "organization_acme", emailDomain: "acme.com" }, enabled: true },
  ];

  it("combines with the other conditions", () => {
    expect(
      evaluateRules(rules, { organizationId: "organization_other", userEmail: "qa@acme.com" }),
    ).toBeNull();
    expect(
      evaluateRules(rules, { organizationId: "organization_acme", userEmail: "qa@acme.com" }),
    ).toBe(true);
    expect(
      evaluateRules(rules, { organizationId: "organization_acme", userEmail: "qa@example.com" }),
    ).toBeNull();
  });
});

describe("given rules where a domain rule sits above a catch-all", () => {
  it("keeps first-match-wins", () => {
    const rules: FeatureFlagRules = [
      { match: { emailDomain: "acme.com" }, enabled: false },
      { match: {}, enabled: true },
    ];
    expect(readFor(rules, "qa@acme.com")).toBe(false);
    expect(readFor(rules, "qa@example.com")).toBe(true);
  });
});

describe("given an operator writing an email domain rule", () => {
  it("rejects a domain that is blank, padded, carries an @ or is not lowercase", () => {
    for (const bad of ["", " acme.com", "@acme.com", "Acme.com", "acme .com"]) {
      const result = featureFlagRulesWriteSchema.safeParse(domainRule(bad));
      expect(result.success, bad).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0]?.message).toContain("lowercase domains without the @");
    }
    expect(featureFlagRulesWriteSchema.safeParse(domainRule([])).success).toBe(false);
    expect(featureFlagRulesWriteSchema.safeParse(domainRule(["acme.com", ""])).success).toBe(false);
  });

  it("accepts domains in their stored form, one or several", () => {
    expect(featureFlagRulesWriteSchema.safeParse(domainRule("acme.com")).success).toBe(true);
    expect(featureFlagRulesWriteSchema.safeParse(domainRule(["acme.com", "acme.io"])).success).toBe(
      true,
    );
  });
});

describe("emailDomainsOf", () => {
  it("lists one domain, several, or none", () => {
    expect(emailDomainsOf("acme.com")).toEqual(["acme.com"]);
    expect(emailDomainsOf(["acme.com", "acme.io"])).toEqual(["acme.com", "acme.io"]);
    expect(emailDomainsOf(undefined)).toEqual([]);
  });
});
