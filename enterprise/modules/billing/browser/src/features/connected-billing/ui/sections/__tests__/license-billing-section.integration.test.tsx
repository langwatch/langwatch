/**
 * @vitest-environment jsdom
 * The Billing section of the license drawer: a trial reads as one line, and
 * starting billing signs the paid term on the license before onboarding.
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { LicenseBillingSectionProps } from "@langwatch/enterprise-billing-client";
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LicenseBillingSection from "../license-billing-section.tsx";

const mocks = vi.hoisted(() => ({
  overview: { current: undefined as unknown },
  onboard: vi.fn(),
}));

vi.mock("../../../behavior/connected-billing-api.ts", () => ({
  connectedBillingApi: {
    connectedBilling: {
      get: { useQuery: () => ({ data: mocks.overview.current, error: null }) },
    },
  },
}));

vi.mock("../../../behavior/use-connected-billing-commands.ts", () => {
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    useConnectedBillingCommands: () => ({
      onboard: { mutateAsync: mocks.onboard, isPending: false },
      addCommit: idle,
      renew: idle,
      markPaidOutOfBand: idle,
    }),
  };
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const trialOverview: ConnectedBillingOverview = {
  account: null,
  grants: [],
  invoices: [],
  spend: { spendAvailable: false, limitUsdCents: 0, spentUsdCents: null },
  terms: { commitUsdCents: 0, maximumUsdCents: 0, overageEnabled: false },
  seats: { licensed: 25, reported: null, lastSyncAt: null },
  seatChanges: [],
};

function license(overrides: Partial<LicenseBillingSectionProps> = {}): LicenseBillingSectionProps {
  return {
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@acme.example",
    issuedAt: "2099-10-14T12:00:00.000Z",
    expiresAt: "2099-12-14T12:00:00.000Z",
    maxMembers: 25,
    seatRateCents: 500_00,
    seatCurrency: "USD",
    commitUsdCents: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.overview.current = trialOverview;
  mocks.onboard.mockReset();
  mocks.onboard.mockResolvedValue({});
});

afterEach(() => cleanup());

const startBilling = () => {
  fireEvent.click(screen.getByRole("button", { name: "Start billing" }));
  fireEvent.click(screen.getByRole("button", { name: "Start billing" }));
};

describe("the Billing section of the license drawer", () => {
  describe("given a license whose organization was never onboarded", () => {
    /** @scenario "A license with no billing account reads as a trial" */
    it("says in one line it is not billed and when the trial ends, and offers Start billing", () => {
      const onBillingState = vi.fn();
      render(<LicenseBillingSection {...license({ onBillingState })} />, { wrapper });

      expect(screen.getByText("Not billed. The trial ends Dec 14, 2099.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start billing" })).toBeInTheDocument();
      expect(screen.queryByText("Paid term ends")).not.toBeInTheDocument();
      expect(onBillingState).toHaveBeenCalledWith("trial");
    });
  });

  describe("given a trial license ending Dec 14", () => {
    /** @scenario "Starting billing signs the paid term on the license, then onboards" */
    it("signs the license to Dec 14 next year, then onboards for the same term", async () => {
      const calls: string[] = [];
      const signPaidTerm = vi.fn(async () => {
        calls.push("sign");
        return true;
      });
      mocks.onboard.mockImplementation(async () => calls.push("onboard"));
      render(<LicenseBillingSection {...license({ signPaidTerm })} />, { wrapper });

      startBilling();

      await waitFor(() => expect(mocks.onboard).toHaveBeenCalledTimes(1));
      expect(signPaidTerm).toHaveBeenCalledWith({ expiresAt: "2100-12-14T12:00:00.000Z" });
      expect(calls).toEqual(["sign", "onboard"]);
      expect(mocks.onboard.mock.calls[0]?.[0]).toMatchObject({
        organizationId: "org-acme",
        termStartsAt: "2099-12-14T00:00:00.000Z",
        termEndsAt: "2100-12-14T00:00:00.000Z",
      });
    });
  });

  describe("given a trial license whose reissue is refused", () => {
    /** @scenario "Starting billing stops before onboarding when the license cannot be signed" */
    it("onboards nothing and says the license step failed", async () => {
      const signPaidTerm = vi.fn(async () => false);
      render(<LicenseBillingSection {...license({ signPaidTerm })} />, { wrapper });

      startBilling();

      expect(await screen.findByTestId("paid-term-failure")).toHaveTextContent(
        "The license step failed, so nothing was billed.",
      );
      expect(mocks.onboard).not.toHaveBeenCalled();
    });
  });

  describe("given an onboarding that opened the account but sent no annual invoice", () => {
    /** @scenario "Billing that stopped part way stays on Start billing" */
    it("says billing did not finish and offers Start billing, not Renew", () => {
      mocks.overview.current = {
        ...trialOverview,
        account: {
          id: "acct-1",
          organizationId: "org-acme",
          stripeCustomerId: "cus_test",
          termStartsAt: "2099-12-14T00:00:00.000Z",
          termEndsAt: "2100-12-14T00:00:00.000Z",
          commitUsdCents: 0,
          seatCurrency: "USD",
          seatRateCents: 500_00,
          seats: 25,
          bankTransferType: null,
          bankTransferCountry: null,
          billingEmail: "ops@acme.example",
          renewalPending: false,
        },
      };
      const onBillingState = vi.fn();
      render(<LicenseBillingSection {...license({ onBillingState })} />, { wrapper });

      expect(
        screen.getByText(
          "Billing was started but did not finish. Start billing again to finish it.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start billing" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Renew for the next term" })).toBeNull();
      expect(onBillingState).toHaveBeenCalledWith("trial");
    });

    /** @scenario "Retrying billing that stopped part way bills the term the account holds" */
    it("starts billing again for the account's own term without signing again", async () => {
      mocks.overview.current = {
        ...trialOverview,
        account: {
          id: "acct-1",
          organizationId: "org-acme",
          stripeCustomerId: "cus_test",
          termStartsAt: "2099-12-14T00:00:00.000Z",
          termEndsAt: "2100-12-14T00:00:00.000Z",
          commitUsdCents: 0,
          seatCurrency: "USD",
          seatRateCents: 500_00,
          seats: 25,
          bankTransferType: null,
          bankTransferCountry: null,
          billingEmail: "ops@acme.example",
          renewalPending: false,
        },
      };
      const signPaidTerm = vi.fn(async () => true);
      const signed = license({ signPaidTerm, expiresAt: "2100-12-14T12:00:00.000Z" });
      render(<LicenseBillingSection {...signed} />, { wrapper });

      startBilling();

      await waitFor(() => expect(mocks.onboard).toHaveBeenCalledTimes(1));
      expect(signPaidTerm).not.toHaveBeenCalled();
      expect(mocks.onboard.mock.calls[0]?.[0]).toMatchObject({
        termStartsAt: "2099-12-14T00:00:00.000Z",
        termEndsAt: "2100-12-14T00:00:00.000Z",
      });
    });
  });

  describe("given a trial license with Start billing open", () => {
    /** @scenario "A paid term with an empty end day cannot be submitted" */
    it("asks for both days and disables Start billing when the end day is cleared", () => {
      render(<LicenseBillingSection {...license()} />, { wrapper });
      fireEvent.click(screen.getByRole("button", { name: "Start billing" }));

      fireEvent.change(screen.getByLabelText("Paid term ends"), { target: { value: "" } });

      expect(screen.getByTestId("paid-term-problem")).toHaveTextContent(
        "Enter the day the paid term starts and the day it ends.",
      );
      expect(screen.getByRole("button", { name: "Start billing" })).toBeDisabled();
    });
  });

  describe("given a signed paid term whose onboarding failed", () => {
    /** @scenario "Retrying after billing failed bills the term that was signed" */
    it("does not sign again and onboards the term that was signed", async () => {
      const signPaidTerm = vi.fn(async () => true);
      mocks.onboard.mockRejectedValueOnce(new Error("billing down"));
      const { rerender } = render(<LicenseBillingSection {...license({ signPaidTerm })} />, {
        wrapper,
      });
      startBilling();
      expect(await screen.findByTestId("paid-term-failure")).toHaveTextContent(
        "but billing did not start",
      );

      const signed = license({ signPaidTerm, expiresAt: "2100-12-14T12:00:00.000Z" });
      rerender(<LicenseBillingSection {...signed} />);
      fireEvent.click(screen.getByRole("button", { name: "Start billing" }));

      await waitFor(() => expect(mocks.onboard).toHaveBeenCalledTimes(2));
      expect(signPaidTerm).toHaveBeenCalledTimes(1);
      expect(mocks.onboard.mock.calls[1]?.[0]).toMatchObject({
        termStartsAt: "2099-12-14T00:00:00.000Z",
        termEndsAt: "2100-12-14T00:00:00.000Z",
      });
    });
  });
});
