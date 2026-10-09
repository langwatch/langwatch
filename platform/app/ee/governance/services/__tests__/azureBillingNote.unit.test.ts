// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the spend panel decides about an Azure bill that shows nothing.
 *
 * Only the DECISION lives here. The sentences each note renders as are panel
 * copy, tested where they live —
 * `src/components/governance/__tests__/costLaneFormat.unit.test.ts`.
 *
 * Spec: specs/governance/azure-billing-identity.feature
 * Decision: ADR-128 §21.3, §21.4 (v3.4).
 */

import { describe, expect, it } from "vitest";
import { azureBillingNoteFrom } from "../azureBillingNote";

/** A source that reads a bill and has read it clean: no rows, no hold. */
const READ_CLEAN = {
  hasSubscriptionClaim: true,
  isPrepaidDeclared: false,
  hasAzureSpendRows: false,
  costPricedThroughDay: "2026-08-30",
  costHeldSinceMs: null,
};

describe("azureBillingNoteFrom", () => {
  describe("given the customer declared prepaid packs and the bill came back empty", () => {
    /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
    it("answers with the prepaid explanation", () => {
      expect(
        azureBillingNoteFrom({ ...READ_CLEAN, isPrepaidDeclared: true }),
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
          isPrepaidDeclared: true,
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
          isPrepaidDeclared: true,
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
          hasSubscriptionClaim: false,
          isPrepaidDeclared: true,
        }),
      ).toBeNull();
    });
  });
});
