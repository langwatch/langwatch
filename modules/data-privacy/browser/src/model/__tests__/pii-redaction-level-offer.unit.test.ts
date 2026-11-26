/**
 * The organization PII level picker's pure parts: the price billing charges, read as copy, and
 * the organization rule rewritten at a new level.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import {
  PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS,
  PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { describe, expect, it } from "vitest";

import {
  levelChangeConfirmation,
  organizationPiiLevel,
  organizationRule,
  PII_REDACTION_MODEL_PRICE_UNIT,
  piiRedactionModelOfferOf,
  piiRedactionModelPrice,
  piiRedactionModelPriceIn,
  RULE_SAVE_WAITING,
  ruleSaveStep,
  strictFallbackNote,
  STRICT_RULE_BASED_NOTES,
  withOrganizationPiiLevel,
} from "../pii-redaction-level-offer.ts";

type Licence = Parameters<typeof piiRedactionModelOfferOf>[0]["licence"];

describe("given the deployment and the PII redaction model flags", () => {
  describe("when the deployment is self-hosted", () => {
    const selfHosted = ({
      licence,
      modelFlag,
      mayManageLicence = true,
    }: {
      licence: Licence;
      modelFlag: boolean | undefined;
      mayManageLicence?: boolean;
    }) =>
      piiRedactionModelOfferOf({
        isSaaS: false,
        modelFlag,
        freeFlag: false,
        splitFlag: true,
        licence,
        mayManageLicence,
        currency: "USD",
      });

    /** @scenario The Strict offer on a self-hosted deployment follows the license and the model flag */
    it("offers the model, never priced, only with an Enterprise licence and the flag on", () => {
      expect(selfHosted({ licence: "enterprise", modelFlag: true })).toEqual({
        kind: "model",
        free: true,
        split: false,
        licensed: true,
      });
    });

    it("says how to turn the model on with the licence and no flag", () => {
      expect(selfHosted({ licence: "enterprise", modelFlag: false })).toEqual({
        kind: "rule-based",
        note: "turn-on",
      });
    });

    it("advertises the licence without it, whatever the flag says", () => {
      expect(selfHosted({ licence: "none", modelFlag: true })).toEqual({
        kind: "rule-based",
        note: "licence",
        activate: true,
      });
      expect(selfHosted({ licence: "none", modelFlag: false })).toEqual({
        kind: "rule-based",
        note: "licence",
        activate: true,
      });
    });

    it("links the advert to activating a licence only for a reader who may manage it", () => {
      expect(selfHosted({ licence: "none", modelFlag: true, mayManageLicence: false })).toEqual({
        kind: "rule-based",
        note: "licence",
        activate: false,
      });
    });

    it("offers nothing while the plan is not answered yet or cannot be read", () => {
      expect(selfHosted({ licence: "loading", modelFlag: true })).toBeNull();
      expect(selfHosted({ licence: "unknown", modelFlag: true })).toBeNull();
    });

    it("offers nothing with the licence while the model flag is not answered yet", () => {
      expect(selfHosted({ licence: "enterprise", modelFlag: undefined })).toBeNull();
    });

    it("never names LangWatch Cloud in a self-hosted note, and spells license as the app does", () => {
      for (const note of Object.values(STRICT_RULE_BASED_NOTES)) {
        expect(note).not.toMatch(/cloud/i);
        expect(note).not.toMatch(/licence/i);
      }
    });
  });

  describe("when the deployment is LangWatch Cloud", () => {
    it("offers the model only with the flag, priced unless the organization is free", () => {
      const cloud = ({
        modelFlag,
        freeFlag,
        splitFlag = false,
      }: {
        modelFlag: boolean;
        freeFlag: boolean;
        splitFlag?: boolean;
      }) =>
        piiRedactionModelOfferOf({
          isSaaS: true,
          modelFlag,
          freeFlag,
          splitFlag,
          licence: "none",
          mayManageLicence: true,
          currency: "USD",
        });
      expect(cloud({ modelFlag: false, freeFlag: true })).toBeNull();
      expect(cloud({ modelFlag: true, freeFlag: false })).toEqual({
        kind: "model",
        free: false,
        split: false,
        currency: "USD",
      });
      expect(cloud({ modelFlag: true, freeFlag: true })).toEqual({
        kind: "model",
        free: true,
        split: false,
        licensed: false,
      });
    });

    /** @scenario The settings page names the model's own length limit */
    it("carries the organization's split flag on Cloud, never self-hosted", () => {
      const cloud = piiRedactionModelOfferOf({
        isSaaS: true,
        modelFlag: true,
        freeFlag: false,
        splitFlag: true,
        licence: "none",
        mayManageLicence: true,
        currency: "USD",
      });
      expect(cloud).toEqual({ kind: "model", free: false, split: true, currency: "USD" });
      const selfHosted = piiRedactionModelOfferOf({
        isSaaS: false,
        modelFlag: true,
        freeFlag: false,
        splitFlag: true,
        licence: "enterprise",
        mayManageLicence: true,
        currency: "USD",
      });
      expect(selfHosted).toMatchObject({ kind: "model", split: false });
    });

    /** @scenario "Strict shows the euro price to an organization on a euro Growth subscription" */
    it("prices the model in the subscription's currency", () => {
      expect(
        piiRedactionModelOfferOf({
          isSaaS: true,
          modelFlag: true,
          freeFlag: false,
          splitFlag: false,
          licence: "unknown",
          mayManageLicence: true,
          currency: "EUR",
        }),
      ).toEqual({ kind: "model", free: false, split: false, currency: "EUR" });
    });

    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it("quotes no price until the subscription's currency is read, loading or failed", () => {
      expect(
        piiRedactionModelOfferOf({
          isSaaS: true,
          modelFlag: true,
          freeFlag: false,
          splitFlag: false,
          licence: "unknown",
          mayManageLicence: true,
          currency: "unknown",
        }),
      ).toEqual({ kind: "price-unknown" });
    });

    it("offers Strict as included to a free organization whatever the currency reading", () => {
      expect(
        piiRedactionModelOfferOf({
          isSaaS: true,
          modelFlag: true,
          freeFlag: true,
          splitFlag: false,
          licence: "unknown",
          mayManageLicence: true,
          currency: "unknown",
        }),
      ).toEqual({ kind: "model", free: true, split: false, licensed: false });
    });
  });
});

describe("given the rate billing charges for the PII redaction model", () => {
  describe("when it is 500 nano-dollars per character", () => {
    /** @scenario The price is derived from the rate billing charges */
    it("reads $0.50 per 1M characters", () => {
      expect(piiRedactionModelPrice({ nanoUsdPerCharacter: 500, currency: "USD" })).toBe("$0.50");
      expect(`${piiRedactionModelPriceIn("USD")} ${PII_REDACTION_MODEL_PRICE_UNIT}`).toBe(
        "$0.50 per 1M characters excl. VAT, pay as you go",
      );
    });
  });

  describe("when the rate changes", () => {
    it("follows it", () => {
      expect(piiRedactionModelPrice({ nanoUsdPerCharacter: 1_250, currency: "USD" })).toBe("$1.25");
    });
  });

  describe("when the organization's subscription is in euros", () => {
    /** @scenario "The euro price is 0.85 of the dollar rate" */
    it("reads €0.425 per 1M characters, 0.85 of the dollar rate unrounded", () => {
      expect(piiRedactionModelPrice({ nanoUsdPerCharacter: 500, currency: "EUR" })).toBe("€0.425");
      expect(piiRedactionModelPrice({ nanoUsdPerCharacter: 1_000, currency: "EUR" })).toBe("€0.85");
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
  const priced = { kind: "model", free: false, split: false, currency: "USD" } as const;
  const included = { kind: "model", free: true, split: false, licensed: false } as const;

  describe("when Essential turns into Strict for a paying organization", () => {
    it("asks with the model and its price", () => {
      expect(levelChangeConfirmation({ from: "essential", to: "strict", model: priced })).toEqual({
        title: "Turn on Strict?",
        description:
          "Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters excl. VAT, pay as you go. Turn it on?",
        confirmLabel: "Turn on Strict",
      });
    });
  });

  describe("when Essential turns into Strict for an organization paying in euros", () => {
    /** @scenario "Strict shows the euro price to an organization on a euro Growth subscription" */
    it("asks with the euro price", () => {
      expect(
        levelChangeConfirmation({
          from: "essential",
          to: "strict",
          model: { ...priced, currency: "EUR" },
        })?.description,
      ).toBe(
        "Strict uses the LangWatch PII Redaction Model at €0.425 per 1M characters excl. VAT, pay as you go. Turn it on?",
      );
    });
  });

  describe("when the organization is free", () => {
    it("turns Strict on without asking", () => {
      expect(
        levelChangeConfirmation({ from: "essential", to: "strict", model: included }),
      ).toBeNull();
    });
  });

  describe("when Custom turns into Essential", () => {
    it("asks before replacing the custom settings", () => {
      expect(
        levelChangeConfirmation({ from: "custom", to: "essential", model: priced })?.description,
      ).toBe("This replaces your custom PII settings with Essential.");
    });
  });

  describe("when Custom turns into Strict for a paying organization", () => {
    it("asks once, naming both", () => {
      expect(
        levelChangeConfirmation({ from: "custom", to: "strict", model: priced })?.description,
      ).toBe(
        "This replaces your custom PII settings. Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters excl. VAT, pay as you go. Turn it on?",
      );
    });
  });

  describe("when Strict goes back to Essential", () => {
    it("needs no confirmation", () => {
      expect(
        levelChangeConfirmation({ from: "strict", to: "essential", model: priced }),
      ).toBeNull();
    });
  });
});

describe("given the fallback note", () => {
  /** @scenario The settings page names the model's own length limit */
  it("names the limit the process routes by, on a span's text combined", () => {
    const note = strictFallbackNote({ split: false });
    expect(note).toContain(
      `over ${PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS.toLocaleString("en-US")} characters in total`,
    );
    expect(note).toContain("rule-based detector (Presidio)");
    expect(note).toContain("Google Cloud DLP");
    expect(note).not.toContain("several parts");
  });

  /** @scenario The settings page names the model's own length limit */
  it("names the split limit and how a split span is billed when splitting is on", () => {
    const note = strictFallbackNote({ split: true });
    expect(note).toContain(
      `over ${PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS.toLocaleString("en-US")} characters in total`,
    );
    expect(note).toContain("billed once on its own characters");
    expect(note).toContain("the overlap between parts is free");
  });

  /** @scenario With long-span splitting on, the small print names the split limit and how a split span is billed */
  it("names no billing for a split span where Strict is included", () => {
    const note = strictFallbackNote({ split: true, free: true });
    expect(note).toContain(
      `A span over ${PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS.toLocaleString("en-US")} characters is sent to the model in several parts.`,
    );
    expect(note).not.toContain("billed");
  });
});

describe("given a rule saved from the drawer", () => {
  const model = { kind: "model", free: false, split: false, currency: "USD" } as const;
  const turnsStrictOn = {
    before: { pii: { level: "essential" as const } },
    after: { pii: { level: "strict" as const } },
  };
  const confirmationOf = (step: ReturnType<typeof ruleSaveStep>) =>
    step.kind === "ask" ? step.confirmation : null;

  describe("when it turns Strict on where Strict is the model at a euro price", () => {
    /** @scenario "Saving a rule at Strict asks with the euro price on a euro Growth subscription" */
    it("asks with the euro price", () => {
      const step = ruleSaveStep({ offer: { ...model, currency: "EUR" }, ...turnsStrictOn });
      expect(confirmationOf(step)?.description).toContain("€0.425 per 1M characters");
    });
  });

  describe("when it turns Strict on where Strict is the model at a price", () => {
    it("asks with the price", () => {
      expect(confirmationOf(ruleSaveStep({ offer: model, ...turnsStrictOn }))?.confirmLabel).toBe(
        "Turn on Strict",
      );
    });
  });

  describe("when it turns Strict on before the subscription's currency is read", () => {
    /** @scenario "A Strict rule save waits for the subscription's currency" */
    it("waits rather than saving unasked, and its message quotes no price", () => {
      expect(ruleSaveStep({ offer: { kind: "price-unknown" }, ...turnsStrictOn })).toEqual({
        kind: "wait",
      });
      expect(RULE_SAVE_WAITING.description).not.toMatch(/[$€]/);
    });
  });

  /** @scenario Saving a rule asks for the price only when it turns Strict on at a price */
  it("does not ask when nothing new is billed", () => {
    const strict = { pii: { level: "strict" as const } };
    const save = { kind: "save" };
    expect(ruleSaveStep({ offer: model, before: strict, after: strict })).toEqual(save);
    expect(
      ruleSaveStep({ offer: { kind: "price-unknown" }, before: strict, after: strict }),
    ).toEqual(save);
    expect(
      ruleSaveStep({
        offer: { kind: "model", free: true, split: false, licensed: false },
        before: undefined,
        after: strict,
      }),
    ).toEqual(save);
    expect(
      ruleSaveStep({
        offer: { kind: "rule-based", note: "licence", activate: true },
        before: undefined,
        after: strict,
      }),
    ).toEqual(save);
    expect(ruleSaveStep({ offer: null, before: undefined, after: strict })).toEqual(save);
    expect(
      ruleSaveStep({ offer: model, before: undefined, after: { pii: { level: "essential" } } }),
    ).toEqual(save);
  });
});
