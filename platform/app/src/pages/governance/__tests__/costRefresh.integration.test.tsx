/**
 * @vitest-environment jsdom
 *
 * Bringing the cost screen up to date, and refusing to do it unasked.
 *
 * The figures on this screen go stale the moment a pull lands, and nothing on
 * the page ever said so or offered to look again. Refreshing has to bring the
 * collection state with it: a figure brought up to date beside a warning that
 * is not is a worse screen than one where both are old together.
 *
 * The reads are mocked at the tRPC seam and every call is RECORDED — which
 * procedure, with which arguments, under which options — because the two
 * things under test here are exactly that: which reads a refresh re-issues,
 * and which reads the screen issues again on its own.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** Every `useQuery` the page issued this render, in call order. */
  reads: [] as Array<{
    path: string;
    args: unknown;
    options: Record<string, unknown>;
  }>,
  /**
   * Every read the page asked to run again, by procedure path — whether it
   * did so by invalidating the key or by refetching the query. The mechanism
   * is the screen's business; the SET is the contract.
   */
  reissued: [] as string[],
  /** Whether the reads are currently in flight, for the control's busy state. */
  isFetching: false,
  /** Procedure paths whose read has failed. */
  failed: [] as string[],
  /** When the summary read's answer arrived, epoch ms. */
  summaryUpdatedAt: 0,
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
  const read = (path: string, data: unknown) => ({
    useQuery: (args: unknown, options: Record<string, unknown> = {}) => {
      harness.reads.push({ path, args, options });
      const isError = harness.failed.includes(path);
      return {
        data: isError ? undefined : data,
        isLoading: false,
        isError,
        isFetching: harness.isFetching,
        dataUpdatedAt: path.endsWith("summary") ? harness.summaryUpdatedAt : 0,
        refetch: () => {
          harness.reissued.push(path);
        },
      };
    },
  });
  const invalidator = (path: string) => ({
    invalidate: () => {
      harness.reissued.push(path);
      return Promise.resolve();
    },
  });
  return {
    api: {
      useUtils: () => ({
        governanceCost: {
          summary: invalidator("governanceCost.summary"),
          spenders: invalidator("governanceCost.spenders"),
          dailyByProvider: invalidator("governanceCost.dailyByProvider"),
          dayRecords: invalidator("governanceCost.dayRecords"),
        },
        activityMonitor: {
          summary: invalidator("activityMonitor.summary"),
          spendByDepartment: invalidator("activityMonitor.spendByDepartment"),
          spendByUser: invalidator("activityMonitor.spendByUser"),
          spendOverTime: invalidator("activityMonitor.spendOverTime"),
        },
      }),
      governanceCost: {
        summary: read("governanceCost.summary", {
          unavailableReason: null,
          providers: [],
          billed: {
            amountUsd: 123.45,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 123.45, cellsWithoutAmount: 0 },
            ],
          },
          gateway: {
            amountUsd: 67.89,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 67.89, cellsWithoutAmount: 0 },
            ],
          },
          seats: { status: "awaiting_data" },
          series: [{ day: "2026-01-15", billedUsd: 123.45, gatewayUsd: 67.89 }],
          windowDays: 30,
          // A source HAS stopped, so the collection warning is on screen and
          // the refresh has something of that kind to bring up to date.
          staleSources: {
            oldestLastSuccessIso: "2026-01-10T00:00:00.000Z",
            sourceNames: ["Test source"],
          },
          unpricedWindow: null,
        }),
        spenders: read("governanceCost.spenders", { rows: [] }),
        dailyByProvider: read("governanceCost.dailyByProvider", { rows: [] }),
        // `dayRecords` is deliberately NOT in `READS_ON_THE_SCREEN`, and this
        // mock is what makes that absence enforceable rather than decorative.
        // The read is issued only once a reader opens a day, so a refresh
        // re-running it would be work for a panel nobody has opened — and were
        // the refresh to start doing so, the recorded call would land in
        // `reissued` and fail the equality below by naming a read the set does
        // not hold. The direction of the guard is that way round: it catches a
        // refresh that wrongly INCLUDES this read, not one that omits it.
        dayRecords: read("governanceCost.dayRecords", { records: [] }),
      },
      activityMonitor: {
        summary: read("activityMonitor.summary", {
          activeUsersThisWindow: 42,
          newUsersThisWindow: 3,
          spentThisWindowUsd: "500.00",
        }),
        spendByDepartment: read("activityMonitor.spendByDepartment", [
          {
            departmentId: "dep-1",
            departmentName: "Engineering",
            spendUsd: "310.50",
          },
        ]),
        spendByUser: read("activityMonitor.spendByUser", [
          { actor: "someone@example.test", spendUsd: "200.00", requests: 90 },
        ]),
        spendOverTime: read("activityMonitor.spendOverTime", {
          buckets: [
            {
              bucketIso: "2026-01-15",
              points: [{ key: "team-a", label: "Team A", spendUsd: "310.50" }],
            },
          ],
        }),
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

/**
 * Every read this screen is allowed to issue, by name.
 *
 * Named rather than counted, because a count breaks on the next read the
 * screen legitimately gains and says nothing about which one went missing.
 * `spendOverTime` appears once: the screen issues it twice, grouped two ways,
 * and one key covers both.
 */
const READS_ON_THE_SCREEN = [
  "activityMonitor.spendByDepartment",
  "activityMonitor.spendByUser",
  "activityMonitor.spendOverTime",
  "activityMonitor.summary",
  "governanceCost.dailyByProvider",
  "governanceCost.spenders",
  "governanceCost.summary",
];

/** The refresh control, however it is labelled, as long as a reader can find it. */
const refreshControl = () => screen.getByRole("button", { name: /refresh/i });

beforeEach(() => {
  harness.reads = [];
  harness.reissued = [];
  harness.isFetching = false;
  harness.failed = [];
  harness.summaryUpdatedAt = Date.parse("2026-01-15T09:05:00.000Z");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("bringing the cost screen up to date", () => {
  describe("when a permitted viewer asks the screen to refresh", () => {
    /** @scenario "One control brings the figures and the collection state up to date together" */
    it("asks every read on the screen to run again by name, and says it is working until they answer", () => {
      renderScreen();

      fireEvent.click(refreshControl());

      // The SET, never a count. A figure brought up to date beside a stalled
      // collection warning that was not is a worse screen than one where both
      // are old together, and the warning rides the summary read — so the
      // absence of any single name here is a screen that half-refreshes.
      expect([...new Set(harness.reissued)].sort()).toEqual(
        READS_ON_THE_SCREEN,
      );

      // While the reads are in flight the control has to say so, or a reader
      // who sees nothing move clicks it again.
      harness.isFetching = true;
      cleanup();
      renderScreen();
      expect(refreshControl()).toHaveAttribute("aria-busy", "true");

      harness.isFetching = false;
      cleanup();
      renderScreen();
      expect(refreshControl()).not.toHaveAttribute("aria-busy", "true");
    });
  });

  describe("when a permitted viewer opens the cost screen", () => {
    /** @scenario "The header says when the figures were last read" */
    it("says when the figures were last read, taken from when the answer arrived", () => {
      vi.useFakeTimers();
      // Opened nine hours after the answer landed. Without this the two
      // instants are indistinguishable and a header stamped at mount would
      // pass.
      vi.setSystemTime(new Date("2026-01-15T18:00:00.000Z"));
      renderScreen();

      const clock = (iso: string) =>
        new Date(iso).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

      const header = screen.getByTestId("cost-figures-last-read");
      expect(header).toHaveTextContent(/last read/i);
      expect(header).toHaveTextContent(clock("2026-01-15T09:05:00.000Z"));
      // Not the moment the screen was opened: that is a stamp on the render,
      // which tells a reader nothing about how old the money is.
      expect(header).not.toHaveTextContent(clock("2026-01-15T18:00:00.000Z"));
    });
  });

  describe("when one of the reads fails while the screen is being refreshed", () => {
    /** @scenario "A panel that fails to refresh says so instead of emptying" */
    it("says that panel could not be brought up to date rather than leaving it blank", () => {
      harness.failed = ["activityMonitor.spendByDepartment"];
      renderScreen();

      const panel = screen
        .getByText("Cost by department")
        .closest('[data-testid="cost-panel"]');
      expect(panel).not.toBeNull();
      const department = within(panel as HTMLElement);

      expect(
        department.getByText(/could not be brought up to date/i),
      ).toBeInTheDocument();
      // Every panel here renders an unanswered read and an absent figure the
      // same way, so a failed refresh would otherwise land as a blank beside
      // freshly filled neighbours and read as no spend.
      expect(
        department.queryByText("Nothing in this window yet."),
      ).not.toBeInTheDocument();
      expect(department.queryByText("Not available.")).not.toBeInTheDocument();

      // Its neighbours answered and keep their figures, so this cannot pass
      // against an implementation that fails the whole screen.
      expect(screen.getByText("Team A")).toBeInTheDocument();
    });
  });

  describe("when a permitted viewer leaves the cost screen open", () => {
    /** @scenario "The screen does not quietly read the figures again on its own" */
    it("issues no read that polls or re-runs on focus, and says so at each call site", () => {
      renderScreen();

      const issued = [
        ...new Set(harness.reads.map((call) => call.path)),
      ].sort();
      expect(issued).toEqual(READS_ON_THE_SCREEN);

      for (const call of harness.reads) {
        // The source pages DO poll and keep doing so — a connection is watched
        // while it is being set up. This screen is read while a decision is
        // being made, often with the window shared, and figures that move
        // under the reader are worse than figures they chose to bring up to
        // date.
        expect(call.options.refetchInterval ?? false).toBe(false);
        // Stated here rather than inherited from the global query defaults:
        // other governance screens override that global to true, so a money
        // read that does not say the rule at its own call site is one edit
        // away from polling by accident.
        expect(call.options.refetchOnWindowFocus).toBe(false);
      }
    });
  });
});
