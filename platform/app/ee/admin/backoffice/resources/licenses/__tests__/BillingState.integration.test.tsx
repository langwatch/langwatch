/**
 * @vitest-environment jsdom
 *
 * The commercial state of a connected customer, as the backoffice shows it.
 *
 * Spec: specs/self-hosting/connected-services/connected-billing.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BillingState, OpenInvoices } from "../BillingState";
import type { BillingOverview } from "../billingForm";

const TERM_START = new Date("2026-09-19T00:00:00.000Z");
const TERM_END = new Date("2027-09-19T00:00:00.000Z");
const SYNCED_AT = new Date("2026-11-02T08:00:00.000Z");

function overview(patch: Partial<BillingOverview> = {}): BillingOverview {
  return {
    account: {
      id: "cba_1",
      organizationId: "org_1",
      stripeCustomerId: "cus_1",
      usageSubscriptionId: "sub_1",
      usageSubscriptionItemId: "si_1",
      termStartsAt: TERM_START,
      termEndsAt: TERM_END,
      commitUsdCents: 100_000,
      seatCurrency: "EUR",
      seatRateCents: 60_000,
      seats: 50,
      bankTransferType: null,
      bankTransferCountry: null,
      billingEmail: "billing@acme.test",
      pendingRenewal: null,
    },
    grants: [],
    invoices: [],
    spend: {
      spendAvailable: true,
      limitUsdCents: 100_000,
      spentUsdCents: 42_000,
    },
    terms: {
      commitUsdCents: 100_000,
      maximumUsdCents: 150_000,
      overageEnabled: true,
    },
    seats: {
      licensed: 50,
      reported: 51,
      lastSyncAt: SYNCED_AT,
      currentQuarterPeak: 53,
    },
    trueUps: [],
    ...patch,
  } as BillingOverview;
}

function renderState(value: BillingOverview) {
  render(
    <ChakraProvider value={defaultSystem}>
      <BillingState overview={value} />
    </ChakraProvider>,
  );
}

describe("the connected billing panel", () => {
  describe("given a customer that was onboarded, has used hosted services and has synced", () => {
    /** @scenario The backoffice shows the commercial state of each connected customer */
    it("shows the commit, the amount drawn down, the overage, the seats and the last sync", () => {
      renderState(overview());

      expect(screen.getByText("1000.00 USD")).toBeTruthy();
      expect(screen.getByText("420.00 USD")).toBeTruthy();
      expect(screen.getByText("on, up to 500.00 USD")).toBeTruthy();
      expect(
        screen.getByText(/50 licensed, 51 reported, 53 peak this quarter/),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `${SYNCED_AT.toLocaleDateString()} ${SYNCED_AT.toLocaleTimeString()}`,
        ),
      ).toBeTruthy();
    });

    /** @scenario The backoffice shows the commercial state of each connected customer */
    it("lists the open invoices, each one markable as paid", () => {
      const onMarkPaid = vi.fn();
      render(
        <ChakraProvider value={defaultSystem}>
          <OpenInvoices
            overview={overview({
              invoices: [
                {
                  stripeInvoiceId: "in_open",
                  kind: "annual",
                  currency: "EUR",
                  amountCents: 3_100_000,
                  status: "open",
                  rolledForwardTo: null,
                  paidOutOfBandAt: null,
                  termStartsAt: TERM_START,
                },
                {
                  stripeInvoiceId: "in_paid",
                  kind: "usage",
                  currency: "USD",
                  amountCents: 5_000,
                  status: "paid",
                  rolledForwardTo: null,
                  paidOutOfBandAt: null,
                  termStartsAt: null,
                },
              ],
            })}
            onMarkPaid={onMarkPaid}
            isMarking={false}
          />
        </ChakraProvider>,
      );

      expect(screen.getByText("in_open")).toBeTruthy();
      expect(screen.queryByText("in_paid")).toBeNull();
      expect(screen.getByText("31000.00 EUR")).toBeTruthy();

      screen.getByText("Mark paid out of band").click();
      expect(onMarkPaid).toHaveBeenCalledWith("in_open");
    });
  });

  describe("when the spend ledger cannot be read", () => {
    /** @scenario The backoffice says so when live spend cannot be read */
    it("shows the drawn down amount as unavailable rather than zero", () => {
      renderState(
        overview({
          spend: {
            spendAvailable: false,
            limitUsdCents: 100_000,
            spentUsdCents: null,
          },
        }),
      );

      expect(screen.getByText("unavailable")).toBeTruthy();
      expect(screen.queryByText("0.00 USD")).toBeNull();
    });
  });

  describe("given a quarter that closed without a sync", () => {
    /** @scenario A customer that never synced is flagged, not invoiced on a guess */
    it("badges the customer for follow-up", () => {
      renderState(
        overview({
          trueUps: [
            {
              licenseId: "il_1",
              quarterStartsAt: TERM_START,
              addedSeats: 0,
              amountCents: 0,
              currency: "EUR",
              state: "flagged",
              stripeInvoiceId: null,
            },
          ],
        }),
      );

      expect(screen.getByText("Seat true-up needs follow-up")).toBeTruthy();
    });
  });
});
