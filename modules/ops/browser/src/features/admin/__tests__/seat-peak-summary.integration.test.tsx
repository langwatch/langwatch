/**
 * @vitest-environment jsdom
 * Our team sees an organization's monthly seat peak beside its licence's seats when it opens the
 * organization. Corresponds to modules/organization/specs/seat-peak.feature.
 */
import type { OrganizationSeatPeak } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { OrganizationEditDrawer } from "../ui/sections/organizations-view.tsx";

const peakState = vi.hoisted(() => ({
  answer: undefined as unknown,
  askedFor: [] as unknown[],
}));

vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminUpdate: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    organizationSeatPeak: {
      get: {
        useQuery: (input: unknown) => {
          peakState.askedFor.push(input);
          return { data: peakState.answer, isLoading: false };
        },
      },
    },
    ssoConnections: { getAll: { useQuery: () => ({ data: { connections: [], total: 0 } }) } },
  },
}));

const organization = {
  id: "org-acme",
  name: "Acme",
  slug: "acme",
  phoneNumber: null,
  ssoDomain: null,
  ssoProvider: null,
  usageSpendingMaxLimit: null,
  datasetAttachmentMaxMb: null,
  signedDPA: false,
  promoCode: null,
  stripeCustomerId: null,
  currency: "USD" as const,
  pricingModel: "SEAT_EVENT" as const,
  useCustomS3: false,
  createdAt: "2026-04-01T10:00:00.000Z",
};

function at(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

// Late in the UTC day, so a date read in a local time zone would show the 13th.
const PEAK_REACHED = at("2026-11-12T23:30:00Z");

const counted: OrganizationSeatPeak = {
  counted: true,
  countingSince: at("2026-09-15T00:00:00Z"),
  seats: { full: 48, lite: 3, developer: 2 },
  caps: { fullSeats: 50, liteSeats: 10 },
  mismatches: 0,
  months: [
    {
      month: "2026-11",
      fullPeak: 57,
      fullPeakAt: PEAK_REACHED,
      litePeak: 4,
      litePeakAt: at("2026-11-03T09:00:00Z"),
    },
    {
      month: "2026-10",
      fullPeak: 51,
      fullPeakAt: at("2026-10-01T00:00:00Z"),
      litePeak: 3,
      litePeakAt: at("2026-10-01T00:00:00Z"),
    },
    {
      month: "2026-09",
      fullPeak: 51,
      fullPeakAt: at("2026-09-20T10:00:00Z"),
      litePeak: 3,
      litePeakAt: at("2026-09-15T00:00:00Z"),
    },
  ],
};

function openOrganization() {
  renderWithOpsHost(<OrganizationEditDrawer organization={organization} onClose={vi.fn()} />, {
    host: fakeOpsHost({ isOpsAdmin: true, cloudOps: true }),
  });
}

describe("Feature: our team sees the seat peak at renewal", () => {
  beforeEach(() => {
    peakState.answer = undefined;
    peakState.askedFor = [];
  });

  describe("given the organization held 57 full seats at once this month on a licence of 50", () => {
    /** @scenario "The ops console shows this month's peak beside the licence's seats" */
    it("shows the peak beside the licence, when it was reached, and every earlier month", () => {
      peakState.answer = counted;
      openOrganization();

      const summary = screen.getByTestId("ops-seat-peak");
      expect(peakState.askedFor).toContainEqual({ organizationId: "org-acme" });
      expect(summary).toHaveTextContent(
        "Full seats: 48 of 50 in use, peak this month 57 (2026-11-12)",
      );
      expect(summary).toHaveTextContent(/Lite Member seats: 3 of 10 in use, peak this month 4/);
      const earlier = within(screen.getByRole("table", { name: "Seat peaks of earlier months" }));
      expect(earlier.getByRole("row", { name: /2026-10/ })).toHaveTextContent(/51/);
      expect(earlier.getByRole("row", { name: /2026-09/ })).toHaveTextContent(/51/);
      expect(earlier.queryByRole("row", { name: /2026-11/ })).toBeNull();
    });
  });

  describe("given the organization is on an unlimited plan", () => {
    /** @scenario "The ops console reads an unlimited licence's seats as unlimited" */
    it("reads an unlimited cap as unlimited and a large finite one as its number", () => {
      peakState.answer = { ...counted, caps: { fullSeats: null, liteSeats: 1_000_000 } };
      openOrganization();

      const summary = screen.getByTestId("ops-seat-peak");
      expect(summary).toHaveTextContent("Full seats: 48 of unlimited in use");
      expect(summary).toHaveTextContent("Lite Member seats: 3 of 1,000,000 in use");
    });
  });

  describe("given some seat changes disagreed with the count", () => {
    /** @scenario "The ops console says how many seat changes disagreed with the count" */
    it("shows the mismatch count only when it is above zero", () => {
      peakState.answer = { ...counted, mismatches: 3 };
      const { unmount } = renderWithOpsHost(
        <OrganizationEditDrawer organization={organization} onClose={vi.fn()} />,
        { host: fakeOpsHost({ isOpsAdmin: true, cloudOps: true }) },
      );
      expect(screen.getByTestId("ops-seat-peak-mismatches")).toHaveTextContent(
        "3 seat changes disagreed with the count",
      );
      unmount();

      peakState.answer = counted;
      openOrganization();
      expect(screen.queryByTestId("ops-seat-peak-mismatches")).toBeNull();
    });
  });

  describe("given the organization's seats have not been counted yet", () => {
    /** @scenario "The ops console says when counting has not started for an organization" */
    it("says counting has not started, never a peak of zero", () => {
      peakState.answer = { counted: false, caps: { fullSeats: 50, liteSeats: 10 } };
      openOrganization();

      expect(screen.getByTestId("ops-seat-peak-not-counted")).toHaveTextContent(
        "Seat counting has not started for this organization",
      );
      expect(screen.queryByTestId("ops-seat-peak")).toBeNull();
      expect(screen.queryByText(/peak this month 0/)).toBeNull();
    });
  });
});
