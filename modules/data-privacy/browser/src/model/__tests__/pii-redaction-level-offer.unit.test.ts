/**
 * The organization PII level picker's pure parts: the price billing charges, read as copy, and
 * the organization rule rewritten at a new level.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { describe, expect, it } from "vitest";

import {
  levelChangeConfirmation,
  organizationPiiLevel,
  organizationRule,
  PII_REDACTION_MODEL_PRICE,
  PII_REDACTION_MODEL_PRICE_UNIT,
  piiRedactionModelPrice,
  ruleSaveConfirmation,
  STRICT_FALLBACK_NOTE,
  withOrganizationPiiLevel,
} from "../pii-redaction-level-offer.ts";

describe("given the rate billing charges for the PII redaction model", () => {
  describe("when it is 500 nano-dollars per character", () => {
    /** @scenario The price is derived from the rate billing charges */
    it("reads $0.50 per 1M characters", () => {
      expect(piiRedactionModelPrice({ nanoUsdPerCharacter: 500 })).toBe("$0.50");
      expect(`${PII_REDACTION_MODEL_PRICE} ${PII_REDACTION_MODEL_PRICE_UNIT}`).toBe(
        "$0.50 per 1M characters excl. VAT, pay as you go",
      );
    });
  });

  describe("when the rate changes", () => {
    it("follows it", () => {
      expect(piiRedactionModelPrice({ nanoUsdPerCharacter: 1_250 })).toBe("$1.25");
    });
  });
});

describe("given an organization rule", () => {
  describe("when its PII level is custom with entities and an exception pattern", () => {
    /** @scenario Changing the organization level keeps the rest of the organization rule */
    it("sets strict, drops the entities and keeps the exception and every other field", () => {
      const next = withOrganizationPiiLevel({
        config: {
          categories: { input: { disposition: "drop" } },
          pii: { level: "custom", entities: ["PERSON"], exceptPatterns: ["RES-[0-9]{6}"] },
          secrets: { enabled: false },
        },
        level: "strict",
      });

      expect(next).toEqual({
        categories: { input: { disposition: "drop" } },
        pii: { level: "strict", exceptPatterns: ["RES-[0-9]{6}"] },
        secrets: { enabled: false },
      });
    });
  });

  describe("when it sets no PII level", () => {
    it("adds the level and no exceptions", () => {
      expect(withOrganizationPiiLevel({ config: {}, level: "essential" })).toEqual({
        pii: { level: "essential" },
      });
    });
  });
});

describe("given the rules a project's page reads", () => {
  const rule = (overrides: Partial<DataPrivacyRule>): DataPrivacyRule => ({
    scopeType: "ORGANIZATION",
    scopeId: "org-1",
    name: "Acme",
    personalOnly: false,
    config: {},
    ...overrides,
  });

  describe("when the organization has its own rule and a personal-projects rule", () => {
    it("picks the organization's own rule", () => {
      const own = rule({ config: { pii: { level: "strict" } } });
      const rules = [rule({ personalOnly: true }), rule({ scopeType: "TEAM", scopeId: "t" }), own];

      expect(organizationRule({ rules, organizationId: "org-1" })).toBe(own);
    });
  });

  describe("when the organization has no rule of its own", () => {
    it("finds none", () => {
      expect(organizationRule({ rules: [], organizationId: "org-1" })).toBeNull();
    });
  });
});

describe("given the organization's resolved PII level", () => {
  it("offers Essential and Strict and leaves Off and Custom unpicked", () => {
    expect(organizationPiiLevel("essential")).toBe("essential");
    expect(organizationPiiLevel("strict")).toBe("strict");
    expect(organizationPiiLevel("disabled")).toBeNull();
    expect(organizationPiiLevel("custom")).toBeNull();
  });
});

describe("given a change of the organization's level", () => {
  describe("when Essential turns into Strict for a paying organization", () => {
    it("asks with the model and its price", () => {
      expect(levelChangeConfirmation({ from: "essential", to: "strict", free: false })).toEqual({
        title: "Turn on Strict?",
        description:
          "Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters excl. VAT, pay as you go. Turn it on?",
        confirmLabel: "Turn on Strict",
      });
    });
  });

  describe("when the organization is free", () => {
    it("turns Strict on without asking", () => {
      expect(levelChangeConfirmation({ from: "essential", to: "strict", free: true })).toBeNull();
    });
  });

  describe("when Custom turns into Essential", () => {
    it("asks before replacing the custom settings", () => {
      expect(
        levelChangeConfirmation({ from: "custom", to: "essential", free: false })?.description,
      ).toBe("This replaces your custom PII settings with Essential.");
    });
  });

  describe("when Custom turns into Strict for a paying organization", () => {
    it("asks once, naming both", () => {
      expect(
        levelChangeConfirmation({ from: "custom", to: "strict", free: false })?.description,
      ).toBe(
        "This replaces your custom PII settings. Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters excl. VAT, pay as you go. Turn it on?",
      );
    });
  });

  describe("when Strict goes back to Essential", () => {
    it("needs no confirmation", () => {
      expect(levelChangeConfirmation({ from: "strict", to: "essential", free: false })).toBeNull();
    });
  });
});

describe("given the fallback note", () => {
  /** @scenario The settings page names the model's own length limit */
  it("names the limit the process routes by, on a span's text combined", () => {
    expect(STRICT_FALLBACK_NOTE).toContain(
      `over ${PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS.toLocaleString("en-US")} characters in total`,
    );
    expect(STRICT_FALLBACK_NOTE).toContain("rule-based detector (Presidio)");
    expect(STRICT_FALLBACK_NOTE).toContain("Google Cloud DLP");
  });
});

describe("given a rule saved from the drawer", () => {
  const model = { kind: "model", free: false } as const;

  describe("when it turns Strict on where Strict is the model at a price", () => {
    it("asks with the price", () => {
      expect(
        ruleSaveConfirmation({
          offer: model,
          before: { pii: { level: "essential" } },
          after: { pii: { level: "strict" } },
        })?.confirmLabel,
      ).toBe("Turn on Strict");
    });
  });

  /** @scenario Saving a rule asks for the price only when it turns Strict on at a price */
  it("does not ask when nothing new is billed", () => {
    const strict = { pii: { level: "strict" as const } };
    expect(ruleSaveConfirmation({ offer: model, before: strict, after: strict })).toBeNull();
    expect(
      ruleSaveConfirmation({
        offer: { kind: "model", free: true },
        before: undefined,
        after: strict,
      }),
    ).toBeNull();
    expect(
      ruleSaveConfirmation({ offer: { kind: "rule-based" }, before: undefined, after: strict }),
    ).toBeNull();
    expect(ruleSaveConfirmation({ offer: null, before: undefined, after: strict })).toBeNull();
    expect(
      ruleSaveConfirmation({
        offer: model,
        before: undefined,
        after: { pii: { level: "essential" } },
      }),
    ).toBeNull();
  });
});
