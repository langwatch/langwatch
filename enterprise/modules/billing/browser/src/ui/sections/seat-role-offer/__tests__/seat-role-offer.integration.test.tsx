/**
 * @vitest-environment jsdom
 * Billing's seat offer under the member drawer's role field, against a mocked `billingApi`.
 * @see specs/licensing/role-change-seat.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { SeatRoleOfferProps } from "@langwatch/enterprise-billing-client";
import type { SeatOffer } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeatRoleOffer } from "../seat-role-offer.tsx";

const { offerRead, invalidateSubscription } = vi.hoisted(() => ({
  offerRead: {
    current: { data: undefined, isLoading: true, isError: false, error: null } as {
      data: SeatOffer | undefined;
      isLoading: boolean;
      isError: boolean;
      error: unknown;
    },
  },
  invalidateSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../behavior/billing-api.ts", () => ({
  billingApi: {
    useUtils: () => ({ subscription: { invalidate: invalidateSubscription } }),
    subscription: { seatOffer: { useQuery: () => offerRead.current } },
  },
}));

// 14 Dec 2026, midday UTC.
const RENEWS_AT = Date.UTC(2026, 11, 14, 12);

const CHARGE: SeatOffer = {
  kind: "charge",
  newTotalSeats: 3,
  formattedSeatPrice: "$34.00",
  formattedAmountDue: "$5.19",
  formattedRecurringTotal: "$102.00",
  billingInterval: "month",
  renewsAt: RENEWS_AT,
  quotedAt: 1_700_000_000_000,
};

function offering(offer: SeatOffer) {
  offerRead.current = { data: offer, isLoading: false, isError: false, error: null };
}

function renderOffer(overrides: Partial<SeatRoleOfferProps> = {}) {
  const props: SeatRoleOfferProps = {
    organizationId: "org-1",
    organizationName: "ACME",
    memberName: "Sam",
    roleLabel: "Admin",
    currentRoleLabel: "Lite Member",
    state: "offer",
    onConfirm: vi.fn(),
    onKind: vi.fn(),
    onAmountDue: vi.fn(),
    ...overrides,
  };
  const view = render(
    <DesignSystemProvider forcedTheme="light">
      <SeatRoleOffer {...props} />
    </DesignSystemProvider>,
  );
  return { props, view };
}

describe("<SeatRoleOffer/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offering(CHARGE);
  });
  afterEach(cleanup);

  describe("when one more seat is charged to the subscription", () => {
    /** @scenario "The offer prices today and the recurring total on its one button" */
    it("prices today and the recurring total, with the one button", () => {
      const { props } = renderOffer();

      expect(screen.getByText("No free full seat.")).toBeInTheDocument();
      expect(screen.getByText("Add 1 for $34.00/mo.")).toBeInTheDocument();
      expect(screen.getByText("Today, prorated to 14 Dec")).toBeInTheDocument();
      expect(screen.getByText("$5.19")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Then \$102\.00\/mo for 3 seats from 14 Dec\. Or move someone else to Lite instead\./,
        ),
      ).toBeInTheDocument();
      expect(props.onKind).toHaveBeenCalledWith("charge");
      expect(props.onAmountDue).toHaveBeenCalledWith("$5.19");

      fireEvent.click(
        screen.getByRole("button", {
          name: "Add 1 seat and make Sam Admin · $5.19 today, then $102.00/mo",
        }),
      );
      expect(props.onConfirm).toHaveBeenCalledWith(CHARGE.quotedAt);
    });

    it("says /yr for a yearly subscription", () => {
      offering({ ...CHARGE, billingInterval: "year", formattedRecurringTotal: "$1,224.00" });
      renderOffer();
      expect(
        screen.getByRole("button", {
          name: "Add 1 seat and make Sam Admin · $5.19 today, then $1,224.00/yr",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("when the seat is bought through checkout", () => {
    it("offers the seat without a price and confirms with no quote", () => {
      offering({ kind: "checkout", newTotalSeats: 3 });
      const { props } = renderOffer();
      fireEvent.click(screen.getByRole("button", { name: "Add 1 seat and make Sam Admin" }));
      expect(props.onConfirm).toHaveBeenCalledWith(undefined);
    });
  });

  describe("when the seat was bought", () => {
    /** @scenario "The done state says what was paid" */
    it("says what was paid and names no card", () => {
      const { props, view } = renderOffer();
      fireEvent.click(screen.getByRole("button", { name: /Add 1 seat and make Sam Admin/ }));
      view.rerender(
        <DesignSystemProvider forcedTheme="light">
          <SeatRoleOffer {...props} state="done" />
        </DesignSystemProvider>,
      );

      expect(screen.getByText("Sam is now an Admin")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Paid $5.19. ACME has 3 full seats, all in use. A receipt is on its way by email.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/card|visa/i)).toBeNull();
      expect(invalidateSubscription).toHaveBeenCalled();
    });

    it("keeps the done notice when the refetched offer comes back blocked", () => {
      const { props, view } = renderOffer();
      fireEvent.click(screen.getByRole("button", { name: /Add 1 seat and make Sam Admin/ }));
      offering({ kind: "blocked" });
      view.rerender(
        <DesignSystemProvider forcedTheme="light">
          <SeatRoleOffer {...props} state="done" />
        </DesignSystemProvider>,
      );
      expect(screen.getByText("Sam is now an Admin")).toBeInTheDocument();
      expect(screen.queryByText("We couldn't add the seat yet")).toBeNull();
    });

    it("reports the amount the admin confirmed, not a later reprice", () => {
      const { props, view } = renderOffer();
      fireEvent.click(screen.getByRole("button", { name: /Add 1 seat and make Sam Admin/ }));
      offering({ ...CHARGE, formattedAmountDue: "$9.20" });
      view.rerender(
        <DesignSystemProvider forcedTheme="light">
          <SeatRoleOffer {...props} state="busy" />
        </DesignSystemProvider>,
      );
      expect(props.onAmountDue).toHaveBeenLastCalledWith("$5.19");
      expect(props.onAmountDue).not.toHaveBeenCalledWith("$9.20");
    });
  });

  describe("when billing is held on our side", () => {
    /** @scenario "Stuck billing shows the calm state with Contact support" */
    it("shows the calm state and a Contact support link", () => {
      renderOffer({ state: "stuck" });

      expect(screen.getByText("We couldn't add the seat yet")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Something on our side is holding ACME's billing\. We were alerted automatically and are fixing it\./,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Nothing was charged.")).toBeInTheDocument();
      expect(screen.getByText("Sam is still a Lite Member.")).toBeInTheDocument();
      expect(
        screen.getByText("We'll email you when it's done, usually the same working day."),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Contact support" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add 1 seat/ })).toBeNull();
    });

    it("shows the calm state when the offer itself is blocked", () => {
      offering({ kind: "blocked" });
      const { props } = renderOffer();
      expect(screen.getByText("We couldn't add the seat yet")).toBeInTheDocument();
      expect(props.onKind).toHaveBeenCalledWith("blocked");
    });
  });

  describe("when the plan has custom terms", () => {
    /** @scenario "A plan on custom terms points to support for the seat" */
    it("says our team adds the seat, nothing was charged, with Contact support", () => {
      offering({ kind: "support" });
      const { props } = renderOffer();

      expect(screen.getByText("Seats on ACME's plan are changed by our team")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your plan has custom terms, so we add seats for you. Nothing was charged and Sam is still a Lite Member.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toMatch(
        /^mailto:support@langwatch\.ai/,
      );
      expect(screen.queryByRole("button", { name: /Add 1 seat/ })).toBeNull();
      expect(props.onKind).toHaveBeenCalledWith("support");
    });
  });

  describe("when the plan has no paid seats", () => {
    it("renders nothing and reports none", () => {
      offering({ kind: "none" });
      const { props, view } = renderOffer();
      expect(view.container.querySelector("button")).toBeNull();
      expect(screen.queryByText("No free full seat.")).toBeNull();
      expect(props.onKind).toHaveBeenCalledWith("none");
    });
  });
});
