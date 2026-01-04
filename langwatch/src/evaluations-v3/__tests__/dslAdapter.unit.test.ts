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

    // Note: The following tests are skipped because the new target architecture
    // handles prompts and agents differently. Prompt targets are handled via API
    // calls, not DSL nodes. Agent targets (code/workflow) would need updated tests.
    it.skip("creates code node for agent target", () => {
      // TODO: Update for new target architecture
    });

    it.skip("creates evaluator nodes duplicated per-target", () => {
      // TODO: Update for new target architecture
    });

    it.skip("creates edges from target mappings with sourceId matching active dataset", () => {
      // TODO: Update for new target architecture
    });

    describe("value mappings", () => {
      it("sets value on target input when mapping type is value", () => {
        const state: EvaluationsV3State = {
          ...createInitialState(),
          targets: [
            {
              id: "target-1",
              type: "agent",
              name: "Code Target",
              inputs: [
                { identifier: "question", type: "str" },
                { identifier: "context", type: "str" },
              ],
              outputs: [{ identifier: "output", type: "str" }],
              // Per-dataset mappings: datasetId -> inputField -> FieldMapping
              mappings: {
                [DEFAULT_TEST_DATA_ID]: {
                  question: {
                    type: "source",
                    source: "dataset",
                    sourceId: DEFAULT_TEST_DATA_ID,
                    sourceField: "input",
                  },
                  context: {
                    type: "value",
                    value: "This is hardcoded context",
                  },
                },
              },
            },
          ],
        };

        const workflow = stateToWorkflow(state);

        const codeNode = workflow.nodes.find((n) => n.id === "target-1");
        expect(codeNode).toBeDefined();
        expect(codeNode?.data.inputs).toHaveLength(2);

        // Question should NOT have a value (it's mapped to dataset)
        const questionInput = codeNode?.data.inputs?.find(
          (i) => i.identifier === "question"
        );
        expect(questionInput?.value).toBeUndefined();

        // Context SHOULD have a value (hardcoded)
        const contextInput = codeNode?.data.inputs?.find(
          (i) => i.identifier === "context"
        );
        expect(contextInput?.value).toBe("This is hardcoded context");
      });

      it("creates edges only for source mappings, not value mappings", () => {
        const state: EvaluationsV3State = {
          ...createInitialState(),
          targets: [
            {
              id: "target-1",
              type: "agent",
              name: "Code Target",
              inputs: [
                { identifier: "question", type: "str" },
                { identifier: "context", type: "str" },
              ],
              outputs: [{ identifier: "output", type: "str" }],
              // Per-dataset mappings
              mappings: {
                [DEFAULT_TEST_DATA_ID]: {
                  question: {
                    type: "source",
                    source: "dataset",
                    sourceId: DEFAULT_TEST_DATA_ID,
                    sourceField: "input",
                  },
                  context: {
                    type: "value",
                    value: "This is hardcoded context",
                  },
                },
              },
            },
          ],
        };

        const workflow = stateToWorkflow(state);

        // Should only have edge for "question" (source mapping), not for "context" (value mapping)
        expect(workflow.edges).toHaveLength(1);
        expect(workflow.edges[0]?.targetHandle).toBe("input-question");
      });

      it("sets value on evaluator input when mapping type is value", () => {
        const state: EvaluationsV3State = {
          ...createInitialState(),
          targets: [
            {
              id: "target-1",
              type: "agent",
              name: "Code Target",
              inputs: [{ identifier: "question", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
              // Per-dataset mappings
              mappings: {
                [DEFAULT_TEST_DATA_ID]: {
                  question: {
                    type: "source",
                    source: "dataset",
                    sourceId: DEFAULT_TEST_DATA_ID,
                    sourceField: "input",
                  },
                },
              },
            },
          ],
          evaluators: [
            {
              id: "eval-1",
              evaluatorType: "langevals/exact_match",
              name: "Exact Match",
              settings: {},
              inputs: [
                { identifier: "output", type: "str" },
                { identifier: "expected", type: "str" },
              ],
              // Per-dataset, per-target mappings
              mappings: {
                [DEFAULT_TEST_DATA_ID]: {
                  "target-1": {
                    output: {
                      type: "source",
                      source: "target",
                      sourceId: "target-1",
                      sourceField: "output",
                    },
                    expected: {
                      type: "value",
                      value: "expected result",
                    },
                  },
                },
              },
            },
          ],
        };

        const workflow = stateToWorkflow(state);

        const evaluatorNode = workflow.nodes.find(
          (n) => n.id === "target-1.eval-1"
        );
        expect(evaluatorNode).toBeDefined();

        // Output should NOT have a value (it's mapped to target)
        const outputInput = evaluatorNode?.data.inputs?.find(
          (i) => i.identifier === "output"
        );
        expect(outputInput?.value).toBeUndefined();

        // Expected SHOULD have a value (hardcoded)
        const expectedInput = evaluatorNode?.data.inputs?.find(
          (i) => i.identifier === "expected"
        );
        expect(expectedInput?.value).toBe("expected result");
      });
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
