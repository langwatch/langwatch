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

    it("creates signature node for LLM agent", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "GPT Agent",
            llmConfig: { model: "openai/gpt-4o" },
            instructions: "You are helpful",
            messages: [{ role: "user", content: "Hello {{input}}" }],
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
            evaluatorIds: [],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const signatureNode = workflow.nodes.find((n) => n.type === "signature");
      expect(signatureNode).toBeDefined();
      expect(signatureNode?.id).toBe("agent-1");
      expect(signatureNode?.data.name).toBe("GPT Agent");
    });

    it("creates code node for code agent", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        agents: [
          {
            id: "agent-1",
            type: "code",
            name: "Code Agent",
            code: 'return {"output": "hello"}',
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
            evaluatorIds: [],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const codeNode = workflow.nodes.find((n) => n.type === "code");
      expect(codeNode).toBeDefined();
      expect(codeNode?.id).toBe("agent-1");
    });

    it("creates evaluator nodes duplicated per-agent", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            name: "Exact Match",
            settings: {},
            inputs: [{ identifier: "output", type: "str" }],
            mappings: {},
          },
        ],
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
            evaluatorIds: ["eval-1"],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const evaluatorNode = workflow.nodes.find((n) => n.type === "evaluator");
      expect(evaluatorNode).toBeDefined();
      // Evaluator node ID is {agentId}.{evaluatorId}
      expect(evaluatorNode?.id).toBe("agent-1.eval-1");
      expect(
        (evaluatorNode?.data as { evaluator?: string })?.evaluator
      ).toBe("langevals/exact_match");
    });

    it("creates edges from agent mappings with sourceId matching active dataset", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              input: {
                source: "dataset",
                sourceId: DEFAULT_TEST_DATA_ID,
                sourceField: "input",
              },
            },
            evaluatorIds: [],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const edge = workflow.edges.find((e) => e.target === "agent-1");
      expect(edge).toBeDefined();
      expect(edge?.source).toBe("entry");
      expect(edge?.sourceHandle).toBe("output-input");
      expect(edge?.targetHandle).toBe("input-input");
    });

    it("does not create edges for mappings pointing to inactive datasets", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        datasets: [
          {
            id: "ds-1",
            name: "Dataset 1",
            type: "inline",
            inline: {
              columns: [{ id: "col1", name: "col1", type: "string" }],
              records: { col1: [] },
            },
            columns: [{ id: "col1", name: "col1", type: "string" }],
          },
          {
            id: "ds-2",
            name: "Dataset 2",
            type: "inline",
            inline: {
              columns: [{ id: "col2", name: "col2", type: "string" }],
              records: { col2: [] },
            },
            columns: [{ id: "col2", name: "col2", type: "string" }],
          },
        ],
        activeDatasetId: "ds-1",
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              input: {
                source: "dataset",
                sourceId: "ds-2", // Points to inactive dataset
                sourceField: "col2",
              },
            },
            evaluatorIds: [],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      // No edges should be created since mapping points to inactive dataset
      const agentEdges = workflow.edges.filter((e) => e.target === "agent-1");
      expect(agentEdges).toHaveLength(0);
    });

    it("creates edges from evaluator mappings stored inside evaluator", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            name: "Exact Match",
            settings: {},
            inputs: [
              { identifier: "output", type: "str" },
              { identifier: "expected_output", type: "str" },
            ],
            mappings: {
              "agent-1": {
                output: {
                  source: "agent",
                  sourceId: "agent-1",
                  sourceField: "output",
                },
                expected_output: {
                  source: "dataset",
                  sourceId: DEFAULT_TEST_DATA_ID,
                  sourceField: "expected_output",
                },
              },
            },
          },
        ],
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
            evaluatorIds: ["eval-1"],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const edges = workflow.edges.filter(
        (e) => e.target === "agent-1.eval-1"
      );
      expect(edges).toHaveLength(2);

      const outputEdge = edges.find((e) => e.targetHandle === "input-output");
      expect(outputEdge?.source).toBe("agent-1");

      const expectedEdge = edges.find(
        (e) => e.targetHandle === "input-expected_output"
      );
      expect(expectedEdge?.source).toBe("entry");
    });

    it("duplicates evaluator for each agent that uses it", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            name: "Exact Match",
            settings: {},
            inputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "agent-1": {},
              "agent-2": {},
            },
          },
        ],
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent 1",
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
            evaluatorIds: ["eval-1"],
          },
          {
            id: "agent-2",
            type: "llm",
            name: "Agent 2",
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
            evaluatorIds: ["eval-1"],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const evaluatorNodes = workflow.nodes.filter(
        (n) => n.type === "evaluator"
      );
      expect(evaluatorNodes).toHaveLength(2);
      expect(evaluatorNodes.map((n) => n.id).sort()).toEqual([
        "agent-1.eval-1",
        "agent-2.eval-1",
      ]);
    });

    it("creates edges for agent-to-agent mappings", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent 1",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              input: {
                source: "dataset",
                sourceId: DEFAULT_TEST_DATA_ID,
                sourceField: "input",
              },
            },
            evaluatorIds: [],
          },
          {
            id: "agent-2",
            type: "llm",
            name: "Agent 2",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              input: {
                source: "agent",
                sourceId: "agent-1",
                sourceField: "output",
              },
            },
            evaluatorIds: [],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const agentToAgentEdge = workflow.edges.find(
        (e) => e.source === "agent-1" && e.target === "agent-2"
      );
      expect(agentToAgentEdge).toBeDefined();
      expect(agentToAgentEdge?.sourceHandle).toBe("output-output");
      expect(agentToAgentEdge?.targetHandle).toBe("input-input");
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
