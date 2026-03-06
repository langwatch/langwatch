/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioPicker's archived scenarios section.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioPicker, type ScenarioPickerProps } from "../ScenarioPicker";

vi.mock("../ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange?: (details: { checked: boolean }) => void; children: React.ReactNode }) => (
    <label>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={() => onCheckedChange?.({ checked: !checked })}
      />
      {children}
    </label>
  ),
}));

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

        expect(
          screen.getByTestId("archived-scenarios-section"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("2 archived scenarios linked:"),
        ).toBeInTheDocument();
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

        await user.click(
          screen.getByTestId("remove-archived-scenario-scen_old_1"),
        );

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith("scen_old_1");
      });
    });
  });

  describe("given a single archived scenario", () => {
    describe("when the picker renders", () => {
      it("uses singular text for the warning", () => {
        renderPicker({ archivedIds: [{ id: "scen_old_1", name: "scen_old_1" }] });

        expect(
          screen.getByText("1 archived scenario linked:"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the inline Add Scenario button", () => {
    describe("when the picker renders", () => {
      it("displays an Add Scenario button inline with the search input", () => {
        renderPicker();

        expect(
          screen.getByRole("button", { name: "Add Scenario" }),
        ).toBeInTheDocument();
      });

      it("displays a plus icon on the Add Scenario button", () => {
        renderPicker();

        const button = screen.getByTestId("add-scenario-button");
        expect(button.querySelector("svg")).not.toBeNull();
      });

      it("does not display the old Create New Scenario button at the bottom", () => {
        renderPicker();

        expect(
          screen.queryByText("Create New Scenario"),
        ).not.toBeInTheDocument();
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
});
