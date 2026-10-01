/** @see specs/self-hosting/connected-services/connected-billing.feature */
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import { hasUnsettledSeatChange } from "../seat-change-copy.ts";

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

describe("whether the Billing section keeps rereading", () => {
  /** @scenario "The Billing section rereads until a seat change settles" */
  it("rereads while a change awaits billing or the payment provider, and stops once all settled", () => {
    const base: Omit<ConnectedBillingOverview, "seatChanges"> = {
      account: null,
      grants: [],
      invoices: [],
      spend: { spendAvailable: false, limitUsdCents: 0, spentUsdCents: null },
      terms: { commitUsdCents: 0, maximumUsdCents: 0, overageEnabled: false },
      seats: { licensed: 0, reported: null, lastSyncAt: null },
    };

    expect(hasUnsettledSeatChange({ ...base, seatChanges: [change("awaiting")] })).toBe(true);
    expect(hasUnsettledSeatChange({ ...base, seatChanges: [change("intent")] })).toBe(true);
    expect(
      hasUnsettledSeatChange({
        ...base,
        seatChanges: [change("invoiced"), change("not_onboarded"), change("nothing_to_invoice")],
      }),
    ).toBe(false);
    expect(hasUnsettledSeatChange(undefined)).toBe(false);
  });
});
