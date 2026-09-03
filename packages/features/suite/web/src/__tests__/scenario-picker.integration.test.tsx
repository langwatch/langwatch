/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioPicker's archived scenarios section.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PICKER_UNFILED_GROUP_NAME,
  ScenarioPicker,
  type ScenarioPickerProps,
} from "../scenario-picker";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderPicker(overrides: Partial<ScenarioPickerProps> = {}) {
  const defaultProps: ScenarioPickerProps = {
    scenarios: [{ id: "scen_1", name: "Active scenario", labels: [] }],
    selectedIds: ["scen_1"],
    totalCount: 1,
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    allLabels: [],
    activeLabelFilter: null,
    onLabelFilterChange: vi.fn(),
    onCreateNew: vi.fn(),
    ...overrides,
  };
  return render(<ScenarioPicker {...defaultProps} />, { wrapper: Wrapper });
}

describe("<ScenarioPicker />", () => {
  afterEach(cleanup);

  describe("given no archived scenario IDs", () => {
    describe("when the picker renders", () => {
      it("does not show the archived-scenarios section", () => {
        renderPicker({ archivedIds: [] });

        expect(
          screen.queryByTestId("archived-scenarios-section"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given archived scenario IDs are present", () => {
    const archivedIds = [
      { id: "scen_old_1", name: "Old Scenario 1" },
      { id: "scen_old_2", name: "Old Scenario 2" },
    ];

    describe("when the picker renders", () => {
      it("shows the archived-scenarios warning section", () => {
        renderPicker({ archivedIds });

        expect(screen.getByTestId("archived-scenarios-section")).toBeInTheDocument();
        expect(screen.getByText("2 archived scenarios linked:")).toBeInTheDocument();
      });

      it("displays each archived scenario name", () => {
        renderPicker({ archivedIds });

        expect(screen.getByText("Old Scenario 1")).toBeInTheDocument();
        expect(screen.getByText("Old Scenario 2")).toBeInTheDocument();
      });

      it("renders a Remove button for each archived scenario", () => {
        renderPicker({
          archivedIds: [{ id: "scen_old_1", name: "Old Scenario 1" }],
          onRemoveArchived: vi.fn(),
        });

        expect(
          screen.getByTestId("remove-archived-scenario-scen_old_1"),
        ).toBeInTheDocument();
      });
    });

    describe("when the Remove button is clicked", () => {
      it("calls onRemoveArchived with the correct ID", async () => {
        const onRemove = vi.fn();
        const user = userEvent.setup();

        renderPicker({
          archivedIds,
          onRemoveArchived: onRemove,
        });

        await user.click(screen.getByTestId("remove-archived-scenario-scen_old_1"));

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith("scen_old_1");
      });
    });
  });

  describe("given a single archived scenario", () => {
    describe("when the picker renders", () => {
      it("uses singular text for the warning", () => {
        renderPicker({
          archivedIds: [{ id: "scen_old_1", name: "scen_old_1" }],
        });

        expect(screen.getByText("1 archived scenario linked:")).toBeInTheDocument();
      });
    });
  });

  describe("given the inline Add Scenario button", () => {
    describe("when the picker renders", () => {
      it("displays an Add Scenario button inline with the search input", () => {
        renderPicker();

        expect(screen.getByRole("button", { name: "Add Scenario" })).toBeInTheDocument();
      });

      it("displays a plus icon on the Add Scenario button", () => {
        renderPicker();

        const button = screen.getByTestId("add-scenario-button");
        expect(button.querySelector("svg")).not.toBeNull();
      });

      it("does not display the old Create New Scenario button at the bottom", () => {
        renderPicker();

        expect(screen.queryByText("Create New Scenario")).not.toBeInTheDocument();
      });
    });

    describe("when the Add Scenario button is clicked", () => {
      it("calls onCreateNew", async () => {
        const onCreateNew = vi.fn();
        const user = userEvent.setup();

        renderPicker({ onCreateNew });

        await user.click(screen.getByRole("button", { name: "Add Scenario" }));

        expect(onCreateNew).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given scenarios grouped by test suite", () => {
    const groupedProps: Partial<ScenarioPickerProps> = {
      scenarios: [
        { id: "case_1", name: "Double charge", labels: [], testSuiteId: "f_1" },
        { id: "case_2", name: "Late refund", labels: [], testSuiteId: "f_1" },
        { id: "case_3", name: "Card declined", labels: [], testSuiteId: "f_2" },
        { id: "case_4", name: "Login flow", labels: [], testSuiteId: "f_2" },
      ],
      selectedIds: [],
      totalCount: 4,
    };

    describe("when the picker renders with test suites", () => {
      /** @scenario "A run plan can select single scenarios grouped by their test suite" */
      it("lists the scenarios under their suite names and saves the ones picked", async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderPicker({
          ...groupedProps,
          onToggle,
          testSuites: [
            { id: "f_1", name: "Refunds" },
            { id: "f_2", name: "Checkout" },
          ],
        });

        expect(screen.getByText("Refunds")).toBeInTheDocument();
        expect(screen.getByText("Checkout")).toBeInTheDocument();

        await user.click(screen.getByText("Double charge"));
        await user.click(screen.getByText("Card declined"));

        expect(onToggle).toHaveBeenNthCalledWith(1, "case_1");
        expect(onToggle).toHaveBeenNthCalledWith(2, "case_3");
      });
    });

    describe("when the project uses no test suite", () => {
      it("keeps the flat list", () => {
        renderPicker({ ...groupedProps, testSuites: [] });

        expect(
          screen.queryByText(PICKER_UNFILED_GROUP_NAME),
        ).not.toBeInTheDocument();
        expect(screen.getByText("Double charge")).toBeInTheDocument();
      });
    });
  });
});
