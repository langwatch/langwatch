import { beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import {
  createInitialState,
  type AgentConfig,
  type EvaluatorConfig,
} from "../types";

describe("useEvaluationsV3Store", () => {
  beforeEach(() => {
    // Reset store before each test
    useEvaluationsV3Store.getState().reset();
  });

  describe("Dataset operations", () => {
    it("sets cell value", () => {
      const store = useEvaluationsV3Store.getState();
      store.setCellValue(0, "input", "Hello world");

      const state = useEvaluationsV3Store.getState();
      expect(state.dataset.records["input"]?.[0]).toBe("Hello world");
    });

    it("expands records array when setting value at higher row index", () => {
      const store = useEvaluationsV3Store.getState();
      store.setCellValue(5, "input", "Value at row 5");

      const state = useEvaluationsV3Store.getState();
      expect(state.dataset.records["input"]?.length).toBe(6);
      expect(state.dataset.records["input"]?.[5]).toBe("Value at row 5");
    });

    it("adds a new column", () => {
      const store = useEvaluationsV3Store.getState();
      store.addColumn({
        id: "context",
        name: "context",
        type: "string",
      });

      const state = useEvaluationsV3Store.getState();
      expect(state.dataset.columns).toHaveLength(3);
      expect(state.dataset.columns[2]?.name).toBe("context");
      expect(state.dataset.records["context"]).toBeDefined();
    });

    it("removes a column", () => {
      const store = useEvaluationsV3Store.getState();
      store.removeColumn("expected_output");

      const state = useEvaluationsV3Store.getState();
      expect(state.dataset.columns).toHaveLength(1);
      expect(state.dataset.records["expected_output"]).toBeUndefined();
    });

    it("renames a column", () => {
      const store = useEvaluationsV3Store.getState();
      store.renameColumn("input", "user_question");

      const state = useEvaluationsV3Store.getState();
      const column = state.dataset.columns.find((c) => c.id === "input");
      expect(column?.name).toBe("user_question");
    });

    it("updates column type", () => {
      const store = useEvaluationsV3Store.getState();
      store.updateColumnType("input", "json");

      const state = useEvaluationsV3Store.getState();
      const column = state.dataset.columns.find((c) => c.id === "input");
      expect(column?.type).toBe("json");
    });

    it("returns correct row count", () => {
      const store = useEvaluationsV3Store.getState();

      // Initial state has 3 empty rows
      expect(store.getRowCount()).toBe(3);

      store.setCellValue(10, "input", "Value");

      expect(useEvaluationsV3Store.getState().getRowCount()).toBe(11);
    });
  });

  describe("Agent operations", () => {
    const createTestAgent = (id: string): AgentConfig => ({
      id,
      type: "llm",
      name: `Agent ${id}`,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
      evaluatorIds: [],
    });

    it("adds an agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));

      const state = useEvaluationsV3Store.getState();
      expect(state.agents).toHaveLength(1);
      expect(state.agents[0]?.name).toBe("Agent agent-1");
    });

    it("updates an agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.updateAgent("agent-1", { name: "Updated Agent" });

      const state = useEvaluationsV3Store.getState();
      expect(state.agents[0]?.name).toBe("Updated Agent");
    });

    it("removes an agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.removeAgent("agent-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.agents).toHaveLength(0);
    });

    it("sets agent mapping inside agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.setAgentMapping("agent-1", "input", {
        source: "dataset",
        sourceField: "input",
      });

      const state = useEvaluationsV3Store.getState();
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.mappings["input"]).toEqual({
        source: "dataset",
        sourceField: "input",
      });
    });

    it("removes agent and cleans up evaluator mappings", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.setEvaluatorMapping("eval-1", "agent-1", "output", {
        source: "agent-1",
        sourceField: "output",
      });
      store.removeAgent("agent-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.agents).toHaveLength(0);
      // Evaluator still exists but agent's mappings should be removed
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]).toBeUndefined();
    });
  });

  describe("Global evaluator operations", () => {
    const createTestEvaluator = (id: string): EvaluatorConfig => ({
      id,
      evaluatorType: "langevals/exact_match",
      name: `Evaluator ${id}`,
      settings: {},
      inputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    });

    it("adds a global evaluator", () => {
      const store = useEvaluationsV3Store.getState();
      store.addEvaluator(createTestEvaluator("eval-1"));

      const state = useEvaluationsV3Store.getState();
      expect(state.evaluators).toHaveLength(1);
      expect(state.evaluators[0]?.name).toBe("Evaluator eval-1");
    });

    it("updates a global evaluator", () => {
      const store = useEvaluationsV3Store.getState();
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.updateEvaluator("eval-1", { name: "Updated Evaluator" });

      const state = useEvaluationsV3Store.getState();
      expect(state.evaluators[0]?.name).toBe("Updated Evaluator");
    });

    it("removes a global evaluator and cleans up agent references", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent({
        id: "agent-1",
        type: "llm",
        name: "Agent 1",
        inputs: [],
        outputs: [],
        mappings: {},
        evaluatorIds: [],
      });
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.removeEvaluator("eval-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.evaluators).toHaveLength(0);
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.evaluatorIds).not.toContain("eval-1");
    });
  });

  describe("Agent-evaluator relationship operations", () => {
    const createTestAgent = (id: string): AgentConfig => ({
      id,
      type: "llm",
      name: `Agent ${id}`,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
      evaluatorIds: [],
    });

    const createTestEvaluator = (id: string): EvaluatorConfig => ({
      id,
      evaluatorType: "langevals/exact_match",
      name: `Evaluator ${id}`,
      settings: {},
      inputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    });

    it("adds an evaluator reference to an agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");

      const state = useEvaluationsV3Store.getState();
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.evaluatorIds).toContain("eval-1");
      // Evaluator should have initialized mappings for this agent
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]).toBeDefined();
    });

    it("does not add duplicate evaluator reference", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.addEvaluatorToAgent("agent-1", "eval-1"); // duplicate

      const state = useEvaluationsV3Store.getState();
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.evaluatorIds).toHaveLength(1);
    });

    it("removes an evaluator reference from an agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.removeEvaluatorFromAgent("agent-1", "eval-1");

      const state = useEvaluationsV3Store.getState();
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.evaluatorIds).not.toContain("eval-1");
      // Evaluator should have removed mappings for this agent
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]).toBeUndefined();
    });

    it("sets evaluator mapping for an agent", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.setEvaluatorMapping("eval-1", "agent-1", "output", {
        source: "agent-1",
        sourceField: "output",
      });

      const state = useEvaluationsV3Store.getState();
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]?.["output"]).toEqual({
        source: "agent-1",
        sourceField: "output",
      });
    });
  });

  describe("UI state operations", () => {
    it("opens overlay with target", () => {
      const store = useEvaluationsV3Store.getState();
      store.openOverlay("agent", "agent-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.openOverlay).toBe("agent");
      expect(state.ui.overlayTargetId).toBe("agent-1");
    });

    it("opens overlay with evaluator target", () => {
      const store = useEvaluationsV3Store.getState();
      store.openOverlay("evaluator", "agent-1", "eval-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.openOverlay).toBe("evaluator");
      expect(state.ui.overlayTargetId).toBe("agent-1");
      expect(state.ui.overlayEvaluatorId).toBe("eval-1");
    });

    it("closes overlay", () => {
      const store = useEvaluationsV3Store.getState();
      store.openOverlay("agent", "agent-1");
      store.closeOverlay();

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.openOverlay).toBeUndefined();
      expect(state.ui.overlayTargetId).toBeUndefined();
    });

    it("sets selected cell", () => {
      const store = useEvaluationsV3Store.getState();
      store.setSelectedCell({ row: 0, columnId: "input" });

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.selectedCell).toEqual({
        row: 0,
        columnId: "input",
      });
    });

    it("sets editing cell", () => {
      const store = useEvaluationsV3Store.getState();
      store.setEditingCell({ row: 0, columnId: "input" });

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.editingCell).toEqual({
        row: 0,
        columnId: "input",
      });
    });

    it("clears editing cell", () => {
      const store = useEvaluationsV3Store.getState();
      store.setEditingCell({ row: 0, columnId: "input" });
      store.setEditingCell(undefined);

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.editingCell).toBeUndefined();
    });

    it("toggles row selection", () => {
      const store = useEvaluationsV3Store.getState();
      store.toggleRowSelection(0);

      expect(useEvaluationsV3Store.getState().ui.selectedRows.has(0)).toBe(true);

      store.toggleRowSelection(0);
      expect(useEvaluationsV3Store.getState().ui.selectedRows.has(0)).toBe(
        false
      );
    });

    it("selects all rows", () => {
      const store = useEvaluationsV3Store.getState();
      store.selectAllRows(5);

      expect(useEvaluationsV3Store.getState().ui.selectedRows.size).toBe(5);
    });

    it("clears row selection", () => {
      const store = useEvaluationsV3Store.getState();
      store.toggleRowSelection(0);
      store.toggleRowSelection(1);
      store.clearRowSelection();

      expect(useEvaluationsV3Store.getState().ui.selectedRows.size).toBe(0);
    });

    it("sets expanded evaluator", () => {
      const store = useEvaluationsV3Store.getState();
      store.setExpandedEvaluator({
        agentId: "agent-1",
        evaluatorId: "eval-1",
        row: 0,
      });

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.expandedEvaluator).toEqual({
        agentId: "agent-1",
        evaluatorId: "eval-1",
        row: 0,
      });
    });
  });

  describe("Results operations", () => {
    it("sets results", () => {
      const store = useEvaluationsV3Store.getState();
      store.setResults({
        status: "running",
        progress: 5,
        total: 10,
      });

      const state = useEvaluationsV3Store.getState();
      expect(state.results.status).toBe("running");
      expect(state.results.progress).toBe(5);
      expect(state.results.total).toBe(10);
    });

    it("clears results", () => {
      const store = useEvaluationsV3Store.getState();
      store.setResults({
        status: "success",
        runId: "run-123",
        agentOutputs: { "agent-1": ["output1"] },
      });
      store.clearResults();

      const state = useEvaluationsV3Store.getState();
      expect(state.results.status).toBe("idle");
      expect(state.results.runId).toBeUndefined();
      expect(state.results.agentOutputs).toEqual({});
    });
  });

  describe("Reset", () => {
    it("resets to initial state", () => {
      const store = useEvaluationsV3Store.getState();
      const initialState = createInitialState();

      store.setName("Modified Name");
      store.addAgent({
        id: "agent-1",
        type: "llm",
        name: "Agent",
        inputs: [],
        outputs: [],
        mappings: {},
        evaluatorIds: [],
      });
      store.reset();

      const state = useEvaluationsV3Store.getState();
      expect(state.name).toBe(initialState.name);
      expect(state.agents).toEqual([]);
    });
  });

  describe("Undo/Redo (temporal)", () => {
    it("tracks dataset changes in undo history", async () => {
      const store = useEvaluationsV3Store.getState();

      // Make a change
      store.setCellValue(0, "input", "First value");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Make another change
      store.setCellValue(0, "input", "Second value");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(
        useEvaluationsV3Store.getState().dataset.records["input"]?.[0]
      ).toBe("Second value");

      // Undo
      useEvaluationsV3Store.temporal.getState().undo();

      expect(
        useEvaluationsV3Store.getState().dataset.records["input"]?.[0]
      ).toBe("First value");

      // Redo
      useEvaluationsV3Store.temporal.getState().redo();

      expect(
        useEvaluationsV3Store.getState().dataset.records["input"]?.[0]
      ).toBe("Second value");
    });

    it("does not track UI state changes in undo history", async () => {
      const store = useEvaluationsV3Store.getState();

      // Set initial data
      store.setCellValue(0, "input", "Initial");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Make a UI change (should not be tracked)
      store.setEditingCell({ row: 0, columnId: "input" });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Check undo doesn't undo UI state
      const pastStatesCount =
        useEvaluationsV3Store.temporal.getState().pastStates.length;

      // UI changes alone should not create new undo entries
      store.setEditingCell({ row: 1, columnId: "input" });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Same number of past states (UI changes are not tracked)
      expect(
        useEvaluationsV3Store.temporal.getState().pastStates.length
      ).toBeLessThanOrEqual(pastStatesCount);
    });
  });
});

// Helper function used in tests
const createTestEvaluator = (id: string): EvaluatorConfig => ({
  id,
  evaluatorType: "langevals/exact_match",
  name: `Evaluator ${id}`,
  settings: {},
  inputs: [{ identifier: "output", type: "str" }],
  mappings: {},
});
