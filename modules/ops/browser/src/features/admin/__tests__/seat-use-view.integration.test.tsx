/**
 * @vitest-environment jsdom
 * Cloud admin's seat use page. Corresponds to
 * modules/ops/specs/seat-sharing-check.feature.
 */
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { CloudSeatUseScreen } from "../../../ui/sections/ops/admin-screens.tsx";

const state = vi.hoisted(() => ({
  listCalls: [] as { filter: Record<string, unknown> }[],
  checksAsked: 0,
  checks: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminList: (_resource: string, params: { filter: Record<string, unknown> }) => {
    state.listCalls.push(params);
    return {
      data: {
        total: 3,
        data: [org("org-acme", "ACME"), org("org-even", "Even"), org("org-free", "Free")],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    };
  },
  useAdminUpdate: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../behavior/use-seat-sharing-checks.ts", () => ({
  useSeatSharingChecks: () => {
    state.checksAsked += 1;
    return state.checks;
  },
}));

function org(id: string, name: string) {
  return {
    id,
    name,
    slug: id,
    phoneNumber: null,
    ssoDomain: null,
    ssoProvider: null,
    usageSpendingMaxLimit: null,
    datasetAttachmentMaxMb: null,
    signedDPA: false,
    promoCode: null,
    stripeCustomerId: null,
    currency: "EUR" as const,
    pricingModel: "SEAT_EVENT" as const,
    useCustomS3: false,
    createdAt: "2026-04-01T10:00:00.000Z",
  };
}

const lastCheck = {
  checkedAt: Date.UTC(2026, 10, 6, 3),
  windowDays: 30,
  readings: [
    { organizationId: "org-acme", planName: "Growth", seats: 5, activePeople: 12, flagged: true },
    { organizationId: "org-even", planName: "Growth", seats: 3, activePeople: 6, flagged: false },
  ],
};

function openList({ cloudOps = true }: { cloudOps?: boolean } = {}) {
  renderWithOpsHost(<CloudSeatUseScreen />, { host: fakeOpsHost({ isOpsAdmin: true, cloudOps }) });
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("Feature: Ops seat sharing check on the Cloud seat use page", () => {
  beforeEach(() => {
    state.listCalls = [];
    state.checksAsked = 0;
    state.checks = { data: [lastCheck], isLoading: false, isError: false };
  });

  describe("given the last check read ACME as 12 active people on 5 seats", () => {
    /** @scenario "Ops sees people on seats beside each organization" */
    it("shows people on seats, the warning chip on ACME only, and Not checked for the free one", () => {
      openList();

      expect(screen.getByText("Seat use, 30 days")).toBeInTheDocument();
      const acme = rowOf("ACME");
      expect(within(acme).getByText("12 people on 5 seats")).toBeInTheDocument();
      expect(within(acme).getByText("Seat sharing 2.4x")).toBeInTheDocument();
      expect(within(acme).getByText("Growth")).toBeInTheDocument();
      const even = rowOf("Even");
      expect(within(even).getByText("6 people on 3 seats")).toBeInTheDocument();
      expect(within(even).queryByText(/Seat sharing/)).toBeNull();
      expect(within(rowOf("Free")).getByText("Not checked")).toBeInTheDocument();
    });

    /** @scenario "The Over 2x seats filter narrows the list to flagged organizations" */
    it("asks the list for ACME's id only once the filter is on", async () => {
      openList();

      await userEvent.click(screen.getByText("Over 2x seats (1)"));

      expect(state.listCalls.at(-1)?.filter).toEqual({ id: ["org-acme"] });
    });
  });

  describe("given no check has run yet", () => {
    /** @scenario "Before the first check the list says it has not run yet" */
    it("says so and disables the filter", () => {
      state.checks = { data: [], isLoading: false, isError: false };
      openList();

      expect(screen.getByText(/The seat sharing check has not run yet/)).toBeInTheDocument();
      const over = screen.getByText("Over 2x seats (0)").closest("label");
      expect(over?.querySelector("input")).toBeDisabled();
    });
  });

  describe("given reading the check fails", () => {
    /** @scenario "A failed read of the check shows an error and the list still loads" */
    it("says it could not be loaded and still lists the organizations", () => {
      state.checks = { data: undefined, isLoading: false, isError: true };
      openList();

      expect(screen.getByText(/The seat sharing check could not be loaded/)).toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(within(rowOf("ACME")).getByText("Not checked")).toBeInTheDocument();
    });
  });

  describe("given ops's cloud-ops capability is off", () => {
    /** @scenario "A self-hosted Ops has no seat use page" */
    it("answers as an unknown page and never asks for the check", () => {
      openList({ cloudOps: false });

      expect(screen.getByText("Page not found")).toBeInTheDocument();
      expect(screen.queryByText("ACME")).toBeNull();
      expect(state.checksAsked).toBe(0);
    });
  });
});
