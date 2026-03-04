/**
 * @vitest-environment jsdom
 *
 * Integration tests for External Sets in the SuiteSidebar component.
 *
 * @see specs/features/suites/external-sdk-ci-sets-in-sidebar.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "@prisma/client";
import type { ExternalSetSummary } from "~/server/scenarios/scenario-event.types";
import { SuiteSidebar } from "../SuiteSidebar";
import { ALL_RUNS_ID, toExternalSetSelection } from "../useSuiteRouting";

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

function makeExternalSet(
  overrides: Partial<ExternalSetSummary> = {},
): ExternalSetSummary {
  return {
    scenarioSetId: "nightly-regression",
    passedCount: 10,
    totalCount: 10,
    lastRunTimestamp: Date.now() - 30 * 60 * 1000,
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

describe("<SuiteSidebar/> External Sets", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("given no external sets exist", () => {
    it("does not display the External Sets section header", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          suites={[makeSuite()]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("external-sets-header")).not.toBeInTheDocument();
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

    it("displays the External Sets section header", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={externalSets}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("external-sets-header")).toHaveTextContent(
        "EXTERNAL SETS",
      );
    });

    it("displays external set names", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={externalSets}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("nightly-regression")).toBeInTheDocument();
      expect(screen.getByText("ci-smoke-tests")).toBeInTheDocument();
    });

    it("displays pass/fail summary for external sets", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={externalSets}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText(/15\/20 passed/)).toBeInTheDocument();
    });

    it("does not display a Run button on external set items", () => {
      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={externalSets}
        />,
        { wrapper: Wrapper },
      );

      const externalItems = screen.getAllByTestId("external-set-list-item");
      for (const item of externalItems) {
        expect(within(item).queryByText("Run")).not.toBeInTheDocument();
      }
    });

    describe("when all runs pass in an external set", () => {
      it("displays checkmark status icon", () => {
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
        expect(
          within(items[0]!).getByTestId("status-icon-pass"),
        ).toBeInTheDocument();
      });
    });

    describe("when some runs fail in an external set", () => {
      it("displays error status icon", () => {
        render(
          <SuiteSidebar
            {...defaultProps}
            externalSets={[
              makeExternalSet({ passedCount: 7, totalCount: 10 }),
            ]}
          />,
          { wrapper: Wrapper },
        );

        const items = screen.getAllByTestId("external-set-list-item");
        expect(
          within(items[0]!).getByTestId("status-icon-fail"),
        ).toBeInTheDocument();
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

        expect(screen.getByText("nightly-regression")).toBeInTheDocument();
      });
    });
  });

  describe("search filtering across suites and external sets", () => {
    const suites = [
      makeSuite({ id: "suite_1", name: "Billing Tests", slug: "billing-tests" }),
    ];
    const externalSets = [
      makeExternalSet({ scenarioSetId: "billing-ci" }),
    ];

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
        expect(screen.getByText("No matching suites")).toBeInTheDocument();
      });
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

      render(
        <SuiteSidebar
          {...defaultProps}
          externalSets={externalSets}
        />,
        { wrapper: Wrapper },
      );

      const items = screen.getAllByTestId("external-set-list-item");
      expect(items[0]!.textContent).toContain("recent-set");
      expect(items[1]!.textContent).toContain("old-set");
    });
  });
});
