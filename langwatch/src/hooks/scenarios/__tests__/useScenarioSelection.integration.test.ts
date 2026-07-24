/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScenarioSelection } from "../useScenarioSelection";

describe("useScenarioSelection()", () => {
  describe("toggle()", () => {
    describe("given no scenarios are selected", () => {
      it("adds the scenario to the selected set", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });

        expect(result.current.selectedIds).toContain("scen_1");
      });
    });

    describe("given a scenario is already selected", () => {
      it("removes the scenario from the selected set", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });
        act(() => {
          result.current.toggle("scen_1");
        });

        expect(result.current.selectedIds).not.toContain("scen_1");
      });
    });

    describe("given multiple scenarios are toggled", () => {
      it("tracks each independently", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });
        act(() => {
          result.current.toggle("scen_2");
        });

        expect(result.current.selectedIds).toContain("scen_1");
        expect(result.current.selectedIds).toContain("scen_2");
      });
    });
  });

  describe("selectAll()", () => {
    describe("given 5 visible scenario IDs and none selected", () => {
      it("adds all visible IDs to the selected set", () => {
        const { result } = renderHook(() => useScenarioSelection());
        const visibleIds = ["scen_1", "scen_2", "scen_3", "scen_4", "scen_5"];

        act(() => {
          result.current.selectAll(visibleIds);
        });

        expect(result.current.selectedIds).toEqual(
          expect.arrayContaining(visibleIds)
        );
        expect(result.current.selectionCount).toBe(5);
      });
    });

    describe("given some scenarios are already selected", () => {
      it("merges with existing selection", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_existing");
        });
        act(() => {
          result.current.selectAll(["scen_1", "scen_2"]);
        });

        expect(result.current.selectedIds).toContain("scen_existing");
        expect(result.current.selectedIds).toContain("scen_1");
        expect(result.current.selectedIds).toContain("scen_2");
      });
    });
  });

  describe("deselectAll()", () => {
    describe("given 3 scenarios are selected", () => {
      it("clears the selected set", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });
        act(() => {
          result.current.toggle("scen_2");
        });
        act(() => {
          result.current.toggle("scen_3");
        });
        act(() => {
          result.current.deselectAll();
        });

        expect(result.current.selectedIds).toEqual([]);
        expect(result.current.selectionCount).toBe(0);
      });
    });
  });

  describe("selectedIds", () => {
    describe("when no scenarios are selected", () => {
      it("returns an empty array", () => {
        const { result } = renderHook(() => useScenarioSelection());

        expect(result.current.selectedIds).toEqual([]);
      });
    });

    describe("when scenarios are selected", () => {
      it("returns the selected IDs as an array", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });
        act(() => {
          result.current.toggle("scen_2");
        });

        expect(result.current.selectedIds).toHaveLength(2);
        expect(result.current.selectedIds).toContain("scen_1");
        expect(result.current.selectedIds).toContain("scen_2");
      });
    });
  });

  describe("selectionCount", () => {
    describe("when 2 scenarios are selected", () => {
      it("returns 2", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });
        act(() => {
          result.current.toggle("scen_2");
        });

        expect(result.current.selectionCount).toBe(2);
      });
    });

    describe("when no scenarios are selected", () => {
      it("returns 0", () => {
        const { result } = renderHook(() => useScenarioSelection());

        expect(result.current.selectionCount).toBe(0);
      });
    });
  });

  describe("rowSelection (TanStack Table compatibility)", () => {
    describe("when scenarios are selected", () => {
      it("exposes rowSelection as Record<string, boolean>", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.toggle("scen_1");
        });
        act(() => {
          result.current.toggle("scen_2");
        });

        expect(result.current.rowSelection).toEqual({
          scen_1: true,
          scen_2: true,
        });
      });
    });

    describe("when no scenarios are selected", () => {
      it("exposes rowSelection as an empty object", () => {
        const { result } = renderHook(() => useScenarioSelection());

        expect(result.current.rowSelection).toEqual({});
      });
    });

    describe("when onRowSelectionChange is called with updater function", () => {
      it("updates the selection state", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.onRowSelectionChange(() => ({
            scen_3: true,
            scen_4: true,
          }));
        });

        expect(result.current.selectedIds).toContain("scen_3");
        expect(result.current.selectedIds).toContain("scen_4");
        expect(result.current.selectionCount).toBe(2);
      });
    });

    describe("when onRowSelectionChange is called with direct value", () => {
      it("sets the selection state", () => {
        const { result } = renderHook(() => useScenarioSelection());

        act(() => {
          result.current.onRowSelectionChange({
            scen_5: true,
          });
        });

        expect(result.current.selectedIds).toContain("scen_5");
        expect(result.current.selectionCount).toBe(1);
      });
    });
  });
});
