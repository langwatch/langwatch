import { describe, expect, it } from "vitest";

import {
  createInitialState,
  DEFAULT_TEST_DATA_ID,
  type EvaluationsV3State,
} from "../types";
import { stateToWorkflow, getActiveDatasetData } from "../utils/dslAdapter";

describe("DSL Adapter", () => {
  describe("stateToWorkflow", () => {
    it("converts initial state to valid workflow", () => {
      const state = createInitialState();
      const workflow = stateToWorkflow(state);

      expect(workflow.spec_version).toBe("1.4");
      expect(workflow.name).toBe("New Evaluation");
      expect(workflow.nodes).toHaveLength(1); // Just entry node
      expect(workflow.nodes[0]?.type).toBe("entry");
    });

    it("includes dataset columns as entry outputs from active dataset", () => {
      const state = createInitialState();
      const workflow = stateToWorkflow(state);

      const entryNode = workflow.nodes.find((n) => n.type === "entry");
      expect(entryNode?.data.outputs).toHaveLength(2);
      expect(entryNode?.data.outputs?.[0]?.identifier).toBe("input");
      expect(entryNode?.data.outputs?.[1]?.identifier).toBe("expected_output");
    });

    it("uses active dataset by default", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        datasets: [
          {
            id: "ds-1",
            name: "Dataset 1",
            type: "inline",
            inline: {
              columns: [{ id: "question", name: "question", type: "string" }],
              records: { question: ["q1"] },
            },
            columns: [{ id: "question", name: "question", type: "string" }],
          },
          {
            id: "ds-2",
            name: "Dataset 2",
            type: "inline",
            inline: {
              columns: [{ id: "answer", name: "answer", type: "string" }],
              records: { answer: ["a1"] },
            },
            columns: [{ id: "answer", name: "answer", type: "string" }],
          },
        ],
        activeDatasetId: "ds-2",
      };

      const workflow = stateToWorkflow(state);

      const entryNode = workflow.nodes.find((n) => n.type === "entry");
      expect(entryNode?.data.name).toBe("Dataset 2");
      expect(entryNode?.data.outputs).toHaveLength(1);
      expect(entryNode?.data.outputs?.[0]?.identifier).toBe("answer");
    });

    it("can override dataset with datasetIdOverride parameter", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        datasets: [
          {
            id: "ds-1",
            name: "Dataset 1",
            type: "inline",
            inline: {
              columns: [{ id: "question", name: "question", type: "string" }],
              records: { question: ["q1"] },
            },
            columns: [{ id: "question", name: "question", type: "string" }],
          },
          {
            id: "ds-2",
            name: "Dataset 2",
            type: "inline",
            inline: {
              columns: [{ id: "answer", name: "answer", type: "string" }],
              records: { answer: ["a1"] },
            },
            columns: [{ id: "answer", name: "answer", type: "string" }],
          },
        ],
        activeDatasetId: "ds-2",
      };

      const workflow = stateToWorkflow(state, "ds-1"); // Override to ds-1

      const entryNode = workflow.nodes.find((n) => n.type === "entry");
      expect(entryNode?.data.name).toBe("Dataset 1");
      expect(entryNode?.data.outputs?.[0]?.identifier).toBe("question");
    });

    it("throws error if dataset not found", () => {
      const state = createInitialState();

      expect(() => stateToWorkflow(state, "non-existent")).toThrow(
        "Dataset with id non-existent not found"
      );
    });

    // Note: The following tests are skipped because the new runner architecture
    // handles prompts and agents differently. Prompt runners are handled via API
    // calls, not DSL nodes. Agent runners (code/workflow) would need updated tests.
    it.skip("creates code node for agent runner", () => {
      // TODO: Update for new runner architecture
    });

    it.skip("creates evaluator nodes duplicated per-runner", () => {
      // TODO: Update for new runner architecture
    });

    it.skip("creates edges from runner mappings with sourceId matching active dataset", () => {
      // TODO: Update for new runner architecture
    });
  });

  describe("getActiveDatasetData", () => {
    it("returns inline dataset data for active dataset", () => {
      const state = createInitialState();
      const data = getActiveDatasetData(state);

      expect(data).toBeDefined();
      expect(data?.columns).toHaveLength(2);
      expect(data?.records["input"]).toBeDefined();
    });

    it("returns undefined for saved dataset", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        datasets: [
          {
            id: "saved-ds",
            name: "Saved Dataset",
            type: "saved",
            datasetId: "db-123",
            columns: [{ id: "col1", name: "col1", type: "string" }],
          },
        ],
        activeDatasetId: "saved-ds",
      };

      const data = getActiveDatasetData(state);
      expect(data).toBeUndefined();
    });
  });
});
