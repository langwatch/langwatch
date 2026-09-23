/**
 * @vitest-environment jsdom
 * The connected billing panel of the license drawer.
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectedBillingState, OpenInvoices } from "../connected-billing-state.tsx";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function overview(overrides: Partial<ConnectedBillingOverview> = {}): ConnectedBillingOverview {
  return {
    account: {
      id: "account-acme",
      organizationId: "org-acme",
      stripeCustomerId: "cus_acme",
      termStartsAt: "2026-01-01T00:00:00Z",
      termEndsAt: "2027-01-01T00:00:00Z",
      commitUsdCents: 1_000_00,
      seatCurrency: "USD",
      seatRateCents: 500_00,
      seats: 50,
      bankTransferType: null,
      bankTransferCountry: null,
      billingEmail: "finance@acme.example",
      renewalPending: false,
    },
    grants: [],
    invoices: [],
    spend: { spendAvailable: true, limitUsdCents: 1_000_00, spentUsdCents: 420_00 },
    terms: { commitUsdCents: 1_000_00, maximumUsdCents: 1_500_00, overageEnabled: true },
    seats: { licensed: 50, reported: 51, lastSyncAt: "2026-08-01T00:00:00Z" },
    seatChanges: [],
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("the connected billing panel", () => {
  describe("given a customer that was onboarded, has used hosted services and has synced", () => {
    /** @scenario "The backoffice shows the commercial state of each connected customer" */
    it("shows the commit, the amount drawn down, the overage and the seats", () => {
      render(<ConnectedBillingState overview={overview()} />, { wrapper });

      expect(screen.getByText("1000.00 USD")).toBeInTheDocument();
      expect(screen.getByText("420.00 USD")).toBeInTheDocument();
      expect(screen.getByText("on, up to 500.00 USD")).toBeInTheDocument();
      expect(screen.getByText("50 licensed, 51 reported")).toBeInTheDocument();
    });

    /** @scenario "The backoffice shows the commercial state of each connected customer" */
    it("lists the open invoices, each one markable as paid", () => {
      const onMarkPaid = vi.fn();
      render(
        <OpenInvoices
          overview={overview({
            invoices: [
              {
                stripeInvoiceId: "in_open",
                kind: "annual",
                currency: "EUR",
                amountCents: 31_000_00,
                status: "open",
                paidOutOfBandAt: null,
              },
              {
                stripeInvoiceId: "in_paid",
                kind: "usage",
                currency: "USD",
                amountCents: 12_00,
                status: "paid",
                paidOutOfBandAt: null,
              },
            ],
          })}
          onMarkPaid={onMarkPaid}
          isMarking={false}
        />,
        { wrapper },
      );

      expect(screen.getByText("in_open")).toBeInTheDocument();
      expect(screen.queryByText("in_paid")).toBeNull();
      expect(screen.getByText("31000.00 EUR")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Mark paid out of band" }));
      expect(onMarkPaid).toHaveBeenCalledWith("in_open");
    });
  });

  describe("when the spend ledger cannot be read", () => {
    /** @scenario "The backoffice says so when live spend cannot be read" */
    it("shows the drawn down amount as unavailable rather than zero", () => {
      render(
        <ConnectedBillingState
          overview={overview({
            spend: { spendAvailable: false, limitUsdCents: 1_000_00, spentUsdCents: null },
          })}
        />,
        { wrapper },
      );

      expect(screen.getByText("unavailable")).toBeInTheDocument();
      expect(screen.queryByText("0.00 USD")).toBeNull();
    });
  });

  describe("given a seat change whose invoice is still pending", () => {
    /** @scenario "A seat invoice that failed at the payment provider is retried without doubling" */
    it("badges the customer so finance knows an invoice is still coming", () => {
      render(
        <ConnectedBillingState
          overview={overview({
            seatChanges: [
              {
                licenseId: "license-2",
                changedAt: "2026-08-02T00:00:00Z",
                addedSeats: 5,
                amountCents: 2_000_00,
                currency: "USD",
                state: "intent",
                stripeInvoiceId: null,
              },
            ],
          })}
        />,
        { wrapper },
      );

      expect(screen.getByText("Seat invoice pending")).toBeInTheDocument();
    });
  });
});
