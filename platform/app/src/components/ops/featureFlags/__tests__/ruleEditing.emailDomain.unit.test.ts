/**
 * The email domain scope in the targeting rules dialog: a stored
 * `emailDomain` opens as that scope with its domains, what the operator
 * types is stored lowercase without the `@`, and a rule that cannot match is
 * reported before it is saved.
 *
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it } from "vitest";
import {
  findUnfillableRule,
  parseEmailDomains,
  rulesToUI,
  uiToRules,
} from "../ruleEditing";

describe("given a stored rule enabling the flag for users at two domains", () => {
  const stored = [
    { match: { emailDomain: ["acme.com", "acme.io"] }, enabled: true },
  ];

  describe("when the rule is opened in the targeting rules dialog", () => {
    /** @scenario "the ops page reads and writes an email domain rule" */
    it("shows as an email domain rule with both domains and saves them back", () => {
      const ui = rulesToUI(stored);

      expect(ui).toHaveLength(1);
      expect(ui[0]).toMatchObject({
        scopeKind: "EMAIL_DOMAIN",
        target: "acme.com, acme.io",
        enabled: true,
        otherConditions: {},
      });

      expect(uiToRules(ui)).toEqual(stored);
    });
  });

  describe("when the operator types domains with an @, capitals and padding", () => {
    it("stores them lowercased and without the @", () => {
      const [rule] = rulesToUI(stored);
      if (!rule) throw new Error("expected one rule");

      expect(
        uiToRules([{ ...rule, target: " @Acme.com,ACME.io , " }])[0]?.match,
      ).toEqual({ emailDomain: ["acme.com", "acme.io"] });
    });
  });

  describe("when the operator types one domain", () => {
    it("stores it as a single string", () => {
      const [rule] = rulesToUI(stored);
      if (!rule) throw new Error("expected one rule");

      expect(uiToRules([{ ...rule, target: "acme.com" }])[0]?.match).toEqual({
        emailDomain: "acme.com",
      });
      expect(
        rulesToUI([{ match: { emailDomain: "acme.com" }, enabled: false }])[0],
      ).toMatchObject({ scopeKind: "EMAIL_DOMAIN", target: "acme.com" });
    });
  });

  describe("when the field is blank or a domain still carries an @", () => {
    it("is reported as unfillable rather than saved", () => {
      const [rule] = rulesToUI(stored);
      if (!rule) throw new Error("expected one rule");

      expect(findUnfillableRule([{ ...rule, target: "" }])).toBeDefined();
      expect(findUnfillableRule([{ ...rule, target: " , " }])).toBeDefined();
      expect(
        findUnfillableRule([{ ...rule, target: "qa@acme.com" }]),
      ).toBeDefined();
      expect(
        findUnfillableRule([{ ...rule, target: "acme.com" }]),
      ).toBeUndefined();
      expect(
        findUnfillableRule([{ ...rule, target: "@acme.com, acme.io" }]),
      ).toBeUndefined();
    });
  });

  describe("when the stored rule also names an organization", () => {
    it("keeps the organization as the scope and carries the domain along", () => {
      const ui = rulesToUI([
        {
          match: {
            organizationId: "organization_acme",
            emailDomain: "acme.com",
          },
          enabled: true,
        },
      ]);

      expect(ui[0]).toMatchObject({
        scopeKind: "ORGANIZATION",
        target: "organization_acme",
        otherConditions: { emailDomain: "acme.com" },
      });
      expect(uiToRules(ui)[0]?.match).toEqual({
        organizationId: "organization_acme",
        emailDomain: "acme.com",
      });
    });
  });
});

describe("parseEmailDomains", () => {
  it("splits on commas, lowercases, strips a leading @ and drops empties", () => {
    expect(parseEmailDomains("@Acme.com, acme.io,, ")).toEqual([
      "acme.com",
      "acme.io",
    ]);
    expect(parseEmailDomains("")).toEqual([]);
  });
});
