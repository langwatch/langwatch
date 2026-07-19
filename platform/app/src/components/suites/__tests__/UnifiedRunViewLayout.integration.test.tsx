/**
 * @vitest-environment jsdom
 *
 * Integration tests for unified group-by and list/grid view across all run views.
 *
 * Tests that RunHistoryFilters renders the correct group-by options based on
 * the view context, and that external set and all-runs views use the shared
 * filter bar with group-by and view toggle.
 *
 * @see specs/features/suites/unified-run-view-layout.feature - @integration scenarios
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "../RunHistoryFilters";
import type { RunGroupType } from "../run-history-transforms";
import { availableGroupByOptions } from "../run-history-transforms";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const emptyFilters: RunHistoryFilterValues = {
  scenarioId: "",
  passFailStatus: "",
};

const scenarioOptions = [
  { id: "scen_1", name: "Login" },
  { id: "scen_2", name: "Signup" },
];

describe("Unified run view layout", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when viewing an external set detail panel", () => {
    it("renders group-by selector with only None and Scenario options", () => {
      const options = availableGroupByOptions({ viewContext: "external" });

      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario"]);
    });

    it("does not render a Target option", () => {
      const options = availableGroupByOptions({ viewContext: "external" });

      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionValues = renderedOptions.map(
        (o) => (o as HTMLOptionElement).value,
      );
      expect(optionValues).not.toContain("target");
    });
  });

  describe("when viewing a suite detail panel with targets", () => {
    it("renders group-by selector with None, Scenario, and Target options", () => {
      const options = availableGroupByOptions({ viewContext: "suite" });

      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });
  });

  describe("when viewing the all runs panel", () => {
    it("renders group-by selector with None, Scenario, and Target options", () => {
      const options = availableGroupByOptions({ viewContext: "all-runs" });

      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });
  });

  describe("when groupByOptions is not provided", () => {
    it("defaults to all options for backward compatibility", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });
  });

  describe("when the filter bar renders across any view", () => {
    it("contains scenario filter, pass/fail filter, group-by, and view toggle", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          viewMode="grid"
          onViewModeChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByLabelText("Filter by scenario")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Filter by pass/fail status"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Group by")).toBeInTheDocument();
      expect(screen.getByLabelText("List view")).toBeInTheDocument();
      expect(screen.getByLabelText("Grid view")).toBeInTheDocument();
    });
  });
});
