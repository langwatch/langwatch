import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNewScenarioFlow } from "../src/use-new-scenario-flow";
import { useScenarioLabelFilter } from "../src/use-scenario-label-filter";
import { useScenarioSelection } from "../src/use-scenario-selection";

describe("Scenario web hooks", () => {
  it("collects sorted labels and toggles only the labels filter", () => {
    const { result } = renderHook(() =>
      useScenarioLabelFilter([
        { labels: ["zebra", "alpha"] },
        { labels: ["alpha", "beta"] },
      ]),
    );

    expect(result.current.allLabels).toEqual(["alpha", "beta", "zebra"]);

    act(() => result.current.handleLabelToggle("alpha"));
    expect(result.current.activeLabels).toEqual(["alpha"]);

    act(() => result.current.handleLabelToggle("alpha"));
    expect(result.current.columnFilters).toEqual([]);
  });

  it("selects, deselects, and reports scenario rows by id", () => {
    const { result } = renderHook(() => useScenarioSelection());

    act(() => result.current.selectAll(["scenario-1", "scenario-2"]));
    expect(result.current.selectedIds).toEqual(["scenario-1", "scenario-2"]);
    expect(result.current.selectionCount).toBe(2);

    act(() => result.current.toggle("scenario-1"));
    expect(result.current.selectedIds).toEqual(["scenario-2"]);

    act(() => result.current.deselectAll());
    expect(result.current.selectedIds).toEqual([]);
  });

  it("shows the first-run welcome before opening the create flow", () => {
    window.localStorage.clear();
    const { result } = renderHook(() =>
      useNewScenarioFlow({ scenarioCount: 0, isLoading: false }),
    );

    expect(result.current.showInlineWelcome).toBe(true);

    act(() => result.current.handleNewScenario());
    expect(result.current.showWelcomeModal).toBe(true);

    act(() => result.current.handleWelcomeProceed());
    expect(result.current.showWelcomeModal).toBe(false);
    expect(result.current.showCreateModal).toBe(true);
    expect(window.localStorage.getItem("langwatch:scenarios:welcomeSeen")).toBe("true");
  });
});
