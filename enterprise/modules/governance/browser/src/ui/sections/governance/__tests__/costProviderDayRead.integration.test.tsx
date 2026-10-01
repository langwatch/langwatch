/**
 * @vitest-environment jsdom
 *
 * Tests cost-by-provider panel failure states and stale data handling.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernanceHostProvider } from "../../../../model/governance-host.ts";
import { fakeGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  /**
   * The per-(day, provider) read. Its answer and its failure are set
   * INDEPENDENTLY on purpose: a failed refetch still holds the rows the last
   * successful read returned, and that combination is the interesting one.
   */
  providerDays: {
    data: undefined as unknown,
    isError: false,
  },
}));

vi.mock("../../../../behavior/governance-api.ts", () => ({
  api: {
    governanceCost: {
      // Its own panel with its own tests; nothing here.
      spendByModel: { useQuery: () => ({ data: undefined }) },
      spenders: {
        useQuery: () => ({
          data: undefined,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      dailyByProvider: {
        useQuery: () => ({
          data: harness.providerDays.data,
          isLoading: false,
          isError: harness.providerDays.isError,
        }),
      },
      periodRecords: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isError: false,
        }),
      },
      // Answers throughout, so every assertion below is about the provider-day
      // panel alone and not about a screen that failed as a whole.
      summary: {
        useQuery: () => ({
          data: {
            unavailableReason: null,
            providers: [
              {
                provider: "openai_admin",
                amountUsd: 90,
                cellsWithoutAmount: 0,
                currenciesWithoutUsdAmount: [],
              },
            ],
            billed: {
              amountUsd: 90,
              cellsWithoutAmount: 0,
              currenciesWithoutUsdAmount: [],
              currencyTotals: [{ currencyCode: "USD", amount: 90, cellsWithoutAmount: 0 }],
            },
            gateway: {
              amountUsd: 67.89,
              cellsWithoutAmount: 0,
              currenciesWithoutUsdAmount: [],
              currencyTotals: [{ currencyCode: "USD", amount: 67.89, cellsWithoutAmount: 0 }],
            },
            seats: { status: "awaiting_data" },
            series: [{ day: "2026-01-15", billedUsd: 90, gatewayUsd: 67.89 }],
            windowDays: 30,
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
    activityMonitor: {
      summary: { useQuery: () => ({ data: undefined }) },
      spendByDepartment: { useQuery: () => ({ data: undefined }) },
      spendByUser: { useQuery: () => ({ data: undefined }) },
      spendOverTime: { useQuery: () => ({ data: undefined }) },
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

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <GovernanceHostProvider value={costsHost()}>
        <CostsPage />
      </GovernanceHostProvider>
    </ChakraProvider>,
  );

/** The rows a successful read answers with, for the days in the window. */
const PROVIDER_DAY_ROWS = [
  {
    day: "2026-01-15",
    provider: "openai_admin",
    amountUsd: 60,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
  {
    day: "2026-01-16",
    provider: "openai_admin",
    amountUsd: 30,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
];

/**
 * The card the panel lives in, found by its heading — scoped, not searched
 * page-wide, because the unrefreshed marker is what EVERY panel here shows
 * for a failed read, so an unscoped search passes on a neighbour's failure.
 */
const providerDayPanel = () => {
  const card = screen
    .getByText("Cost over time · by provider")
    .closest<HTMLElement>('[data-testid="cost-panel"]');
  if (card === null) {
    throw new Error("the provider heading stands outside any cost panel");
  }
  return within(card);
};

beforeEach(() => {
  harness.providerDays = { data: undefined, isError: false };
});

afterEach(() => cleanup());

describe("the cost by provider panel", () => {
  describe("given its read failed", () => {
    beforeEach(() => {
      harness.providerDays = { data: undefined, isError: true };
    });

    /** @scenario "A panel that fails to refresh says so instead of emptying" */
    it("says it could not be brought up to date rather than disappearing", () => {
      renderScreen();

      const panel = providerDayPanel();

      expect(panel.getByText(/could not be brought up to date/i)).toBeInTheDocument();
      // The whole point of the marker: the panel keeps its place on the
      // screen. Gone, it would read as a window nobody spent anything in.
      expect(panel.queryByLabelText("Cost over time · by provider")).not.toBeInTheDocument();
      // Its neighbours answered, so this cannot pass against a screen that
      // failed as a whole.
      expect(screen.getByTestId("cost-lane-billed")).toBeInTheDocument();
    });
  });

  describe("given its read answered with rows", () => {
    beforeEach(() => {
      harness.providerDays = {
        data: { rows: PROVIDER_DAY_ROWS },
        isError: false,
      };
    });

    it("draws the panel and says nothing about a failed refresh", () => {
      renderScreen();

      expect(screen.getByLabelText("Cost over time · by provider")).toBeInTheDocument();
      expect(
        providerDayPanel().queryByText(/could not be brought up to date/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given every day of the window carries a figure", () => {
    beforeEach(() => {
      harness.providerDays = {
        data: { rows: PROVIDER_DAY_ROWS },
        isError: false,
      };
    });

    it("says nothing about spend it holds no dollar figure for", () => {
      renderScreen();

      // The caveat is for a window that has one. Printing it over a window
      // where every day was priced teaches a reader to read past it, which
      // costs them the one window where it mattered.
      const region = within(screen.getByLabelText("Cost over time · by provider"));
      expect(region.queryByLabelText(/cover only part of what was spent/i)).not.toBeInTheDocument();
    });
  });

  describe("given its read failed while still holding the rows it last returned", () => {
    beforeEach(() => {
      harness.providerDays = {
        data: { rows: PROVIDER_DAY_ROWS },
        isError: true,
      };
    });

    /** @scenario "A panel that fails to refresh says so instead of emptying" */
    it("shows the marker and not the figures it could not confirm", () => {
      renderScreen();

      const panel = providerDayPanel();

      expect(panel.getByText(/could not be brought up to date/i)).toBeInTheDocument();
      // Drawing the chart alongside the marker would state two contradictory
      // things at once, and drawing it without the marker would present
      // figures from before the failure as current.
      expect(screen.queryByLabelText("Cost over time · by provider")).not.toBeInTheDocument();
      // One panel under this heading, not the marker and the chart as two.
      expect(screen.getAllByText("Cost over time · by provider")).toHaveLength(1);
    });
  });
});
