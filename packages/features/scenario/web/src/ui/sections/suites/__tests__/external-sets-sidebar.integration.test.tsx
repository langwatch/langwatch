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
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

// The sidebar mounts VoiceAgentsCallout, which reaches for project context
// and fires tRPC queries this rig does not provide. Same stub the sibling
// suite-sidebar suites use, for the same reason.
vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: vi.fn(() => ({ project: { id: "project_1" } })),
}));

import { SuiteSidebar } from "../suite-sidebar";
import { toExternalSetSelection } from "../../../../behavior/suites/use-suite-routing";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

type SuiteSidebarProps = ComponentProps<typeof SuiteSidebar>;
type Suite = SuiteSidebarProps["suites"][number];
type ExternalSetSummary = NonNullable<SuiteSidebarProps["externalSets"]>[number];

function makeSuite(overrides: Partial<Suite> & Pick<Suite, "name">): Suite {
  return {
    id: "suite_1",
    projectId: "project_1",
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
  } as Suite;
}

function makeExternalSet(overrides: Partial<ExternalSetSummary> = {}): ExternalSetSummary {
  return {
    scenarioSetId: "nightly-regression",
    passedCount: 10,
    failedCount: 0,
    totalCount: 10,
    lastRunTimestamp: Date.now() - 30 * 60 * 1000,
    ...overrides,
  } as ExternalSetSummary;
}

const defaultProps = {
  projectSlug: "my-project",
  suites: [] as Suite[],
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
      render(<SuiteSidebar {...defaultProps} suites={[makeSuite({ name: "Critical Path" })]} />, {
        wrapper: Wrapper,
      });

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

    /** @scenario "External sets section appears with SDK-submitted scenario runs" */
    it("displays the External Sets section header", () => {
      render(<SuiteSidebar {...defaultProps} externalSets={externalSets} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("external-sets-header")).toHaveTextContent("EXTERNAL SETS");
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
            externalSets={[makeExternalSet({ passedCount: 10, totalCount: 10 })]}
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
        expect(onSelectSuite).toHaveBeenCalledWith(toExternalSetSelection("nightly-regression"));
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
        const unselectedItem = listItems.find((item) => within(item).queryByText("ci-smoke-tests"));
        expect(unselectedItem).toBeDefined();
        expect(unselectedItem).not.toHaveAttribute("data-selected");
      });
    });
  });
});
