/**
 * @vitest-environment jsdom
 *
 * The sample panels' visibility, mounted through the real page.
 *
 * Seven of the panels on this screen are invented — nothing in the platform
 * measures agents, seats, forecasts, tokens or questions yet. They exist to
 * show the shape of the screen to an organization that has nothing on it. The
 * moment that organization has real cost figures, invented ones sitting beside
 * them stop being an illustration and start being a hazard: two panels, same
 * typography, same money format, and only a small badge separating what was
 * measured from what was made up.
 *
 * So the rule under test is the one the trace explorer already applies to
 * sample traces — samples fill an empty screen and get out of the way once
 * there is something real to look at, and an explicit choice by the reader
 * beats both.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  activity: {
    summary: undefined as unknown,
    spendByDepartment: undefined as unknown,
    spendByUser: undefined as unknown,
    spendOverTime: undefined as unknown,
  },
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

vi.mock("~/utils/api", () => ({
  api: {
    governanceCost: {
      summary: {
        useQuery: () => ({
          data: {
            unavailableReason: null,
            billed: { amountUsd: 123.45, cellsWithoutAmount: 0 },
            gateway: { amountUsd: 67.89, cellsWithoutAmount: 0 },
            seats: { status: "awaiting_data" },
            series: [
              { day: "2026-08-01", billedUsd: 123.45, gatewayUsd: 67.89 },
            ],
            windowDays: 30,
          },
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

import CostsPage from "../costs";

/** One of the seven invented panels. If this is on screen, samples are on. */
const A_SAMPLE_PANEL = "Tokens over time";

const screenTree = () => (
  <ChakraProvider value={defaultSystem}>
    <CostsPage />
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

/** Every real read answers, and one of them holds a row. */
const withRealFigures = () => {
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

      expect(screen.queryByText(A_SAMPLE_PANEL)).not.toBeInTheDocument();
    });

    it("still shows the real breakdowns", () => {
      renderScreen();

      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    it("offers to show the sample panels rather than hiding the option", () => {
      renderScreen();

      expect(
        screen.getByRole("button", { name: "See sample data" }),
      ).toBeInTheDocument();
    });

    it("does not let a filter change put the invented panels back", () => {
      const { rerender } = renderScreen();

      withReadsBackInFlight(rerender);

      expect(screen.queryByText(A_SAMPLE_PANEL)).not.toBeInTheDocument();
    });
  });

  describe("given the reads answered and measured nothing", () => {
    beforeEach(withNothingMeasured);

    it("fills the empty screen with the sample panels", () => {
      renderScreen();

      expect(screen.getByText(A_SAMPLE_PANEL)).toBeInTheDocument();
    });

    it("says on the screen that the figures are not real", () => {
      renderScreen();

      expect(screen.getByRole("status")).toHaveTextContent(
        /nothing here is real/i,
      );
    });

    it("does not pull the invented panels away on a filter change", () => {
      const { rerender } = renderScreen();

      withReadsBackInFlight(rerender);

      expect(screen.getByText(A_SAMPLE_PANEL)).toBeInTheDocument();
    });
  });

  describe("given a read has not answered yet", () => {
    it("shows no sample panels rather than flashing them up and pulling them away", () => {
      renderScreen();

      expect(screen.queryByText(A_SAMPLE_PANEL)).not.toBeInTheDocument();
    });
  });

  describe("given the reader turns the sample panels on", () => {
    beforeEach(withRealFigures);

    it("shows them alongside the real ones", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));

      expect(screen.getByText(A_SAMPLE_PANEL)).toBeInTheDocument();
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    it("lets them turn the panels back off", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      fireEvent.click(screen.getByRole("button", { name: "Hide sample data" }));

      expect(screen.queryByText(A_SAMPLE_PANEL)).not.toBeInTheDocument();
    });
  });

  describe("given the reader turns the sample panels off on an empty screen", () => {
    beforeEach(withNothingMeasured);

    it("does not put them back", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "Hide sample data" }));

      expect(screen.queryByText(A_SAMPLE_PANEL)).not.toBeInTheDocument();
    });
  });
});
