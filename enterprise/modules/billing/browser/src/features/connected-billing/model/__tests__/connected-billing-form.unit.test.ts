import type { UiLicenseBillingSectionProps } from "@langwatch/browser-host/declarations";
/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { describe, expect, it } from "vitest";

import { billingFormFrom, contractPayload, onboardPayload } from "../connected-billing-form.ts";

const license: UiLicenseBillingSectionProps = {
  organizationId: "org-acme",
  organizationName: "Acme Corp",
  email: "buyer@acme.example",
  issuedAt: "2026-01-01T09:30:00.000Z",
  expiresAt: "2027-01-01T09:30:00.000Z",
  maxMembers: 25,
  seatRateCents: 400_00,
  seatCurrency: "EUR",
  commitUsdCents: 5_000_00,
};

describe("the connected billing form", () => {
  describe("given a customer never onboarded", () => {
    it("starts from the license's own terms", () => {
      expect(billingFormFrom({ account: null, license })).toEqual({
        billingEmail: "buyer@acme.example",
        termStartsAt: "2026-01-01",
        termEndsAt: "2027-01-01",
        seats: "25",
        seatRate: "400.00",
        seatCurrency: "EUR",
        commit: "5000.00",
        bankTransferType: "",
        bankTransferCountry: "",
      });
    });
  });

  describe("when the operator onboards on an EU bank transfer", () => {
    it("sends the term as UTC days and the country upper-cased", () => {
      const form = {
        ...billingFormFrom({ account: null, license }),
        bankTransferType: "eu_bank_transfer" as const,
        bankTransferCountry: "nl",
      };

      expect(onboardPayload({ form, license })).toEqual({
        organizationId: "org-acme",
        organizationName: "Acme Corp",
        billingEmail: "buyer@acme.example",
        bankTransfer: { type: "eu_bank_transfer", country: "NL" },
        termStartsAt: "2026-01-01T00:00:00.000Z",
        termEndsAt: "2027-01-01T00:00:00.000Z",
        seats: 25,
        seatRateCents: 400_00,
        seatCurrency: "EUR",
        commitUsdCents: 5_000_00,
      });
    });
  });

  describe("when the operator renews", () => {
    it("sends the contract without the payment fields", () => {
      const form = billingFormFrom({ account: null, license });

      expect(contractPayload({ form, organizationId: "org-acme" })).not.toHaveProperty(
        "bankTransfer",
      );
    });
  });
});
