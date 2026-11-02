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
import { formatDate } from "../ui/elements/admin-cells.tsx";
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

const PEAK_REACHED = at("2026-11-12T15:00:00Z");

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
      carried: false,
    },
    {
      month: "2026-10",
      fullPeak: 51,
      fullPeakAt: at("2026-10-01T00:00:00Z"),
      litePeak: 3,
      litePeakAt: at("2026-10-01T00:00:00Z"),
      carried: true,
    },
    {
      month: "2026-09",
      fullPeak: 51,
      fullPeakAt: at("2026-09-20T10:00:00Z"),
      litePeak: 3,
      litePeakAt: at("2026-09-15T00:00:00Z"),
      carried: false,
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
        `Full seats: 48 of 50 in use, peak this month 57 (${formatDate(PEAK_REACHED)})`,
      );
      expect(summary).toHaveTextContent(/Lite Member seats: 3 of 10 in use, peak this month 4/);
      const earlier = within(screen.getByRole("table", { name: "Seat peaks of earlier months" }));
      expect(earlier.getByRole("row", { name: /2026-10/ })).toHaveTextContent(/51/);
      expect(earlier.getByRole("row", { name: /2026-09/ })).toHaveTextContent(/51/);
      expect(earlier.queryByRole("row", { name: /2026-11/ })).toBeNull();
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
