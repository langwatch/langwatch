/**
 * Unified run view layout with group-by and view toggle.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { availableGroupByOptions } from "../../../model/run-history-transforms.ts";
import { RunHistoryFilters, type RunHistoryFilterValues } from "../run-history-filters.tsx";

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
    let renderedOptions: HTMLElement[];

    beforeEach(() => {
      const options = availableGroupByOptions({ viewContext: "external" });

      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
      );

      const selector = screen.getByLabelText("Group by");
      renderedOptions = within(selector).getAllByRole("option");
    });

    it("renders group-by selector with only None and Scenario options", () => {
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario"]);
    });

    it("does not render a Target option", () => {
      const optionValues = renderedOptions.map((o) => (o as HTMLOptionElement).value);
      expect(optionValues).not.toContain("target");
    });
  });

  describe("when viewing a suite detail panel with targets", () => {
    it("renders group-by selector with None, Scenario, and Target options", () => {
      const options = availableGroupByOptions({ viewContext: "suite" });

      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
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

      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          groupByOptions={options}
        />,
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });
  });

  describe("when groupByOptions is not provided", () => {
    it("defaults to all options for backward compatibility", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
      );

      const selector = screen.getByLabelText("Group by");
      const renderedOptions = within(selector).getAllByRole("option");
      const optionTexts = renderedOptions.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });
  });

  describe("when the filter bar renders across any view", () => {
    it("contains scenario filter, pass/fail filter, group-by, and view toggle", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
          viewMode="grid"
          onViewModeChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("Filter by scenario")).toBeInTheDocument();
      expect(screen.getByLabelText("Filter by pass/fail status")).toBeInTheDocument();
      expect(screen.getByLabelText("Group by")).toBeInTheDocument();
      expect(screen.getByLabelText("List view")).toBeInTheDocument();
      expect(screen.getByLabelText("Grid view")).toBeInTheDocument();
    });
  });
});
