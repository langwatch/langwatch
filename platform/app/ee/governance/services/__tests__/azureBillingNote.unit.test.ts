// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the spend panel says about an Azure bill that shows nothing.
 *
 * The decision and its sentences live together because they fail together: a
 * reason the copy cannot say is a blank panel, and copy no decision produces
 * is dead text. Every sentence here explains an ABSENCE — the one thing this
 * module must never do is put a figure, or anything that reads as one, where
 * the bill put nothing.
 *
 * Spec: specs/governance/azure-billing-identity.feature
 * Decision: ADR-128 §21.3, §21.4 (v3.4).
 */

import { describe, expect, it } from "vitest";
import {
  azureBillingNoteFrom,
  azureBillingNoteSentence,
} from "../azureBillingNote";

/** A source that reads a bill and has read it clean: no rows, no hold. */
const READ_CLEAN = {
  claimsSubscription: true,
  prepaidDeclared: false,
  hasAzureSpendRows: false,
  costPricedThroughDay: "2026-08-30",
  costHeldSinceMs: null,
};

describe("azureBillingNoteFrom", () => {
  describe("given the customer declared prepaid packs and the bill came back empty", () => {
    /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
    it("answers with the prepaid explanation", () => {
      expect(
        azureBillingNoteFrom({ ...READ_CLEAN, prepaidDeclared: true }),
      ).toBe("prepaid_declared");
    });
  });

  describe("given nothing was declared and the bill came back empty", () => {
    /** @scenario "A tenant that declared nothing is never told it is prepaid" */
    it("answers that nothing was billed, never prepaid", () => {
      expect(azureBillingNoteFrom(READ_CLEAN)).toBe("no_spend_recorded");
    });
  });

  describe("given the bill holds amounts", () => {
    /** @scenario "A declared-prepaid tenant whose bill has amounts sees the amounts" */
    it("offers no note at all — the figures speak, even for a declared-prepaid tenant", () => {
      expect(
        azureBillingNoteFrom({
          ...READ_CLEAN,
          prepaidDeclared: true,
          hasAzureSpendRows: true,
        }),
      ).toBeNull();
    });
  });

  describe("given the last read is held", () => {
    /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
    it("reports the failed read, even when prepaid is declared", () => {
      // A held read means we do not know what the bill holds, and the prepaid
      // sentence claims we read it and it was empty. The failure outranks the
      // declaration because it is the only one of the two we can stand behind.
      expect(
        azureBillingNoteFrom({
          ...READ_CLEAN,
          prepaidDeclared: true,
          costHeldSinceMs: 1_700_000_000_000,
        }),
      ).toBe("billing_read_failed");
    });
  });

  describe("given no read has completed yet", () => {
    it("offers no note — awaiting a first read is not a finding", () => {
      expect(
        azureBillingNoteFrom({
          ...READ_CLEAN,
          costPricedThroughDay: null,
        }),
      ).toBeNull();
    });
  });

  describe("given no source claims a subscription", () => {
    it("offers no note — there is no bill to explain", () => {
      expect(
        azureBillingNoteFrom({
          ...READ_CLEAN,
          claimsSubscription: false,
          prepaidDeclared: true,
        }),
      ).toBeNull();
    });
  });
});

describe("azureBillingNoteSentence", () => {
  /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
  it("explains that prepaid packs do not appear on the bill", () => {
    const sentence = azureBillingNoteSentence("prepaid_declared");
    expect(sentence).toMatch(/prepaid/i);
    expect(sentence).toMatch(/bill/i);
  });

  /** @scenario "A tenant that declared nothing is never told it is prepaid" */
  it("says nothing was billed without ever mentioning prepaid", () => {
    const sentence = azureBillingNoteSentence("no_spend_recorded");
    expect(sentence).toMatch(/no .*charges|nothing .*billed/i);
    expect(sentence).not.toMatch(/prepaid/i);
  });

  it("reports a failed read as missing data, never as an empty bill", () => {
    const sentence = azureBillingNoteSentence("billing_read_failed");
    expect(sentence).toMatch(/could not|failed/i);
    expect(sentence).not.toMatch(/nothing was billed/i);
  });

  it("keeps every sentence free of digits, so none can read as a figure", () => {
    for (const note of [
      "prepaid_declared",
      "no_spend_recorded",
      "billing_read_failed",
    ] as const) {
      expect(azureBillingNoteSentence(note)).not.toMatch(/\d/);
    }
  });
});
