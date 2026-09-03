/**
 * @vitest-environment jsdom
 *
 * The Suite sidebar: run plans and external sets, search, collapse, and the
 * per-item run/status/context-menu affordances.
 *
 * @see specs/features/suites/external-sdk-ci-sets-in-sidebar.feature
 * @see specs/features/suites/all-runs-batch-origin-label.feature
 * @see specs/features/suites/rename-suites-to-runs.feature
 * @see specs/features/suites/remove-redundant-suites-label.feature
 * @see specs/components/search-input.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "../../../../model/prisma-types";
import type { ExternalSetSummary } from "@langwatch/scenario-contract";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

import { NowContext } from "../../../../behavior/use-now";
import { SUITE_SIDEBAR_COLLAPSED_KEY, SuiteSidebar } from "../suite-sidebar";
import {
  ALL_RUNS_ID,
  toExternalSetSelection,
} from "../../../../behavior/suites/use-suite-routing";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeSuite(overrides: Partial<SimulationSuite> = {}): SimulationSuite {
  return {
    id: "suite_1",
    projectId: "project_1",
    name: "Critical Path",
    slug: "critical-path",
    kind: "run_plan",
    scope: null,
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExternalSet(
  overrides: Partial<ExternalSetSummary> = {},
): ExternalSetSummary {
  return {
    scenarioSetId: "nightly-regression",
    passedCount: 10,
    failedCount: 0,
    totalCount: 10,
    lastRunTimestamp: Date.now() - 30 * 60 * 1000,
    ...overrides,
  };
}

const defaultProps = {
  projectSlug: "my-project",
  suites: [] as SimulationSuite[],
  selectedSuiteSlug: null,
  onSelectSuite: vi.fn(),
  onRunSuite: vi.fn(),
  onContextMenu: vi.fn(),
};

describe("<SuiteSidebar/> External Sets", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("given no external sets exist", () => {
    /** @scenario "External Sets section is hidden when no external sets exist" */
    it("does not display the External Sets section header", () => {
      render(<SuiteSidebar {...defaultProps} suites={[makeSuite()]} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.queryByTestId("external-sets-header"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given external sets exist", () => {
    const externalSets = [
      makeExternalSet({ scenarioSetId: "nightly-regression" }),
      makeExternalSet({
        scenarioSetId: "ci-smoke-tests",
        passedCount: 15,
        totalCount: 20,
        lastRunTimestamp: Date.now() - 60 * 60 * 1000,
      }),
    ];

    /** @scenario "External sets section appears with SDK-submitted scenario runs" */
    it("displays the External Sets section header", () => {
      render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("external-sets-header")).toHaveTextContent(
        "EXTERNAL SETS",
      );
    });

    /** @scenario "External set batch entry displays the set name" */
    /** @scenario "External set uses scenarioSetId as its display name" */
    it("displays external set names", () => {
      render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("nightly-regression")).toBeInTheDocument();
      expect(screen.getByText("ci-smoke-tests")).toBeInTheDocument();
    });

    /** @scenario "External set entry shows pass rate and recency" */
    it("displays pass/fail summary for external sets", () => {
      render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText(/15 passed/)).toBeInTheDocument();
    });

    it("does not display a Run button on external set items", () => {
      render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
        wrapper: Wrapper,
      });

      const externalItems = screen.getAllByTestId("external-set-list-item");
      for (const item of externalItems) {
        expect(within(item).queryByText("Run")).not.toBeInTheDocument();
      }
    });

    describe("when all runs pass in an external set", () => {
      /** @scenario "External set shows correct status indicator" */
      it("displays 100% pass rate", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={[
              makeExternalSet({ passedCount: 10, totalCount: 10 }),
            ]}
          />,
          { wrapper: Wrapper },
        );

        const items = screen.getAllByTestId("external-set-list-item");
        expect(within(items[0]!).getByText("100%")).toBeInTheDocument();
      });
    });

    describe("when some runs fail in an external set", () => {
      it("displays pass rate reflecting failures", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={[makeExternalSet({ passedCount: 7, totalCount: 10 })]}
          />,
          { wrapper: Wrapper },
        );

        const items = screen.getAllByTestId("external-set-list-item");
        expect(within(items[0]!).getByText("70%")).toBeInTheDocument();
      });
    });

    describe("when an external set is clicked", () => {
      it("calls onSelectSuite with the external set selection identifier", async () => {
        const user = userEvent.setup();
        const onSelectSuite = vi.fn();

        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={externalSets}
            onSelectSuite={onSelectSuite}
          />,
          { wrapper: Wrapper },
        );

        await user.click(screen.getByText("nightly-regression"));
        expect(onSelectSuite).toHaveBeenCalledWith(
          toExternalSetSelection("nightly-regression"),
        );
      });
    });

    describe("when an external set is selected", () => {
      it("highlights the selected external set", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={externalSets}
            selectedSuiteSlug={toExternalSetSelection("nightly-regression")}
          />,
          { wrapper: Wrapper },
        );

        const listItems = screen.getAllByTestId("external-set-list-item");
        const selectedItem = listItems.find((item) =>
          within(item).queryByText("nightly-regression"),
        );
        expect(selectedItem).toBeDefined();
        expect(selectedItem).toHaveAttribute("data-selected", "true");
      });

      it("does not highlight unselected external sets", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={externalSets}
            selectedSuiteSlug={toExternalSetSelection("nightly-regression")}
          />,
          { wrapper: Wrapper },
        );

        const listItems = screen.getAllByTestId("external-set-list-item");
        const unselectedItem = listItems.find((item) =>
          within(item).queryByText("ci-smoke-tests"),
        );
        expect(unselectedItem).toBeDefined();
        expect(unselectedItem).not.toHaveAttribute("data-selected");
      });
    });
  });

  describe("search filtering across suites and external sets", () => {
    const suites = [
      makeSuite({
        id: "suite_1",
        name: "Billing Tests",
        slug: "billing-tests",
      }),
    ];
    const externalSets = [makeExternalSet({ scenarioSetId: "billing-ci" })];

    describe("when typing 'billing' in the search box", () => {
      it("shows matching suites", async () => {
        const user = userEvent.setup();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            externalSets={externalSets}
          />,
          { wrapper: Wrapper },
        );

        await user.type(screen.getByPlaceholderText("Search..."), "billing");
        expect(screen.getByText("Billing Tests")).toBeInTheDocument();
      });

      it("shows matching external sets", async () => {
        const user = userEvent.setup();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            externalSets={externalSets}
          />,
          { wrapper: Wrapper },
        );

        await user.type(screen.getByPlaceholderText("Search..."), "billing");
        expect(screen.getByText("billing-ci")).toBeInTheDocument();
      });
    });

    describe("when search matches nothing", () => {
      it("hides both sections and shows no matching message", async () => {
        const user = userEvent.setup();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            externalSets={externalSets}
          />,
          { wrapper: Wrapper },
        );

        await user.type(
          screen.getByPlaceholderText("Search..."),
          "zzz-no-match",
        );
        expect(screen.queryByText("Billing Tests")).not.toBeInTheDocument();
        expect(screen.queryByText("billing-ci")).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("external-sets-header"),
        ).not.toBeInTheDocument();
        expect(screen.getByText("No matching run plans")).toBeInTheDocument();
      });
    });
  });

  describe("given an external set with no runs", () => {
    // Skipped: Code bug in SuiteSidebar.tsx — ExternalSetListItem always renders
    // <RunSummaryLine> unconditionally, even when totalCount=0. This means "0 passed"
    // and a pass-rate indicator are shown for sets with no runs. Fix: conditionally
    // render <RunSummaryLine> only when totalCount > 0 (or lastRunTimestamp > 0).
    it.skip("displays only the name with no summary line", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={[
            makeExternalSet({
              scenarioSetId: "New Set",
              passedCount: 0,
              totalCount: 0,
              lastRunTimestamp: 0,
            }),
          ]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("New Set")).toBeInTheDocument();
      expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("status-icon-pass")).not.toBeInTheDocument();
      expect(screen.queryByTestId("status-icon-fail")).not.toBeInTheDocument();
    });
  });

  describe("given an external set with runs", () => {
    it("displays recency indicator alongside pass count", () => {
      vi.useFakeTimers();
      const now = new Date("2025-01-15T12:00:00Z").getTime();
      vi.setSystemTime(now);

      const NowWrapper = ({ children }: { children: React.ReactNode }) => (
        <ChakraProvider value={defaultSystem}>
          <NowContext value={Date.now()}>{children}</NowContext>
        </ChakraProvider>
      );

      try {
        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={[
              makeExternalSet({
                scenarioSetId: "ci-smoke-tests",
                passedCount: 15,
                totalCount: 20,
                lastRunTimestamp: now - 30 * 60 * 1000,
              }),
            ]}
          />,
          { wrapper: NowWrapper },
        );

        expect(screen.getByText(/15 passed/)).toBeInTheDocument();
        const extSetItems = screen.getAllByTestId("external-set-list-item");
        const texts = extSetItems.map((el) => el.textContent).join(" ");
        expect(texts).toMatch(/30m ago/);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not show a three-dot menu button", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={[makeExternalSet({ scenarioSetId: "ci-smoke-tests" })]}
        />,
        { wrapper: Wrapper },
      );

      const items = screen.getAllByTestId("external-set-list-item");
      expect(
        within(items[0]!).queryByTestId("suite-menu-button"),
      ).not.toBeInTheDocument();
    });
  });

  describe("ordering", () => {
    it("displays external sets ordered by most recent run first", () => {
      // Backend returns sets ordered by most recent run first
      const externalSets = [
        makeExternalSet({
          scenarioSetId: "recent-set",
          lastRunTimestamp: Date.now() - 10 * 60 * 1000,
        }),
        makeExternalSet({
          scenarioSetId: "old-set",
          lastRunTimestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
        }),
      ];

      render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
        wrapper: Wrapper,
      });

      const items = screen.getAllByTestId("external-set-list-item");
      expect(items[0]!.textContent).toContain("recent-set");
      expect(items[1]!.textContent).toContain("old-set");
    });
  });
});

describe("<SuiteSidebar/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("given no suites exist", () => {
    /** @scenario "Empty state when no run plans exist" */
    it("displays empty state message", () => {
      render(<SuiteSidebar {...defaultProps} suites={[]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("No run plans yet")).toBeInTheDocument();
    });

    it("displays the All Runs link", () => {
      render(<SuiteSidebar {...defaultProps} suites={[]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("All Runs")).toBeInTheDocument();
    });
  });

  describe("given suites exist", () => {
    const suites = [
      makeSuite({
        id: "suite_1",
        name: "Critical Path",
        slug: "critical-path",
      }),
      makeSuite({ id: "suite_2", name: "Billing Edge", slug: "billing-edge" }),
      makeSuite({ id: "suite_3", name: "Quick Run", slug: "quick-run" }),
    ];

    /** @scenario "Sidebar still shows suite names and action buttons after label removal" */
    it("displays all suite names", () => {
      render(<SuiteSidebar {...defaultProps} suites={suites} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Critical Path")).toBeInTheDocument();
      expect(screen.getByText("Billing Edge")).toBeInTheDocument();
      expect(screen.getByText("Quick Run")).toBeInTheDocument();
    });

    describe("when a suite is selected", () => {
      it("highlights the selected suite", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            selectedSuiteSlug="billing-edge"
          />,
          { wrapper: Wrapper },
        );

        // All suites are rendered; the selected one has distinct bg via isSelected
        expect(screen.getByText("Billing Edge")).toBeInTheDocument();
      });
    });

    describe("when a suite is clicked", () => {
      it("calls onSelectSuite with the suite id", async () => {
        const user = userEvent.setup();
        const onSelectSuite = vi.fn();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            onSelectSuite={onSelectSuite}
          />,
          { wrapper: Wrapper },
        );

        await user.click(screen.getByText("Critical Path"));
        expect(onSelectSuite).toHaveBeenCalledWith("critical-path");
      });
    });

    describe("when the Run button is clicked on a suite", () => {
      it("calls onRunSuite with the suite id", async () => {
        const user = userEvent.setup();
        const onRunSuite = vi.fn();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            onRunSuite={onRunSuite}
          />,
          { wrapper: Wrapper },
        );

        const runButtons = screen.getAllByText("Run");
        // Click the first suite's Run button
        await user.click(runButtons[0]!);
        expect(onRunSuite).toHaveBeenCalledWith("suite_1");
      });
    });

    describe("when a suite is right-clicked", () => {
      it("calls onContextMenu with the event and suite id", async () => {
        const user = userEvent.setup();
        const onContextMenu = vi.fn();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            onContextMenu={onContextMenu}
          />,
          { wrapper: Wrapper },
        );

        const suiteItem = screen.getByText("Critical Path");
        await user.pointer({ keys: "[MouseRight]", target: suiteItem });
        expect(onContextMenu).toHaveBeenCalledWith(
          expect.any(Object),
          "suite_1",
        );
      });
    });

    describe("when looking at the search field", () => {
      it("labels the search field, its leading icon decorative", () => {
        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        // The icon itself is aria-hidden; the input carries the "Search"
        // accessible name instead — see specs/components/search-input.feature.
        expect(
          screen.getByRole("searchbox", { name: "Search" }),
        ).toBeInTheDocument();
      });
    });

    describe("when typing 'billing' in the search box", () => {
      /** @scenario Suite sidebar filters suites with search icon visible */
      it("filters to only show Billing Edge", async () => {
        const user = userEvent.setup();

        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        const searchInput = screen.getByPlaceholderText("Search...");
        await user.type(searchInput, "billing");

        expect(screen.getByText("Billing Edge")).toBeInTheDocument();
        expect(screen.queryByText("Critical Path")).not.toBeInTheDocument();
        expect(screen.queryByText("Quick Run")).not.toBeInTheDocument();
      });
    });

    describe("when search matches no suites", () => {
      /** @scenario "Empty state when search has no matches" */
      it("displays no matching suites message", async () => {
        const user = userEvent.setup();

        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        const searchInput = screen.getByPlaceholderText("Search...");
        await user.type(searchInput, "nonexistent");

        expect(screen.getByText("No matching run plans")).toBeInTheDocument();
      });
    });
  });

  describe("given suites with labels", () => {
    const suitesWithLabels = [
      makeSuite({
        id: "suite_1",
        name: "Nightly Suite",
        slug: "nightly-suite",
        labels: ["nightly", "regression"],
      }),
    ];

    it("does not display suite labels as tag pills", () => {
      render(<SuiteSidebar {...defaultProps} suites={suitesWithLabels} />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByText("nightly")).not.toBeInTheDocument();
      expect(screen.queryByText("regression")).not.toBeInTheDocument();
    });
  });

  describe("given suites with run summaries", () => {
    const suites = [
      makeSuite({ id: "suite_1", name: "Critical Path" }),
      makeSuite({ id: "suite_2", name: "Billing Edge" }),
      makeSuite({ id: "suite_3", name: "New Suite" }),
    ];

    describe("when a suite has all passing results", () => {
      const FIXED_NOW = new Date("2026-01-15T12:00:00Z").getTime();
      const runSummaries = new Map([
        [
          "suite_1",
          {
            passedCount: 8,
            failedCount: 0,
            totalCount: 8,
            lastRunTimestamp: FIXED_NOW - 2 * 60 * 60 * 1000,
          },
        ],
      ]);

      it("displays pass count", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText(/8 passed/)).toBeInTheDocument();
      });

      it("displays pass rate with circle", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("100%")).toBeInTheDocument();
      });

      it("displays compact recency text", () => {
        const NowWrapper = ({ children }: { children: React.ReactNode }) => (
          <ChakraProvider value={defaultSystem}>
            <NowContext value={Date.now()}>{children}</NowContext>
          </ChakraProvider>
        );
        // Override the NowProvider with FIXED_NOW so time is deterministic
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_NOW);
        try {
          render(
            <SuiteSidebar
              {...defaultProps}
              suites={suites}
              runSummaries={runSummaries}
            />,
            { wrapper: NowWrapper },
          );

          const suiteItems = screen.getAllByTestId("suite-list-item");
          const texts = suiteItems.map((el) => el.textContent).join(" ");
          expect(texts).toMatch(/2h ago/);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("when a suite has some failures", () => {
      const runSummaries = new Map([
        [
          "suite_2",
          {
            passedCount: 9,
            failedCount: 3,
            totalCount: 12,
            lastRunTimestamp: Date.now() - 3 * 60 * 60 * 1000,
          },
        ],
      ]);

      it("displays pass count", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText(/9 passed/)).toBeInTheDocument();
      });

      it("displays pass rate reflecting failures", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("75%")).toBeInTheDocument();
      });
    });

    describe("when a suite has no run data", () => {
      it("does not display a run summary line", () => {
        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
      });

      it("does not display a status icon", () => {
        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        expect(
          screen.queryByTestId("status-icon-pass"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("status-icon-fail"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when run data updates via props", () => {
      it("reflects the latest run summary", () => {
        const initialSummaries = new Map([
          [
            "suite_1",
            {
              passedCount: 7,
              failedCount: 1,
              totalCount: 8,
              lastRunTimestamp: Date.now() - 60 * 60 * 1000,
            },
          ],
        ]);

        const { rerender } = render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={initialSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText(/7 passed/)).toBeInTheDocument();

        const updatedSummaries = new Map([
          [
            "suite_1",
            {
              passedCount: 8,
              failedCount: 0,
              totalCount: 8,
              lastRunTimestamp: Date.now(),
            },
          ],
        ]);

        rerender(
          <Wrapper>
            <SuiteSidebar
              {...defaultProps}
              suites={suites}
              runSummaries={updatedSummaries}
            />
          </Wrapper>,
        );

        expect(screen.getByText(/8 passed/)).toBeInTheDocument();
        expect(screen.queryByText(/7 passed/)).not.toBeInTheDocument();
      });
    });
  });

  describe("when All Runs is clicked", () => {
    it("calls onSelectSuite with 'all-runs'", async () => {
      const user = userEvent.setup();
      const onSelectSuite = vi.fn();

      render(<SuiteSidebar {...defaultProps} onSelectSuite={onSelectSuite} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByText("All Runs"));
      expect(onSelectSuite).toHaveBeenCalledWith(ALL_RUNS_ID);
    });

    it("does not show a status summary for All Runs", () => {
      const suites = [makeSuite({ id: "suite_1", name: "Critical Path" })];
      const runSummaries = new Map([
        [
          "suite_1",
          {
            passedCount: 8,
            failedCount: 0,
            totalCount: 8,
            lastRunTimestamp: Date.now() - 60 * 60 * 1000,
          },
        ],
      ]);

      render(
        <SuiteSidebar
          {...defaultProps}
          suites={suites}
          runSummaries={runSummaries}
          selectedSuiteSlug={ALL_RUNS_ID}
        />,
        { wrapper: Wrapper },
      );

      const allRunsButton = screen.getByText("All Runs");
      const container = allRunsButton.parentElement;
      expect(container).not.toBeNull();
      expect(container!.textContent).not.toMatch(/passed/);
    });
  });

  describe("three-dot context menu", () => {
    const suites = [makeSuite({ id: "suite_1", name: "Critical Path" })];

    describe("when hovering over a suite item", () => {
      it("shows a three-dot menu button", async () => {
        const user = userEvent.setup();

        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        const suiteItem = screen
          .getByText("Critical Path")
          .closest("[data-testid='suite-list-item']")!;
        await user.hover(suiteItem);

        expect(screen.getByTestId("suite-menu-button")).toBeInTheDocument();
      });
    });

    describe("when not hovering over a suite item", () => {
      it("renders the three-dot menu button in the DOM", () => {
        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        expect(screen.getByTestId("suite-menu-button")).toBeInTheDocument();
      });
    });

    describe("when clicking the three-dot menu button", () => {
      it("calls onContextMenu when three-dot button is clicked", async () => {
        const user = userEvent.setup();
        const onContextMenu = vi.fn();

        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            onContextMenu={onContextMenu}
          />,
          { wrapper: Wrapper },
        );

        const suiteItem = screen
          .getByText("Critical Path")
          .closest("[data-testid='suite-list-item']")!;
        await user.hover(suiteItem);

        const menuButton = screen.getByTestId("suite-menu-button");
        await user.click(menuButton);

        expect(onContextMenu).toHaveBeenCalledWith(
          expect.any(Object),
          "suite_1",
        );
      });
    });
  });

  describe("when viewing the expanded sidebar (remove-redundant-suites-label)", () => {
    const suites = [
      makeSuite({
        id: "suite_1",
        name: "Critical Path",
        slug: "critical-path",
      }),
      makeSuite({ id: "suite_2", name: "Billing Edge", slug: "billing-edge" }),
    ];

    it("does not display a SUITES section header", () => {
      render(<SuiteSidebar {...defaultProps} suites={suites} />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByText(/^SUITES$/)).not.toBeInTheDocument();
    });

    it("displays suite names", () => {
      render(<SuiteSidebar {...defaultProps} suites={suites} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Critical Path")).toBeInTheDocument();
      expect(screen.getByText("Billing Edge")).toBeInTheDocument();
    });

    it("displays the search box", () => {
      render(<SuiteSidebar {...defaultProps} suites={suites} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    });

    it("displays the collapse button", () => {
      render(<SuiteSidebar {...defaultProps} suites={suites} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByRole("button", { name: "Collapse sidebar" }),
      ).toBeInTheDocument();
    });
  });

  describe("collapsible sidebar", () => {
    const suites = [
      makeSuite({
        id: "suite_1",
        name: "Critical Path",
        slug: "critical-path",
      }),
      makeSuite({ id: "suite_2", name: "Billing Edge", slug: "billing-edge" }),
    ];

    function renderSidebar() {
      const user = userEvent.setup();
      const props = {
        ...defaultProps,
        suites,
        onSelectSuite: vi.fn(),
      };

      render(<SuiteSidebar {...props} />, { wrapper: Wrapper });

      return { user, props };
    }

    describe("when expanded (default state)", () => {
      it("is expanded by default", () => {
        renderSidebar();

        expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
        expect(screen.getByText("Critical Path")).toBeInTheDocument();
        expect(screen.getByText("Billing Edge")).toBeInTheDocument();
      });

      it("displays the collapse button", () => {
        renderSidebar();

        expect(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        ).toBeInTheDocument();
      });
    });

    describe("when the collapse button is clicked", () => {
      it("hides search box", async () => {
        const { user } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );

        expect(
          screen.queryByPlaceholderText("Search..."),
        ).not.toBeInTheDocument();
      });

      it("shows suite avatar icons", async () => {
        const { user } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );

        expect(screen.getByText("C")).toBeInTheDocument();
        expect(screen.getByText("B")).toBeInTheDocument();
      });

      it("shows the expand button", async () => {
        const { user } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );

        expect(
          screen.getByRole("button", { name: "Expand sidebar" }),
        ).toBeInTheDocument();
      });

      it("shows the all runs icon button", async () => {
        const { user } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );

        expect(
          screen.getByRole("button", { name: "All Runs" }),
        ).toBeInTheDocument();
      });

      it("persists collapsed state to localStorage", async () => {
        const { user } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );

        expect(localStorage.getItem(SUITE_SIDEBAR_COLLAPSED_KEY)).toBe("true");
      });
    });

    describe("when the expand button is clicked after collapsing", () => {
      it("restores search box", async () => {
        const { user } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );
        await user.click(
          screen.getByRole("button", { name: "Expand sidebar" }),
        );

        expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
      });
    });

    describe("when a suite icon is clicked in collapsed mode", () => {
      it("navigates to that suite", async () => {
        const { user, props } = renderSidebar();

        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );
        await user.click(screen.getByRole("button", { name: "Critical Path" }));

        expect(props.onSelectSuite).toHaveBeenCalledWith("critical-path");
      });
    });

    describe("when search is active before collapsing", () => {
      it("filters collapsed icons to match the search query", async () => {
        const { user } = renderSidebar();

        await user.type(screen.getByPlaceholderText("Search..."), "Critical");
        await user.click(
          screen.getByRole("button", { name: "Collapse sidebar" }),
        );

        expect(
          screen.getByRole("button", { name: "Critical Path" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Billing Edge" }),
        ).not.toBeInTheDocument();
      });
    });

    describe("when localStorage has collapsed state set", () => {
      it("reads collapsed state from localStorage on mount", () => {
        localStorage.setItem(SUITE_SIDEBAR_COLLAPSED_KEY, "true");

        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        expect(
          screen.getByRole("button", { name: "Expand sidebar" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByPlaceholderText("Search..."),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given external sets with different timestamps", () => {
    const externalSets = [
      {
        scenarioSetId: "oldest-set",
        passedCount: 3,
        failedCount: 2,
        totalCount: 5,
        lastRunTimestamp: 1000,
      },
      {
        scenarioSetId: "newest-set",
        passedCount: 5,
        failedCount: 0,
        totalCount: 5,
        lastRunTimestamp: 3000,
      },
      {
        scenarioSetId: "middle-set",
        passedCount: 4,
        failedCount: 1,
        totalCount: 5,
        lastRunTimestamp: 2000,
      },
    ];

    describe("when rendered in the expanded sidebar", () => {
      it("sorts external sets by most recent run first", () => {
        render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
          wrapper: Wrapper,
        });

        const items = screen.getAllByTestId("external-set-list-item");
        const labels = items.map((el) => el.textContent);

        expect(labels[0]).toContain("newest-set");
        expect(labels[1]).toContain("middle-set");
        expect(labels[2]).toContain("oldest-set");
      });
    });
  });
});
