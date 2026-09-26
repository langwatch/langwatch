/**
 * @vitest-environment jsdom
 *
 * Tests sample panels visibility; fill empty screens, vanish when real data arrives.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernanceHostProvider } from "../../../../model/governance-host.ts";
import { fakeGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  // The headline summary is part of the decision under test: a pulled bill
  // with no activity behind it must keep the invented panels off.
  costSummary: undefined as unknown,
  activity: {
    summary: undefined as unknown,
    spendByDepartment: undefined as unknown,
    spendByUser: undefined as unknown,
    spendOverTime: undefined as unknown,
  },
}));

vi.mock("../../../../behavior/governance-api.ts", () => ({
  api: {
    governanceCost: {
      // The spender panel and the day split are their own reads with their
      // own tests; here they answer nothing so these tests stay about their
      // own subject.
      spenders: { useQuery: () => ({ data: undefined }) },
      dailyByProvider: { useQuery: () => ({ data: undefined }) },
      spendByModel: { useQuery: () => ({ data: undefined }) },
      summary: {
        useQuery: () => ({
          data: harness.costSummary,
          isLoading: false,
          isError: false,
        }),
      },
    },
    activityMonitor: {
      summary: { useQuery: () => ({ data: harness.activity.summary }) },
      spendByDepartment: {
        useQuery: () => ({ data: harness.activity.spendByDepartment }),
      },
      spendByUser: {
        useQuery: () => ({ data: harness.activity.spendByUser }),
      },
      spendOverTime: {
        useQuery: () => ({ data: harness.activity.spendOverTime }),
      },
    },
  },
}));

import CostsPage from "../governance-costs.screen.tsx";

/** The org admin's real grants, over the plan the test names. */
const costsHost = () =>
  fakeGovernanceHost({
    permissions: [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")],
    plan: { isEnterprise: true, isLoading: false },
  });

/** Invented figure constant to test sample mode visibility. */
const A_SAMPLE_FIGURE = "support-copilot";

const screenTree = () => (
  <ChakraProvider value={defaultSystem}>
    <GovernanceHostProvider value={costsHost()}>
      <CostsPage />
    </GovernanceHostProvider>
  </ChakraProvider>
);

const renderScreen = () => render(screenTree());

/**
 * Every activity read goes back to unanswered, which is what react-query hands
 * the page the instant a filter chip re-keys the queries. A fresh element each
 * time, so React cannot bail out of reconciliation on reference equality.
 */
const withReadsBackInFlight = (rerender: (ui: React.ReactElement) => void) => {
  harness.activity = {
    summary: undefined,
    spendByDepartment: undefined,
    spendByUser: undefined,
    spendOverTime: undefined,
  };
  rerender(screenTree());
};

/** A headline summary whose lanes hold the given money, or nothing. */
const costSummary = ({ billedUsd }: { billedUsd: number | null }) => ({
  unavailableReason: null,
  // In the DTO's own shape: the US dollar line IS the lane's dollar figure,
  // and a lane that reported nothing has no line at all.
  billed: {
    amountUsd: billedUsd,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals:
      billedUsd === null ? [] : [{ currencyCode: "USD", amount: billedUsd, cellsWithoutAmount: 0 }],
  },
  gateway: {
    amountUsd: null,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals: [],
  },
  seats: { status: "awaiting_data" },
  series: billedUsd === null ? [] : [{ day: "2026-08-01", billedUsd, gatewayUsd: null }],
  windowDays: 30,
});

/** Every real read answers, and one of them holds a row. */
const withRealFigures = () => {
  harness.costSummary = costSummary({ billedUsd: 123.45 });
  harness.activity.summary = {
    activeUsersThisWindow: 42,
    newUsersThisWindow: 3,
    spentThisWindowUsd: "500.00",
  };
  harness.activity.spendByDepartment = [
    {
      departmentId: "dep-1",
      departmentName: "Engineering",
      spendUsd: "310.50",
    },
  ];
  harness.activity.spendByUser = [];
  harness.activity.spendOverTime = { buckets: [] };
};

/** Every real read answers, and all of them are empty. */
const withNothingMeasured = () => {
  harness.costSummary = costSummary({ billedUsd: null });
  harness.activity.summary = {
    activeUsersThisWindow: 0,
    newUsersThisWindow: 0,
    spentThisWindowUsd: "0",
  };
  harness.activity.spendByDepartment = [];
  harness.activity.spendByUser = [];
  harness.activity.spendOverTime = { buckets: [] };
};

beforeEach(() => {
  // The section keeps ONE sample choice for the whole sitting, in session
  // storage, so the first test to press the toggle would otherwise hand its
  // answer to every test after it.
  window.sessionStorage.clear();
  harness.costSummary = undefined;
  harness.activity = {
    summary: undefined,
    spendByDepartment: undefined,
    spendByUser: undefined,
    spendOverTime: undefined,
  };
});

afterEach(() => cleanup());

describe("the sample panels on the cost screen", () => {
  describe("given the organization has real cost figures", () => {
    beforeEach(withRealFigures);

    it("keeps the invented panels off the screen", () => {
      renderScreen();

      expect(screen.queryAllByText(A_SAMPLE_FIGURE)).toHaveLength(0);
    });

    it("still shows the real breakdowns", () => {
      renderScreen();

      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    it("offers to show the sample panels rather than hiding the option", () => {
      renderScreen();

      expect(screen.getByRole("button", { name: "See sample data" })).toBeInTheDocument();
    });

    it("does not let a filter change put the invented panels back", () => {
      const { rerender } = renderScreen();

      withReadsBackInFlight(rerender);

      expect(screen.queryAllByText(A_SAMPLE_FIGURE)).toHaveLength(0);
    });
  });

  describe("given a pulled bill and no measured activity", () => {
    beforeEach(() => {
      withNothingMeasured();
      harness.costSummary = costSummary({ billedUsd: 123.45 });
    });

    it("keeps the invented panels off — a real bill is real data", () => {
      renderScreen();

      expect(screen.queryAllByText(A_SAMPLE_FIGURE)).toHaveLength(0);
    });
  });

  describe("given the reader enabled samples on an empty page", () => {
    beforeEach(() => {
      withNothingMeasured();
      window.sessionStorage.setItem("governance.sample", "true");
    });

    it("fills the empty screen with the sample panels", () => {
      renderScreen();

      expect(screen.getAllByText(A_SAMPLE_FIGURE).length).toBeGreaterThan(0);
    });

    it("says on the screen that the figures are not real", () => {
      renderScreen();

      expect(screen.getByRole("status")).toHaveTextContent(/nothing here is real/i);
    });

    it("does not pull the invented panels away on a filter change", () => {
      const { rerender } = renderScreen();

      withReadsBackInFlight(rerender);

      expect(screen.getAllByText(A_SAMPLE_FIGURE).length).toBeGreaterThan(0);
    });
  });

  describe("given a read has not answered yet", () => {
    it("shows no sample panels rather than flashing them up and pulling them away", () => {
      renderScreen();

      expect(screen.queryAllByText(A_SAMPLE_FIGURE)).toHaveLength(0);
    });
  });

  describe("given the reader turns the sample panels on", () => {
    beforeEach(withRealFigures);

    it("shows them alongside the real ones", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));

      expect(screen.getAllByText(A_SAMPLE_FIGURE).length).toBeGreaterThan(0);
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    it("lets them turn the panels back off", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      fireEvent.click(screen.getByRole("button", { name: "Hide sample data" }));

      expect(screen.queryAllByText(A_SAMPLE_FIGURE)).toHaveLength(0);
    });
  });

  describe("given the reader turns the sample panels off on an empty screen", () => {
    beforeEach(() => {
      withNothingMeasured();
      window.sessionStorage.setItem("governance.sample", "true");
    });

    it("does not put them back", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "Hide sample data" }));

      expect(screen.queryAllByText(A_SAMPLE_FIGURE)).toHaveLength(0);
    });
  });
});
