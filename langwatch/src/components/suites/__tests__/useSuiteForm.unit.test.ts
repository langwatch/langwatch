/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useSuiteForm hook.
 *
 * Tests validation logic, toggle actions, filtering, and form data shape.
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
  agents: [{ id: "agent_1", name: "Prod Agent", type: "http" }],
  prompts: [{ id: "prompt_1", handle: "test-prompt" }],
};

describe("useSuiteForm()", () => {
  describe("given a fresh form in create mode", () => {
    describe("when validation is triggered with empty fields", () => {
      it("produces a name error", async () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        let capturedErrors: Record<string, { message?: string }> = {};
        await act(async () => {
          await result.current.form.handleSubmit(
            () => {},
            (errors) => {
              capturedErrors = errors;
            },
          )();
        });

        expect(capturedErrors.name?.message).toBe("Name is required");
      });

      it("produces a scenarios error when no scenarios selected", async () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.form.setValue("name", "Test Suite");
        });

        let capturedErrors: Record<string, { message?: string }> = {};
        await act(async () => {
          await result.current.form.handleSubmit(
            () => {},
            (errors) => {
              capturedErrors = errors;
            },
          )();
        });

        expect(capturedErrors.selectedScenarioIds?.message).toBe(
          "At least one scenario is required",
        );
      });

      it("produces a targets error when no targets selected", async () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.form.setValue("name", "Test Suite");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });

        let capturedErrors: Record<string, { message?: string }> = {};
        await act(async () => {
          await result.current.form.handleSubmit(
            () => {},
            (errors) => {
              capturedErrors = errors;
            },
          )();
        });

        expect(capturedErrors.selectedTargets?.message).toBe(
          "At least one target is required",
        );
      });
    });

    describe("when validation is triggered with all required fields filled", () => {
      it("produces no errors", async () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.form.setValue("name", "Test Suite");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });
        act(() => {
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
        });

        let submitCalled = false;
        await act(async () => {
          await result.current.form.handleSubmit(
            () => {
              submitCalled = true;
            },
            () => {},
          )();
        });

        expect(submitCalled).toBe(true);
        expect(result.current.form.formState.errors).toEqual({});
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
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
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
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
        });
        act(() => {
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
        });

        expect(result.current.selectedTargets).toEqual([]);
        expect(result.current.isTargetSelected("http", "agent_1")).toBe(false);
      });
    });

    describe("when selectAllTargets is called", () => {
      it("selects all filtered targets", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.selectAllTargets();
        });

        expect(result.current.selectedTargets).toEqual([
          { type: "http", referenceId: "agent_1" },
          { type: "prompt", referenceId: "prompt_1" },
        ]);
      });
    });

    describe("when selectAllTargets is called with existing selections", () => {
      it("merges without duplicates", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
        });
        act(() => {
          result.current.selectAllTargets();
        });

        expect(result.current.selectedTargets).toEqual([
          { type: "http", referenceId: "agent_1" },
          { type: "prompt", referenceId: "prompt_1" },
        ]);
      });
    });

    describe("when selectAllTargets is called with a search filter active", () => {
      it("selects only filtered targets", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.setTargetSearch("prod");
        });
        act(() => {
          result.current.selectAllTargets();
        });

        expect(result.current.selectedTargets).toEqual([
          { type: "http", referenceId: "agent_1" },
        ]);
      });
    });

    describe("when clearTargets is called", () => {
      it("removes all selected targets", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.selectAllTargets();
        });
        act(() => {
          result.current.clearTargets();
        });

        expect(result.current.selectedTargets).toEqual([]);
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

  describe("given form data via getValues", () => {
    describe("when form fields are populated", () => {
      it("returns correctly shaped form data", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.form.setValue("name", "  My Suite  ");
        });
        act(() => {
          result.current.form.setValue("description", "  Suite description  ");
        });
        act(() => {
          result.current.toggleScenario("scen_1");
        });
        act(() => {
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
        });

        const data = result.current.form.getValues();

        expect(data).toEqual({
          name: "  My Suite  ",
          description: "  Suite description  ",
          selectedScenarioIds: ["scen_1"],
          selectedTargets: [{ type: "http", referenceId: "agent_1" }],
          repeatCount: 1,
          labels: [],
        });
      });
    });

    describe("when repeatCount is set to a custom value", () => {
      it("stores repeatCount as a number", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.form.setValue("name", "Suite");
        });
        act(() => {
          result.current.form.setValue("repeatCount", 5);
        });

        expect(result.current.form.getValues("repeatCount")).toBe(5);
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

    describe("when a code agent is provided", () => {
      it("maps it with type 'code' instead of 'http'", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            agents: [
              { id: "agent_1", name: "Prod Agent", type: "http" },
              { id: "agent_2", name: "Code Agent", type: "code" },
            ],
          }),
        );

        expect(result.current.availableTargets).toEqual([
          { name: "Prod Agent", type: "http", referenceId: "agent_1" },
          { name: "Code Agent", type: "code", referenceId: "agent_2" },
          { name: "test-prompt", type: "prompt", referenceId: "prompt_1" },
        ]);
      });
    });

    describe("when an unsupported agent type is provided", () => {
      it("includes workflow agents and excludes unsupported types from available targets", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            agents: [
              { id: "agent_1", name: "HTTP Agent", type: "http" },
              { id: "agent_2", name: "Workflow Agent", type: "workflow" },
              { id: "agent_3", name: "Signature Agent", type: "signature" },
            ],
          }),
        );

        expect(result.current.availableTargets).toEqual([
          { name: "HTTP Agent", type: "http", referenceId: "agent_1" },
          { name: "Workflow Agent", type: "workflow", referenceId: "agent_2" },
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
      it("returns empty archivedTargets", () => {
        const { result } = renderHook(() => useSuiteForm(baseParams));

        act(() => {
          result.current.toggleTarget({
            type: "http",
            referenceId: "agent_1",
          });
        });

        expect(result.current.archivedTargets).toEqual([]);
      });
    });

    describe("when a selected target is not in available targets", () => {
      it("returns the archived target with type info", () => {
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

        expect(result.current.archivedTargets).toEqual([
          { type: "prompt", referenceId: "prompt_deleted", name: "prompt_deleted" },
        ]);
      });
    });

    describe("when only agents have loaded but prompts have not", () => {
      it("returns empty archivedTargets to avoid false positives", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            agents: [{ id: "agent_1", name: "Prod Agent", type: "http" }],
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

        expect(result.current.archivedTargets).toEqual([]);
      });
    });

    describe("when agents and prompts have not loaded yet", () => {
      it("returns empty archivedTargets", () => {
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

        expect(result.current.archivedTargets).toEqual([]);
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

  describe("given archived scenario detection", () => {
    describe("when selected scenario IDs include IDs not in the active scenarios list", () => {
      it("returns those IDs as archivedScenarioIds", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            suite: {
              id: "suite_1",
              projectId: "proj_1",
              name: "Test",
              slug: "test",
              description: null,
              scenarioIds: ["scen_1", "scen_archived_1", "scen_archived_2"],
              targets: [{ type: "http", referenceId: "agent_1" }],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        expect(result.current.archivedScenarioIds).toEqual([
          { id: "scen_archived_1", name: "scen_archived_1" },
          { id: "scen_archived_2", name: "scen_archived_2" },
        ]);
      });
    });

    describe("when all selected scenario IDs are in the active scenarios list", () => {
      it("returns empty archivedScenarioIds", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            suite: {
              id: "suite_1",
              projectId: "proj_1",
              name: "Test",
              slug: "test",
              description: null,
              scenarioIds: ["scen_1", "scen_2"],
              targets: [{ type: "http", referenceId: "agent_1" }],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        expect(result.current.archivedScenarioIds).toEqual([]);
      });
    });

    describe("when scenarios have not loaded yet", () => {
      it("returns empty archivedScenarioIds", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            scenarios: undefined,
          }),
        );

        act(() => {
          result.current.toggleScenario("scen_1");
        });

        expect(result.current.archivedScenarioIds).toEqual([]);
      });
    });
  });

  describe("given removeArchivedScenario", () => {
    describe("when called with an archived scenario ID", () => {
      it("removes the ID from selectedScenarioIds", () => {
        const { result } = renderHook(() =>
          useSuiteForm({
            ...baseParams,
            suite: {
              id: "suite_1",
              projectId: "proj_1",
              name: "Test",
              slug: "test",
              description: null,
              scenarioIds: ["scen_1", "scen_archived"],
              targets: [{ type: "http", referenceId: "agent_1" }],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        expect(result.current.selectedScenarioIds).toContain("scen_archived");

        act(() => {
          result.current.removeArchivedScenario("scen_archived");
        });

        expect(result.current.selectedScenarioIds).not.toContain("scen_archived");
        expect(result.current.selectedScenarioIds).toContain("scen_1");
      });
    });
  });

  describe("given removeArchivedTarget", () => {
    describe("when called with an archived target", () => {
      it("removes the matching target from selectedTargets", () => {
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
                { type: "http", referenceId: "agent_1" },
                { type: "prompt", referenceId: "prompt_deleted" },
              ],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        expect(result.current.selectedTargets).toHaveLength(2);

        act(() => {
          result.current.removeArchivedTarget({
            type: "prompt",
            referenceId: "prompt_deleted",
          });
        });

        expect(result.current.selectedTargets).toEqual([
          { type: "http", referenceId: "agent_1" },
        ]);
      });
    });

    describe("when called with a target matching referenceId but different type", () => {
      it("does not remove the non-matching target", () => {
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
                { type: "http", referenceId: "shared_id" },
              ],
              repeatCount: 1,
              labels: [],
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        );

        act(() => {
          result.current.removeArchivedTarget({
            type: "prompt",
            referenceId: "shared_id",
          });
        });

        expect(result.current.selectedTargets).toEqual([
          { type: "http", referenceId: "shared_id" },
        ]);
      });
    });
  });
});
