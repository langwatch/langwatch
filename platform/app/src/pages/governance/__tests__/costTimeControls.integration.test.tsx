/**
 * @vitest-environment jsdom
 *
 * The Costs page's time chips, and what the page does with them.
 *
 * Three things are under test here and they are all the same thing seen from
 * different sides: the page asks the reads for the window its Time Frame chip
 * names, it draws every chart on the bucket its Time Interval chip names, and
 * when the frame reaches further back than the reads will answer it says so
 * rather than serving a shorter span under a longer label.
 *
 * The fourth is a removal. Group By named the series of one chart while
 * sitting in a row that reads as filtering the page, so the lesson it taught
 * was that a chip here may or may not do anything. It is gone, and this suite
 * is what keeps it gone.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *       specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "~/components/governance/filters";

const harness = vi.hoisted(() => ({
  /** Every windowDays the page asked any read for, in call order. */
  windowsAsked: [] as number[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));
vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/utils/api", () => {
  // Every read records the window it was asked for, which is the only way to
  // see the frame reaching the server from outside the page.
  const recording = (data: unknown) => ({
    useQuery: (input: { windowDays?: number }) => {
      if (typeof input?.windowDays === "number") {
        harness.windowsAsked.push(input.windowDays);
      }
      return { data, isLoading: false, isError: false };
    },
  });
  return {
    api: {
      governanceCost: {
        spenders: recording(undefined),
        dailyByProvider: recording(undefined),
        spendByModel: recording(undefined),
        summary: recording({
          unavailableReason: null,
          billed: {
            amountUsd: 900,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 900, cellsWithoutAmount: 0 },
            ],
          },
          gateway: {
            amountUsd: 700,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 700, cellsWithoutAmount: 0 },
            ],
          },
          seats: { status: "awaiting_data" },
          series: [
            // Two days inside the same quarter. Drawn by day they are two
            // ticks; drawn by quarter they are one.
            {
              day: "2026-07-04",
              billedUsd: 500,
              gatewayUsd: 400,
              billedCellsWithoutAmount: 0,
              gatewayCellsWithoutAmount: 0,
              billedRevisedAt: null,
              billedByCurrency: [],
              billedProvisional: false,
            },
            {
              day: "2026-08-09",
              billedUsd: 400,
              gatewayUsd: 300,
              billedCellsWithoutAmount: 0,
              gatewayCellsWithoutAmount: 0,
              billedRevisedAt: null,
              billedByCurrency: [],
              billedProvisional: false,
            },
          ],
          staleSources: null,
          unpricedWindow: null,
          azureBilling: null,
          windowDays: 365,
        }),
      },
      activityMonitor: {
        summary: recording({
          activeUsersThisWindow: 42,
          newUsersThisWindow: 3,
          spentThisWindowUsd: "500.00",
        }),
        spendByDepartment: recording([
          {
            departmentId: "dep-1",
            departmentName: "Engineering",
            spendUsd: "310.50",
          },
        ]),
        spendByUser: recording([]),
        spendOverTime: recording({ buckets: [] }),
      },
    },
  };
});

import CostsPage from "../costs";

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );

/** Opens a filter chip by its label and picks one of its options. */
const pickFilter = async (chipLabel: string, option: string) => {
  const user = userEvent.setup();
  const chip = screen
    .getByText(chipLabel)
    .closest("button") as HTMLButtonElement;
  await user.click(chip);
  const item = await screen.findByRole("menuitem", { name: option });
  await user.click(item);
};

beforeEach(() => {
  harness.windowsAsked = [];
});
afterEach(() => cleanup());

describe("the cost screen's time controls", () => {
  describe("given a permitted viewer opens the page", () => {
    /** @scenario "The screen opens on the last twelve months bucketed by quarter" */
    it("opens on the last twelve months bucketed by quarter, with no Group By", () => {
      renderScreen();

      expect(screen.getByText("Last 12 months")).toBeInTheDocument();
      expect(screen.getByText("Quarter")).toBeInTheDocument();
      // Group By named one chart's series while every panel beside it ignored
      // it. Its absence is the assertion.
      expect(screen.queryByText("Group By")).not.toBeInTheDocument();
    });

    /** @scenario "Time Frame and Time Interval are chips in the same row as the other filters" */
    it("renders both time controls as chips beside the other filters", async () => {
      const { container } = renderScreen();

      const frame = screen.getByText("Time Frame").closest("button");
      const interval = screen.getByText("Time Interval").closest("button");
      const department = screen.getByText("Department").closest("button");

      expect(frame).not.toBeNull();
      expect(interval).not.toBeNull();
      // One row: all three share a parent, and none of them is a native
      // select the operating system would draw in our palette.
      expect(frame?.parentElement).toBe(department?.parentElement);
      expect(interval?.parentElement).toBe(department?.parentElement);
      expect(findNativeSelects(container)).toHaveLength(0);
    });

    // The axis ticks themselves are unreachable here — recharts measures a
    // zero-width container under jsdom and draws no SVG at all, so the tick
    // text never exists to assert on. The tick format is covered by the unit
    // test on `formatBucketTick`.
    //
    // What this suite can see is the sentence the page writes from the same
    // interval the charts are folded with. It used to read the lane chart's
    // heading instead, which spoke for one chart while the scenario is about
    // every chart on the screen; that chart is gone and the sentence covers
    // all of them.

    /** @scenario "Every chart on the screen is ticked by the interval in view" */
    it("says the charts are bucketed by the interval in view, not by days", () => {
      renderScreen();

      expect(screen.getByTestId("cost-bucket-note")).toHaveTextContent(
        /bucketed by quarter/i,
      );
      expect(screen.getByTestId("cost-bucket-note")).not.toHaveTextContent(
        /bucketed by day/i,
      );
    });

    it("restates the bucket when the interval narrows", async () => {
      renderScreen();

      await pickFilter("Time Interval", "Month");

      expect(screen.getByTestId("cost-bucket-note")).toHaveTextContent(
        /bucketed by month/i,
      );
    });
  });

  describe("given the reader narrows the frame under the interval", () => {
    it("steps the interval down to the widest that still fits", async () => {
      renderScreen();

      await pickFilter("Time Frame", "Last 3 months");

      // A quarter over three months draws one bar, which is a number wearing
      // a chart's clothes.
      expect(screen.getByText("Month")).toBeInTheDocument();
      expect(screen.queryByText("Quarter")).not.toBeInTheDocument();
    });
  });

  describe("given the reader picks a frame the reads cannot answer", () => {
    /** @scenario "A frame longer than the reads answer says how far the figures reach" */
    it("asks for the ceiling and says how far the figures actually reach", async () => {
      renderScreen();
      harness.windowsAsked = [];

      await pickFilter("Time Frame", "Last 2 years");

      // 730 would fail the reads' own validation and land the reader on an
      // error alert, so the page asks for what it can get and says so.
      expect(harness.windowsAsked).not.toContain(730);
      expect(harness.windowsAsked).toContain(365);
      expect(screen.getByTestId("cost-read-ceiling-note")).toHaveTextContent(
        /cover the last 12 months/i,
      );
    });
  });

  describe("given the reader picks a frame the reads can answer in full", () => {
    it("asks for that frame's own span and claims no shortfall", async () => {
      renderScreen();
      harness.windowsAsked = [];

      await pickFilter("Time Frame", "Last 3 months");

      expect(harness.windowsAsked).toContain(90);
      expect(
        screen.queryByTestId("cost-read-ceiling-note"),
      ).not.toBeInTheDocument();
    });
  });
});
