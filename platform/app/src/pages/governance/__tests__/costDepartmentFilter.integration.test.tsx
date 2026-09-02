/**
 * @vitest-environment jsdom
 *
 * What the department chip says, against what the screen actually filtered.
 *
 * The department options are built from the response, so changing the time
 * frame can drop the department the reader picked. When that happens the chip
 * has no name to show and falls back to "All departments" — and the selection
 * itself is a separate piece of state that nothing resets. The two disagree,
 * and the reader is shown an empty panel labelled as every department's spend.
 *
 * These tests hold the label and the filtered rows to the same story, whichever
 * side the fix moves.
 *
 * Issue: #7767
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENGINEERING = {
  departmentId: "dep-1",
  departmentName: "Engineering",
  spendUsd: "310.50",
};
const SUPPORT = {
  departmentId: "dep-2",
  departmentName: "Support",
  spendUsd: "120.25",
};

const harness = vi.hoisted(() => ({
  /**
   * Keyed by window, because that is the whole point: the shorter window has
   * no Engineering rows in it, which is what removes the option the reader is
   * standing on.
   */
  departmentsByWindow: {} as Record<number, unknown>,
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
      summary: {
        useQuery: () => ({
          data: {
            activeUsersThisWindow: 42,
            newUsersThisWindow: 3,
            spentThisWindowUsd: "500.00",
          },
        }),
      },
      spendByDepartment: {
        // Answers per window, the way the real read does.
        useQuery: (input: { windowDays: number }) => ({
          data: harness.departmentsByWindow[input.windowDays],
        }),
      },
      spendByUser: {
        useQuery: () => ({
          data: [{ actor: "ada@acme.test", spendUsd: "200.00", requests: 90 }],
        }),
      },
      spendOverTime: {
        useQuery: () => ({
          data: {
            buckets: [
              {
                bucketIso: "2026-08-01",
                points: [
                  { key: "team-a", label: "Team A", spendUsd: "310.50" },
                ],
              },
            ],
          },
        }),
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
  harness.departmentsByWindow = {
    30: [ENGINEERING, SUPPORT],
    // Engineering spent nothing in the last seven days, so it is not here.
    7: [SUPPORT],
  };
});

afterEach(() => cleanup());

describe("the department filter", () => {
  describe("given a department is selected and the window then drops it", () => {
    it("never labels the chip all departments while still filtering by one", async () => {
      renderScreen();

      await pickFilter("Department", "Engineering");
      await waitFor(() =>
        expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0),
      );

      await pickFilter("Time Frame", "Last 7 days");

      // Whatever the fix does, these two have to agree. Today the chip says
      // "All departments" and the panel shows no department at all, because
      // the dropped Engineering id is still filtering every row away.
      await waitFor(() => {
        const saysAllDepartments =
          screen.queryAllByText("All departments").length > 0;
        const showsEveryReturnedDepartment =
          screen.queryAllByText("Support").length > 0;

        expect({ saysAllDepartments, showsEveryReturnedDepartment }).toEqual({
          saysAllDepartments: true,
          showsEveryReturnedDepartment: true,
        });
      });
    });
  });

  describe("given a department is selected and the window keeps it", () => {
    it("keeps filtering to that department", async () => {
      harness.departmentsByWindow[7] = [ENGINEERING, SUPPORT];

      renderScreen();

      await pickFilter("Department", "Engineering");
      await pickFilter("Time Frame", "Last 7 days");

      await waitFor(() =>
        expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0),
      );
      // The selection survives a window that still contains it: the panel is
      // filtered, so Support is not among the rows.
      const panel = screen
        .getByText("Cost by department")
        .closest('[data-testid="cost-panel"]') as HTMLElement;
      expect(panel.textContent).not.toContain("Support");
    });
  });

  describe("given a department is selected and the next read has not answered", () => {
    it("keeps naming the selection instead of claiming all departments", async () => {
      harness.departmentsByWindow[7] = undefined;

      renderScreen();

      await pickFilter("Department", "Engineering");
      await pickFilter("Time Frame", "Last 7 days");

      // An unanswered read is not evidence the department disappeared, so
      // resetting here would throw away the reader's choice on every refetch.
      await waitFor(() =>
        expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0),
      );
    });
  });
});
