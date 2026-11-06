/**
 * @vitest-environment jsdom
 * @see specs/licensing/seat-rotation.feature
 */
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import SubscriptionsView from "../ui/sections/subscriptions-view.tsx";

const { rows } = vi.hoisted(() => {
  const base = {
    organizationId: "org-1",
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    status: "ACTIVE",
    startDate: "2026-10-01T00:00:00.000Z",
    endDate: null,
    lastPaymentFailedDate: null,
    maxMembers: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
    organization: { id: "org-1", name: "ACME", slug: "acme" },
  };
  return {
    rows: [
      {
        ...base,
        id: "sub-flagged",
        stripeSubscriptionId: "sub_stripe_flagged",
        seatRepairQuantity: 3,
        seatRepairFlaggedAt: "2026-11-06T12:00:00.000Z",
      },
      {
        ...base,
        id: "sub-reconcile",
        stripeSubscriptionId: "sub_stripe_reconcile",
        seatRepairQuantity: null,
        seatRepairFlaggedAt: null,
        seatLineQuantity: 6,
        seatLineWriteFlaggedAt: "2026-11-06T12:00:00.000Z",
      },
      {
        ...base,
        id: "sub-retrying",
        stripeSubscriptionId: "sub_stripe_retrying",
        seatRepairQuantity: 4,
        seatRepairFlaggedAt: null,
      },
    ],
  };
});

vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminList: () => ({
    data: { total: rows.length, data: rows },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAdminUpdate: () => ({ mutate: vi.fn(), isPending: false }),
  useAdminCreate: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("Feature: Ops subscriptions list", () => {
  describe("given a subscription billing flagged after its seat line repair retries ran out", () => {
    /** @scenario "Ops sees which subscriptions need a seat line repair" */
    it("reads the seat line repair with the intended quantity on that row only", () => {
      renderWithOpsHost(<SubscriptionsView />, { host: fakeOpsHost({ isOpsAdmin: true }) });

      expect(screen.getByText("Seat line needs repair: 3 seats")).toBeInTheDocument();
      expect(screen.getByText("Seat line needs repair: 6 seats")).toBeInTheDocument();
      expect(screen.queryByText(/Seat line needs repair: 4/)).not.toBeInTheDocument();
    });
  });
});
