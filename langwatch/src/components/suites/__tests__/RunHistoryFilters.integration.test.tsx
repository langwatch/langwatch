/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunHistoryFilters component.
 *
 * Tests filter dropdown interactions for scenario and pass/fail status filtering.
 *
 * @see specs/suites/suite-workflow.feature - "Run History -- Filters"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "../RunHistoryFilters";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const scenarioOptions = [
  { id: "scen_1", name: "Angry refund request" },
  { id: "scen_2", name: "Policy violation" },
  { id: "scen_3", name: "Edge: empty cart" },
];

const emptyFilters: RunHistoryFilterValues = {
  scenarioId: "",
  passFailStatus: "",
};

describe("<RunHistoryFilters/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given scenario and pass/fail filter dropdowns", () => {
    it("renders both filter dropdowns", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByLabelText("Filter by scenario"),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Filter by pass/fail status"),
      ).toBeInTheDocument();
    });

    describe("when a scenario is selected from the Scenario filter", () => {
      it("calls onFiltersChange with the selected scenarioId", async () => {
        const user = userEvent.setup();
        const onFiltersChange = vi.fn();

        render(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={onFiltersChange}
          />,
          { wrapper: Wrapper },
        );

        const scenarioSelect = screen.getByLabelText("Filter by scenario");
        await user.selectOptions(scenarioSelect, "scen_1");

        expect(onFiltersChange).toHaveBeenCalledWith({
          ...emptyFilters,
          scenarioId: "scen_1",
        });
      });
    });

    describe("when Fail is selected from the Pass/Fail filter", () => {
      it("calls onFiltersChange with passFailStatus set to fail", async () => {
        const user = userEvent.setup();
        const onFiltersChange = vi.fn();

        render(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={onFiltersChange}
          />,
          { wrapper: Wrapper },
        );

        const statusSelect = screen.getByLabelText(
          "Filter by pass/fail status",
        );
        await user.selectOptions(statusSelect, "fail");

        expect(onFiltersChange).toHaveBeenCalledWith({
          ...emptyFilters,
          passFailStatus: "fail",
        });
      });
    });

    describe("when Pass is selected from the Pass/Fail filter", () => {
      it("calls onFiltersChange with passFailStatus set to pass", async () => {
        const user = userEvent.setup();
        const onFiltersChange = vi.fn();

        render(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={onFiltersChange}
          />,
          { wrapper: Wrapper },
        );

        const statusSelect = screen.getByLabelText(
          "Filter by pass/fail status",
        );
        await user.selectOptions(statusSelect, "pass");

        expect(onFiltersChange).toHaveBeenCalledWith({
          ...emptyFilters,
          passFailStatus: "pass",
        });
      });
    });

    describe("when filters are already active", () => {
      it("preserves other filters when changing one", async () => {
        const user = userEvent.setup();
        const onFiltersChange = vi.fn();
        const activeFilters: RunHistoryFilterValues = {
          scenarioId: "scen_1",
          passFailStatus: "",
        };

        render(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={activeFilters}
            onFiltersChange={onFiltersChange}
          />,
          { wrapper: Wrapper },
        );

        const statusSelect = screen.getByLabelText(
          "Filter by pass/fail status",
        );
        await user.selectOptions(statusSelect, "fail");

        expect(onFiltersChange).toHaveBeenCalledWith({
          scenarioId: "scen_1",
          passFailStatus: "fail",
        });
      });
    });
  });
});
