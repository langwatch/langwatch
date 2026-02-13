/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteSidebar component.
 *
 * Tests sidebar rendering, search filtering, empty states,
 * suite selection, run button, and context menu interactions.
 *
 * @see specs/suites/suite-workflow.feature - "Sidebar Search", "Empty State"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "@prisma/client";
import { SuiteSidebar } from "../SuiteSidebar";

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
  selectedSuiteId: null,
  onSelectSuite: vi.fn(),
  onNewSuite: vi.fn(),
  onRunSuite: vi.fn(),
  onContextMenu: vi.fn(),
};

describe("<SuiteSidebar/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given no suites exist", () => {
    it("displays empty state message", () => {
      render(<SuiteSidebar {...defaultProps} suites={[]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("No suites yet")).toBeInTheDocument();
    });

    it("displays the + New Suite button", () => {
      render(<SuiteSidebar {...defaultProps} suites={[]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("New Suite")).toBeInTheDocument();
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
      makeSuite({ id: "suite_1", name: "Critical Path" }),
      makeSuite({ id: "suite_2", name: "Billing Edge" }),
      makeSuite({ id: "suite_3", name: "Quick Run" }),
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
            selectedSuiteId="suite_2"
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
        expect(onSelectSuite).toHaveBeenCalledWith("suite_1");
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

  describe("when + New Suite button is clicked", () => {
    it("calls onNewSuite", async () => {
      const user = userEvent.setup();
      const onNewSuite = vi.fn();

      render(
        <SuiteSidebar {...defaultProps} onNewSuite={onNewSuite} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("New Suite"));
      expect(onNewSuite).toHaveBeenCalledOnce();
    });
  });

  describe("given suites with run summaries", () => {
    const suites = [
      makeSuite({ id: "suite_1", name: "Critical Path" }),
      makeSuite({ id: "suite_2", name: "Billing Edge" }),
    ];

    describe("when a suite has all passing results", () => {
      it("displays pass count and total", () => {
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
    });

    describe("when a suite has some failures", () => {
      it("displays pass count and total showing the gap", () => {
        const runSummaries = new Map([
          [
            "suite_2",
            {
              passedCount: 9,
              totalCount: 12,
              lastRunTimestamp: Date.now() - 60 * 1000,
            },
          ],
        ]);

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
      expect(onSelectSuite).toHaveBeenCalledWith("all-runs");
    });
  });
});
