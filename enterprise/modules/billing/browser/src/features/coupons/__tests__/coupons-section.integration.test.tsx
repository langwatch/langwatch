/**
 * @vitest-environment jsdom
 * The Cloud admin console's Coupons page, over a mocked billingCoupons client.
 * @see enterprise/modules/billing/specs/coupons.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { CouponView } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CouponsSection from "../ui/sections/coupons-section.tsx";

const half: CouponView = {
  id: "coupon_half",
  name: "Half off",
  percentOff: 50,
  amountOff: null,
  currency: null,
  duration: "repeating",
  durationInMonths: 2,
  products: [{ id: "prod_seats", role: "growth_seats" }],
  valid: true,
  timesRedeemed: 1,
  maxRedemptions: null,
  redeemBy: null,
  createdAt: "2026-11-01T00:00:00Z",
  codes: [
    {
      id: "promo_half",
      code: "HALF50",
      active: true,
      timesRedeemed: 1,
      maxRedemptions: 10,
      expiresAt: "2027-01-31T23:59:59Z",
      createdAt: "2026-11-01T00:00:00Z",
      firstTimeTransaction: false,
      minimumAmount: null,
      minimumAmountCurrency: null,
      customerId: null,
      verdict: { accepted: true, reasons: [], warnings: [] },
    },
  ],
};

const fixed: CouponView = {
  ...half,
  id: "coupon_fixed",
  name: "Fixed off",
  percentOff: null,
  amountOff: 2900,
  currency: "eur",
  codes: [
    {
      ...half.codes[0]!,
      id: "promo_fixed",
      code: "FIXED29",
      verdict: {
        accepted: false,
        reasons: [
          {
            code: "amount_off",
            message: "Fixed-amount coupons are refused on the prorated checkout",
          },
        ],
        warnings: [],
      },
    },
  ],
};

const list: { data?: { coupons: CouponView[] }; error: unknown; isLoading: boolean } = {
  data: { coupons: [] },
  error: null,
  isLoading: false,
};
const refetch = vi.fn();
const created: unknown[] = [];
const deactivated: unknown[] = [];

vi.mock("../behavior/billing-coupons-api.ts", () => ({
  billingCouponsApi: {
    useUtils: () => ({ billingCoupons: { invalidate: vi.fn().mockResolvedValue(undefined) } }),
    billingCoupons: {
      list: { useQuery: () => ({ ...list, isFetching: false, refetch }) },
      create: {
        useMutation: () => ({
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            created.push(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      deactivateCode: {
        useMutation: () => ({
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            deactivated.push(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const renderPage = () => render(<CouponsSection />, { wrapper });

async function fill(label: string, value: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
}

describe("CouponsSection", () => {
  beforeEach(() => {
    list.data = { coupons: [] };
    list.error = null;
    list.isLoading = false;
    created.length = 0;
    deactivated.length = 0;
    refetch.mockReset();
  });
  afterEach(cleanup);

  describe("given coupons with their codes", () => {
    /** @scenario "Coupons and their promotion codes are listed" */
    it("shows each coupon's terms and each code with its checkout verdict", () => {
      list.data = { coupons: [fixed, half] };

      renderPage();

      expect(screen.getByText("Half off")).toBeInTheDocument();
      expect(screen.getByText("50% off")).toBeInTheDocument();
      expect(screen.getByText("€29.00 off")).toBeInTheDocument();
      expect(screen.getAllByText("For 2 months")).toHaveLength(2);
      expect(screen.getAllByText("Growth Seats")).toHaveLength(2);
      expect(screen.getByText("HALF50")).toBeInTheDocument();
      expect(screen.getAllByText("1 of 10")).toHaveLength(2);
      expect(screen.getByText("Works at checkout")).toBeInTheDocument();
      expect(screen.getByText("Refused")).toBeInTheDocument();
      expect(
        screen.getByText("Fixed-amount coupons are refused on the prorated checkout"),
      ).toBeInTheDocument();
    });
  });

  describe("when the operator opens the page", () => {
    /** @scenario "The page says no code discounts the prorated first charge" */
    it("says the first charge is never discounted and the months count from checkout", () => {
      renderPage();

      expect(
        screen.getByText(/No code discounts the first charge up to the 1st of next month/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/the discount months count from the day of checkout/),
      ).toBeInTheDocument();
    });
  });

  describe("when the coupons cannot be read", () => {
    /** @scenario "The list fails clearly when Stripe is unreachable" */
    it("says so instead of an empty list, and retries on request", () => {
      list.data = undefined;
      list.error = new Error("unreachable");

      renderPage();

      expect(screen.getByText("Couldn't load coupons")).toBeInTheDocument();
      expect(screen.queryByText("No coupons yet")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe("when the operator creates a coupon", () => {
    /** @scenario "The operator creates a percentage coupon with a code" */
    it("sends a percentage coupon with its code from the drawer", async () => {
      renderPage();
      fireEvent.click(screen.getAllByRole("button", { name: /new coupon/i })[0]!);

      await fill("Percent off", "50");
      await fill("Code", "welcome50");
      fireEvent.click(await screen.findByRole("button", { name: "Create coupon" }));

      await waitFor(() =>
        expect(created).toEqual([
          {
            percentOff: 50,
            duration: "repeating",
            durationInMonths: 2,
            code: "WELCOME50",
            includeEvents: false,
          },
        ]),
      );
    });

    /** @scenario "An invalid coupon is refused before it reaches Stripe" */
    it("names the field and sends nothing for a discount out of range", async () => {
      renderPage();
      fireEvent.click(screen.getAllByRole("button", { name: /new coupon/i })[0]!);

      await fill("Percent off", "101");
      await fill("Code", "half off!");
      fireEvent.click(await screen.findByRole("button", { name: "Create coupon" }));

      expect(
        await screen.findByText("The discount must be between 1% and 100%"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Codes use letters, digits, dashes and underscores"),
      ).toBeInTheDocument();
      expect(created).toEqual([]);
    });
  });

  describe("when the operator deactivates a code", () => {
    /** @scenario "The operator deactivates a promotion code" */
    it("asks first, then deactivates it", async () => {
      list.data = { coupons: [half] };
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Deactivate HALF50" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(deactivated).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate code" }));

      expect(deactivated).toEqual([{ promotionCodeId: "promo_half" }]);
    });
  });
});
