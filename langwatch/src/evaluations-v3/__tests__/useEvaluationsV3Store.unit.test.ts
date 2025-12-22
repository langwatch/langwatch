import { beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import {
  createInitialState,
  DEFAULT_TEST_DATA_ID,
  type AgentConfig,
  type DatasetReference,
  type EvaluatorConfig,
} from "../types";

describe("useEvaluationsV3Store", () => {
  beforeEach(() => {
    // Reset store before each test
    useEvaluationsV3Store.getState().reset();
  });

  describe("Dataset operations", () => {
    it("sets cell value in active dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.setCellValue(DEFAULT_TEST_DATA_ID, 0, "input", "Hello world");

      const state = useEvaluationsV3Store.getState();
      const activeDataset = state.datasets.find(
        (d) => d.id === DEFAULT_TEST_DATA_ID
      );
      expect(activeDataset?.inline?.records["input"]?.[0]).toBe("Hello world");
    });

    it("expands records array when setting value at higher row index", () => {
      const store = useEvaluationsV3Store.getState();
      store.setCellValue(DEFAULT_TEST_DATA_ID, 5, "input", "Value at row 5");

      const state = useEvaluationsV3Store.getState();
      const activeDataset = state.datasets.find(
        (d) => d.id === DEFAULT_TEST_DATA_ID
      );
      expect(activeDataset?.inline?.records["input"]?.length).toBe(6);
      expect(activeDataset?.inline?.records["input"]?.[5]).toBe("Value at row 5");
    });

    it("adds a new column to inline dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.addColumn(DEFAULT_TEST_DATA_ID, {
        id: "context",
        name: "context",
        type: "string",
      });

      const state = useEvaluationsV3Store.getState();
      const activeDataset = state.datasets.find(
        (d) => d.id === DEFAULT_TEST_DATA_ID
      );
      expect(activeDataset?.columns).toHaveLength(3);
      expect(activeDataset?.columns[2]?.name).toBe("context");
      expect(activeDataset?.inline?.records["context"]).toBeDefined();
    });

    it("removes a column from inline dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.removeColumn(DEFAULT_TEST_DATA_ID, "expected_output");

      const state = useEvaluationsV3Store.getState();
      const activeDataset = state.datasets.find(
        (d) => d.id === DEFAULT_TEST_DATA_ID
      );
      expect(activeDataset?.columns).toHaveLength(1);
      expect(activeDataset?.inline?.records["expected_output"]).toBeUndefined();
    });

    it("renames a column", () => {
      const store = useEvaluationsV3Store.getState();
      store.renameColumn(DEFAULT_TEST_DATA_ID, "input", "user_question");

      const state = useEvaluationsV3Store.getState();
      const activeDataset = state.datasets.find(
        (d) => d.id === DEFAULT_TEST_DATA_ID
      );
      const column = activeDataset?.columns.find((c) => c.id === "input");
      expect(column?.name).toBe("user_question");
    });

    it("updates column type", () => {
      const store = useEvaluationsV3Store.getState();
      store.updateColumnType(DEFAULT_TEST_DATA_ID, "input", "json");

      const state = useEvaluationsV3Store.getState();
      const activeDataset = state.datasets.find(
        (d) => d.id === DEFAULT_TEST_DATA_ID
      );
      const column = activeDataset?.columns.find((c) => c.id === "input");
      expect(column?.type).toBe("json");
    });

    it("returns correct row count", () => {
      const store = useEvaluationsV3Store.getState();

      // Initial state has 3 empty rows
      expect(store.getRowCount(DEFAULT_TEST_DATA_ID)).toBe(3);

      store.setCellValue(DEFAULT_TEST_DATA_ID, 10, "input", "Value");

      expect(
        useEvaluationsV3Store.getState().getRowCount(DEFAULT_TEST_DATA_ID)
      ).toBe(11);
    });
  });

  describe("Multi-dataset operations", () => {
    const createTestDataset = (id: string, name: string): DatasetReference => ({
      id,
      name,
      type: "inline",
      inline: {
        columns: [{ id: "col1", name: "col1", type: "string" }],
        records: { col1: ["a", "b", "c"] },
      },
      columns: [{ id: "col1", name: "col1", type: "string" }],
    });

    it("adds a dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-1", "Dataset 1"));

      const state = useEvaluationsV3Store.getState();
      expect(state.datasets).toHaveLength(2); // Initial + new one
      expect(state.datasets[1]?.name).toBe("Dataset 1");
    });

    it("removes a dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-1", "Dataset 1"));
      store.removeDataset("ds-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.datasets).toHaveLength(1);
      expect(state.datasets.find((d) => d.id === "ds-1")).toBeUndefined();
    });

    it("cannot remove the last dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.removeDataset(DEFAULT_TEST_DATA_ID);

      const state = useEvaluationsV3Store.getState();
      expect(state.datasets).toHaveLength(1); // Still has the initial dataset
    });

    it("sets active dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-1", "Dataset 1"));
      store.setActiveDataset("ds-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.activeDatasetId).toBe("ds-1");
    });

    it("switches active dataset when removing current active", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-1", "Dataset 1"));
      store.setActiveDataset("ds-1");
      store.removeDataset("ds-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.activeDatasetId).toBe(DEFAULT_TEST_DATA_ID);
    });

    it("cleans up agent mappings when removing dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-1", "Dataset 1"));
      store.addAgent({
        id: "agent-1",
        type: "llm",
        name: "Agent 1",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [],
        mappings: {
          input: {
            source: "dataset",
            sourceId: "ds-1",
            sourceField: "col1",
          },
        },
        evaluatorIds: [],
      });
      store.removeDataset("ds-1");

      const state = useEvaluationsV3Store.getState();
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.mappings["input"]).toBeUndefined();
    });

    it("cleans up evaluator mappings when removing dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-1", "Dataset 1"));
      store.addEvaluator({
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        name: "Evaluator 1",
        settings: {},
        inputs: [],
        mappings: {
          "agent-1": {
            output: {
              source: "dataset",
              sourceId: "ds-1",
              sourceField: "col1",
            },
          },
        },
      });
      store.removeDataset("ds-1");

      const state = useEvaluationsV3Store.getState();
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]?.["output"]).toBeUndefined();
    });

    it("updates dataset properties", () => {
      const store = useEvaluationsV3Store.getState();
      store.updateDataset(DEFAULT_TEST_DATA_ID, { name: "Renamed Dataset" });

      const state = useEvaluationsV3Store.getState();
      const dataset = state.datasets.find((d) => d.id === DEFAULT_TEST_DATA_ID);
      expect(dataset?.name).toBe("Renamed Dataset");
    });

    it("exports inline to saved dataset", () => {
      const store = useEvaluationsV3Store.getState();
      store.exportInlineToSaved(DEFAULT_TEST_DATA_ID, "saved-ds-123");

      const state = useEvaluationsV3Store.getState();
      const dataset = state.datasets.find((d) => d.id === DEFAULT_TEST_DATA_ID);
      expect(dataset?.type).toBe("saved");
      expect(dataset?.datasetId).toBe("saved-ds-123");
      expect(dataset?.inline).toBeUndefined();
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

    it("sets agent mapping inside agent with sourceId", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.setAgentMapping("agent-1", "input", {
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });

      const state = useEvaluationsV3Store.getState();
      const agent = state.agents.find((a) => a.id === "agent-1");
      expect(agent?.mappings["input"]).toEqual({
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });
    });

    it("removes agent and cleans up evaluator mappings", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.setEvaluatorMapping("eval-1", "agent-1", "output", {
        source: "agent",
        sourceId: "agent-1",
        sourceField: "output",
      });
      store.removeAgent("agent-1");

      const state = useEvaluationsV3Store.getState();
      expect(state.agents).toHaveLength(0);
      // Evaluator still exists but agent's mappings should be removed
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]).toBeUndefined();
    });

    it("removes mappings referencing removed agent from other agents", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addAgent(createTestAgent("agent-2"));
      store.setAgentMapping("agent-2", "input", {
        source: "agent",
        sourceId: "agent-1",
        sourceField: "output",
      });
      store.removeAgent("agent-1");

      const state = useEvaluationsV3Store.getState();
      const agent2 = state.agents.find((a) => a.id === "agent-2");
      expect(agent2?.mappings["input"]).toBeUndefined();
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

    it("sets evaluator mapping for an agent with sourceId", () => {
      const store = useEvaluationsV3Store.getState();
      store.addAgent(createTestAgent("agent-1"));
      store.addEvaluator(createTestEvaluator("eval-1"));
      store.addEvaluatorToAgent("agent-1", "eval-1");
      store.setEvaluatorMapping("eval-1", "agent-1", "output", {
        source: "agent",
        sourceId: "agent-1",
        sourceField: "output",
      });

      const state = useEvaluationsV3Store.getState();
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");
      expect(evaluator?.mappings["agent-1"]?.["output"]).toEqual({
        source: "agent",
        sourceId: "agent-1",
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
      expect(state.datasets).toHaveLength(1);
      expect(state.activeDatasetId).toBe(DEFAULT_TEST_DATA_ID);
    });
  });

  describe("Undo/Redo (temporal)", () => {
    it("tracks dataset changes in undo history", async () => {
      const store = useEvaluationsV3Store.getState();

      // Make a change
      store.setCellValue(DEFAULT_TEST_DATA_ID, 0, "input", "First value");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Make another change
      store.setCellValue(DEFAULT_TEST_DATA_ID, 0, "input", "Second value");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      const getInputValue = () => {
        const ds = useEvaluationsV3Store
          .getState()
          .datasets.find((d) => d.id === DEFAULT_TEST_DATA_ID);
        return ds?.inline?.records["input"]?.[0];
      };

      expect(getInputValue()).toBe("Second value");

      // Undo
      useEvaluationsV3Store.temporal.getState().undo();

      expect(getInputValue()).toBe("First value");

      // Redo
      useEvaluationsV3Store.temporal.getState().redo();

      expect(getInputValue()).toBe("Second value");
    });

    it("does not track UI state changes in undo history", async () => {
      const store = useEvaluationsV3Store.getState();

      // Set initial data
      store.setCellValue(DEFAULT_TEST_DATA_ID, 0, "input", "Initial");

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
