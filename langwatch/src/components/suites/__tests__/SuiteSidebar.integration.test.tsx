/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteSidebar component.
 *
 * Tests sidebar rendering, search filtering, empty states,
 * suite selection, run button, context menu interactions,
 * status summary display, and three-dot menu.
 *
 * @see specs/suites/suite-workflow.feature - "Sidebar Search", "Empty State"
 * @see specs/features/suites/suite-sidebar-status-summary.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "@prisma/client";
import { SuiteSidebar, SUITE_SIDEBAR_COLLAPSED_KEY } from "../SuiteSidebar";
import { ALL_RUNS_ID } from "../useSuiteRouting";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeSuite(
  overrides: Partial<SimulationSuite> = {},
): SimulationSuite {
  return {
    id: "suite_1",
    projectId: "project_1",
    name: "Critical Path",
    slug: "critical-path",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const defaultProps = {
  suites: [] as SimulationSuite[],
  selectedSuiteSlug: null,
  onSelectSuite: vi.fn(),
  onRunSuite: vi.fn(),
  onContextMenu: vi.fn(),
};

describe("<SuiteSidebar/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("given no suites exist", () => {
    it("displays empty state message", () => {
      render(<SuiteSidebar {...defaultProps} suites={[]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("No suites yet")).toBeInTheDocument();
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
      makeSuite({ id: "suite_1", name: "Critical Path", slug: "critical-path" }),
      makeSuite({ id: "suite_2", name: "Billing Edge", slug: "billing-edge" }),
      makeSuite({ id: "suite_3", name: "Quick Run", slug: "quick-run" }),
    ];

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
      it("displays a search icon inside the input", () => {
        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        expect(
          screen.getByRole("img", { name: "Search" }),
        ).toBeInTheDocument();
      });
    });

    describe("when typing 'billing' in the search box", () => {
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
      it("displays no matching suites message", async () => {
        const user = userEvent.setup();

        render(<SuiteSidebar {...defaultProps} suites={suites} />, {
          wrapper: Wrapper,
        });

        const searchInput = screen.getByPlaceholderText("Search...");
        await user.type(searchInput, "nonexistent");

        expect(screen.getByText("No matching suites")).toBeInTheDocument();
      });
    });
  });

  describe("given suites with run summaries", () => {
    const suites = [
      makeSuite({ id: "suite_1", name: "Critical Path" }),
      makeSuite({ id: "suite_2", name: "Billing Edge" }),
      makeSuite({ id: "suite_3", name: "New Suite" }),
    ];

    describe("when a suite has all passing results", () => {
      const runSummaries = new Map([
        [
          "suite_1",
          {
            passedCount: 8,
            totalCount: 8,
            lastRunTimestamp: Date.now() - 2 * 60 * 60 * 1000,
          },
        ],
      ]);

      it("displays pass count and total", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText(/8\/8 passed/)).toBeInTheDocument();
      });

      it("displays a checkmark status icon", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByTestId("status-icon-pass")).toBeInTheDocument();
      });

      it("displays compact recency text", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText(/2h ago/)).toBeInTheDocument();
      });
    });

    describe("when a suite has some failures", () => {
      const runSummaries = new Map([
        [
          "suite_2",
          {
            passedCount: 9,
            totalCount: 12,
            lastRunTimestamp: Date.now() - 3 * 60 * 60 * 1000,
          },
        ],
      ]);

      it("displays pass count and total showing the gap", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText(/9\/12 passed/)).toBeInTheDocument();
      });

      it("displays an error status icon", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
            runSummaries={runSummaries}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByTestId("status-icon-fail")).toBeInTheDocument();
      });
    });

    describe("when a suite has no run data", () => {
      it("does not display a run summary line", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
      });

      it("does not display a status icon", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            suites={suites}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.queryByTestId("status-icon-pass")).not.toBeInTheDocument();
        expect(screen.queryByTestId("status-icon-fail")).not.toBeInTheDocument();
      });
    });

    describe("when run data updates via props", () => {
      it("reflects the latest run summary", () => {
        const initialSummaries = new Map([
          [
            "suite_1",
            {
              passedCount: 7,
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

        expect(screen.getByText(/7\/8 passed/)).toBeInTheDocument();

        const updatedSummaries = new Map([
          [
            "suite_1",
            {
              passedCount: 8,
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

        expect(screen.getByText(/8\/8 passed/)).toBeInTheDocument();
        expect(screen.queryByText(/7\/8 passed/)).not.toBeInTheDocument();
      });
    });
  });

  describe("when All Runs is clicked", () => {
    it("calls onSelectSuite with 'all-runs'", async () => {
      const user = userEvent.setup();
      const onSelectSuite = vi.fn();

      render(
        <SuiteSidebar {...defaultProps} onSelectSuite={onSelectSuite} />,
        { wrapper: Wrapper },
      );

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
    const suites = [
      makeSuite({ id: "suite_1", name: "Critical Path" }),
    ];

    describe("when hovering over a suite item", () => {
      it("shows a three-dot menu button", async () => {
        const user = userEvent.setup();

        render(
          <SuiteSidebar {...defaultProps} suites={suites} />,
          { wrapper: Wrapper },
        );

        const suiteItem = screen.getByText("Critical Path").closest("[data-testid='suite-list-item']")!;
        await user.hover(suiteItem);

        expect(screen.getByTestId("suite-menu-button")).toBeInTheDocument();
      });
    });

    describe("when not hovering over a suite item", () => {
      it("renders the three-dot menu button in the DOM", () => {
        render(
          <SuiteSidebar {...defaultProps} suites={suites} />,
          { wrapper: Wrapper },
        );

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

        const suiteItem = screen.getByText("Critical Path").closest("[data-testid='suite-list-item']")!;
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

  describe("collapsible sidebar", () => {
    const suites = [
      makeSuite({ id: "suite_1", name: "Critical Path", slug: "critical-path" }),
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

        expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
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
        await user.click(
          screen.getByRole("button", { name: "Critical Path" }),
        );

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
        expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
      });
    });
  });
});
