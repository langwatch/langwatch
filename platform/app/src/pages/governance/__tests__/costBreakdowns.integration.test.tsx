/**
 * @vitest-environment jsdom
 *
 * The breakdown panels under the cost lanes, mounted through the real page.
 *
 * Two things are under test, and both are about what the screen is allowed to
 * claim. First, the panels have to survive a real answer: the activity reads
 * hand back a wrapper object, not a list, and a panel that maps over the
 * wrapper throws the instant real data arrives — which no test caught, because
 * every existing mock answers `undefined`. Second, a panel that has not heard
 * back must not print a figure: "0 users" and "nothing in this window" are both
 * measurements, and neither has been made while a read is still in flight or
 * was never permitted to run.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** What each activity read answers. `undefined` means it has not answered. */
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

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );

beforeEach(() => {
  harness.activity = {
    summary: undefined,
    spendByDepartment: undefined,
    spendByUser: undefined,
    spendOverTime: undefined,
  };
});

afterEach(() => cleanup());

describe("the cost breakdown panels", () => {
  describe("given the activity reads answer with real figures", () => {
    beforeEach(() => {
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
        {
          departmentId: "dep-2",
          departmentName: "Support",
          spendUsd: "120.25",
        },
      ];
      harness.activity.spendByUser = [
        { actor: "ada@acme.test", spendUsd: "200.00", requests: 90 },
      ];
      // The read answers a wrapper around the buckets, not the buckets. A
      // panel that treats this as a list throws here rather than rendering.
      harness.activity.spendOverTime = {
        buckets: [
          {
            bucketIso: "2026-08-01",
            points: [
              { key: "team-a", label: "Team A", spendUsd: "310.50" },
              { key: "team-b", label: "Team B", spendUsd: "120.25" },
            ],
          },
        ],
      };
    });

    it("renders the real breakdowns instead of throwing on the wrapper", () => {
      renderScreen();

      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("Support")).toBeInTheDocument();
      expect(screen.getByText("ada@acme.test")).toBeInTheDocument();
    });

    it("reports the measured user count", () => {
      renderScreen();

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("never claims a real panel is empty while it holds figures", () => {
      renderScreen();

      expect(screen.queryByText("Not available.")).not.toBeInTheDocument();
    });
  });

  describe("given an activity read has not answered", () => {
    it("says so rather than printing a zero nobody measured", () => {
      renderScreen();

      // The adoption card and every real panel are unanswered here, so the
      // screen may not show "0" or claim the window held nothing.
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Nothing in this window yet."),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText("Not available.").length).toBeGreaterThan(0);
    });
  });

  describe("given an activity read answers with no rows", () => {
    it("reports the window as empty, which it measured", () => {
      harness.activity.summary = {
        activeUsersThisWindow: 0,
        newUsersThisWindow: 0,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [];
      harness.activity.spendByUser = [];
      harness.activity.spendOverTime = { buckets: [] };

      renderScreen();

      expect(
        screen.getAllByText("Nothing in this window yet.").length,
      ).toBeGreaterThan(0);
    });
  });
});
