/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useSuiteForm hook.
 *
 * Tests validation logic, toggle actions, filtering, and buildFormData.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSuiteForm } from "../useSuiteForm";

const baseParams = {
  suite: null,
  isOpen: true,
  suiteId: undefined,
  scenarios: [
    { id: "scen_1", name: "Angry refund request", labels: ["billing"] },
    { id: "scen_2", name: "Policy violation", labels: ["safety"] },
    { id: "scen_3", name: "Happy path checkout", labels: ["billing"] },
  ],
  agents: [{ id: "agent_1", name: "Prod Agent" }],
  prompts: [{ id: "prompt_1", handle: "test-prompt" }],
};

describe("useSuiteForm()", () => {
  describe("given a fresh form in create mode", () => {
    describe("when validate is called with empty fields", () => {
      it("returns false and sets name error", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        let isValid: boolean;
        act(() => {
          isValid = result.current.validate();
        });

        expect(isValid!).toBe(false);
        expect(result.current.errors.name).toBe("Name is required");
      });

      it("sets scenarios error when no scenarios selected", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setName("Test Suite");
        });

        act(() => {
          result.current.validate();
        });

        expect(result.current.errors.scenarios).toBe(
          "At least one scenario is required",
        );
      });

      it("sets targets error when no targets selected", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setName("Test Suite");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });

        act(() => {
          result.current.validate();
        });

        expect(result.current.errors.targets).toBe(
          "At least one target is required",
        );
      });
    });

    describe("when validate is called with all required fields filled", () => {
      it("returns true with no errors", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setName("Test Suite");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });
        act(() => {
          result.current.toggleTarget({ type: "http", referenceId: "agent_1" });
        });

        let isValid: boolean;
        act(() => {
          isValid = result.current.validate();
        });

        expect(isValid!).toBe(true);
        expect(Object.keys(result.current.errors)).toHaveLength(0);
      });
    });
  });

  describe("given scenario toggling", () => {
    describe("when toggleScenario is called with a new id", () => {
      it("adds the id to selectedScenarioIds", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleScenario("scen_1");
        });

        expect(result.current.selectedScenarioIds).toEqual(["scen_1"]);
      });
    });

    describe("when toggleScenario is called with an already-selected id", () => {
      it("removes the id from selectedScenarioIds", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleScenario("scen_1");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });

        expect(result.current.selectedScenarioIds).toEqual([]);
      });
    });

    describe("when selectAllScenarios is called", () => {
      it("selects all filtered scenario ids", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.selectAllScenarios();
        });

        expect(result.current.selectedScenarioIds).toEqual([
          "scen_1",
          "scen_2",
          "scen_3",
        ]);
      });
    });

    describe("when clearScenarios is called", () => {
      it("empties selectedScenarioIds", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.selectAllScenarios();
        });
        act(() => {
          result.current.clearScenarios();
        });

        expect(result.current.selectedScenarioIds).toEqual([]);
      });
    });
  });

  describe("given target toggling", () => {
    describe("when toggleTarget is called with a new target", () => {
      it("adds it to selectedTargets", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleTarget({ type: "http", referenceId: "agent_1" });
        });

        expect(result.current.selectedTargets).toEqual([
          { type: "http", referenceId: "agent_1" },
        ]);
        expect(result.current.isTargetSelected("http", "agent_1")).toBe(true);
      });
    });

    describe("when toggleTarget is called with an already-selected target", () => {
      it("removes it from selectedTargets", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleTarget({ type: "http", referenceId: "agent_1" });
        });
        act(() => {
          result.current.toggleTarget({ type: "http", referenceId: "agent_1" });
        });

        expect(result.current.selectedTargets).toEqual([]);
        expect(result.current.isTargetSelected("http", "agent_1")).toBe(false);
      });
    });
  });

  describe("given scenario search filtering", () => {
    describe("when scenarioSearch is set", () => {
      it("filters scenarios by name (case-insensitive)", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setScenarioSearch("angry");
        });

        expect(result.current.filteredScenarios).toEqual([
          { id: "scen_1", name: "Angry refund request", labels: ["billing"] },
        ]);
      });
    });

    describe("when activeLabelFilter is set", () => {
      it("filters scenarios by label", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setActiveLabelFilter("safety");
        });

        expect(result.current.filteredScenarios).toHaveLength(1);
        expect(result.current.filteredScenarios[0]!.id).toBe("scen_2");
      });
    });
  });

  describe("given target search filtering", () => {
    describe("when targetSearch is set", () => {
      it("filters targets by name (case-insensitive)", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setTargetSearch("prod");
        });

        expect(result.current.filteredTargets).toHaveLength(1);
        expect(result.current.filteredTargets[0]!.name).toBe("Prod Agent");
      });
    });
  });

  describe("given buildFormData", () => {
    describe("when called with valid state", () => {
      it("returns correctly shaped form data", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setName("  My Suite  ");
        });
        act(() => {
          result.current.setDescription("  Suite description  ");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });
        act(() => {
          result.current.toggleTarget({ type: "http", referenceId: "agent_1" });
        });

        const data = result.current.buildFormData({ projectId: "proj_1" });

        expect(data).toEqual({
          projectId: "proj_1",
          name: "My Suite",
          description: "Suite description",
          scenarioIds: ["scen_1"],
          targets: [{ type: "http", referenceId: "agent_1" }],
          repeatCount: 1,
          labels: [],
        });
      });
    });

    describe("when repeatCountStr is set to a custom value", () => {
      it("parses repeatCount as a number with minimum of 1", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setName("Suite");
        });
        act(() => {
          result.current.setRepeatCountStr("5");
        });

        const data = result.current.buildFormData({ projectId: "proj_1" });
        expect(data.repeatCount).toBe(5);
      });
    });

    describe("when repeatCountStr is invalid", () => {
      it("defaults repeatCount to 1", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setName("Suite");
        });
        act(() => {
          result.current.setRepeatCountStr("abc");
        });

        const data = result.current.buildFormData({ projectId: "proj_1" });
        expect(data.repeatCount).toBe(1);
      });
    });
  });

  describe("given label management", () => {
    describe("when addLabel is called with a new label", () => {
      it("adds the label", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.addLabel("regression");
        });

        expect(result.current.labels).toEqual(["regression"]);
      });
    });

    describe("when addLabel is called with a duplicate label", () => {
      it("does not add the duplicate", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.addLabel("regression");
        });
        act(() => {
          result.current.addLabel("regression");
        });

        expect(result.current.labels).toEqual(["regression"]);
      });
    });

    describe("when removeLabel is called", () => {
      it("removes the specified label", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.addLabel("regression");
        });
        act(() => {
          result.current.addLabel("smoke");
        });
        act(() => {
          result.current.removeLabel("regression");
        });

        expect(result.current.labels).toEqual(["smoke"]);
      });
    });
  });

  describe("given available targets derivation", () => {
    describe("when agents and prompts are provided", () => {
      it("combines them into availableTargets with correct types", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        expect(result.current.availableTargets).toEqual([
          { name: "Prod Agent", type: "http", referenceId: "agent_1" },
          { name: "test-prompt", type: "prompt", referenceId: "prompt_1" },
        ]);
      });
    });

    describe("when a prompt has no handle", () => {
      it("falls back to prompt id as the name", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            prompts: [{ id: "prompt_2", handle: null }],
          }),
        );

        const promptTarget = result.current.availableTargets.find(
          (t) => t.referenceId === "prompt_2",
        );
        expect(promptTarget!.name).toBe("prompt_2");
      });
    });
  });

  describe("given stale target detection", () => {
    describe("when selected targets all exist in available targets", () => {
      it("returns empty staleTargetIds", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleTarget({ type: "http", referenceId: "agent_1" });
        });

        expect(result.current.staleTargetIds).toEqual([]);
      });
    });

    describe("when a selected target is not in available targets", () => {
      it("returns the stale referenceId", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            suite: {
              id: "suite_1",
              projectId: "proj_1",
              name: "Test",
              slug: "test",
              description: null,
              scenarioIds: ["scen_1"],
              targets: [
                { type: "prompt", referenceId: "prompt_deleted" },
                { type: "http", referenceId: "agent_1" },
              ],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        expect(result.current.staleTargetIds).toEqual(["prompt_deleted"]);
      });
    });

    describe("when agents and prompts have not loaded yet", () => {
      it("returns empty staleTargetIds", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            agents: undefined,
            prompts: undefined,
            suite: {
              id: "suite_1",
              projectId: "proj_1",
              name: "Test",
              slug: "test",
              description: null,
              scenarioIds: ["scen_1"],
              targets: [{ type: "prompt", referenceId: "prompt_1" }],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        expect(result.current.staleTargetIds).toEqual([]);
      });
    });
  });

  describe("given allLabels derivation", () => {
    describe("when scenarios have labels", () => {
      it("returns unique sorted labels", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        expect(result.current.allLabels).toEqual(["billing", "safety"]);
      });
    });
  });
});
