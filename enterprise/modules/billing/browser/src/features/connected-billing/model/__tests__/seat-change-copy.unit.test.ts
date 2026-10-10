/** @see specs/self-hosting/connected-services/connected-billing.feature */
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import { isSeatChangeUnsettled } from "../seat-change-copy.ts";

type SeatChange = ConnectedBillingOverview["seatChanges"][number];

const change = (state: SeatChange["state"]): SeatChange => ({
  licenseId: `license-${state}`,
  changedAt: "2026-08-02T00:00:00Z",
  addedSeats: 5,
  amountCents: 0,
  currency: null,
  state,
  stripeInvoiceId: null,
});

describe("isSeatChangeUnsettled", () => {
  describe("when billing or the payment provider has not settled the change", () => {
    it("is unsettled while it awaits billing or holds an intent", () => {
      expect(isSeatChangeUnsettled(change("awaiting"))).toBe(true);
      expect(isSeatChangeUnsettled(change("intent"))).toBe(true);
    });
  });

  describe("when the change has settled", () => {
    it("is settled once invoiced, not onboarded or with nothing to invoice", () => {
      expect(isSeatChangeUnsettled(change("invoiced"))).toBe(false);
      expect(isSeatChangeUnsettled(change("not_onboarded"))).toBe(false);
      expect(isSeatChangeUnsettled(change("nothing_to_invoice"))).toBe(false);
    });
  });
});
