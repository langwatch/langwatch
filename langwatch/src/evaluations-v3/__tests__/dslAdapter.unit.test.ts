import { describe, expect, it } from "vitest";

import type { Workflow } from "~/optimization_studio/types/dsl";

import { createInitialState, type EvaluationsV3State } from "../types";
import { stateToWorkflow, workflowToState } from "../utils/dslAdapter";

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

    it("includes dataset columns as entry outputs", () => {
      const state = createInitialState();
      const workflow = stateToWorkflow(state);

      const entryNode = workflow.nodes.find((n) => n.type === "entry");
      expect(entryNode?.data.outputs).toHaveLength(2);
      expect(entryNode?.data.outputs?.[0]?.identifier).toBe("input");
      expect(entryNode?.data.outputs?.[1]?.identifier).toBe("expected_output");
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

    it("creates edges from agent mappings inside agent", () => {
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
              input: { source: "dataset", sourceField: "input" },
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
                output: { source: "agent-1", sourceField: "output" },
                expected_output: {
                  source: "dataset",
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
  });

  describe("workflowToState", () => {
    const createBaseWorkflow = (): Workflow => ({
      spec_version: "1.4",
      name: "Test",
      icon: "📊",
      description: "",
      version: "1.0",
      default_llm: { model: "openai/gpt-4o" },
      template_adapter: "default",
      enable_tracing: true,
      nodes: [],
      edges: [],
      state: {},
    });

    it("extracts dataset from entry node", () => {
      const workflow: Workflow = {
        ...createBaseWorkflow(),
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [
                { identifier: "question", type: "str" },
                { identifier: "answer", type: "str" },
              ],
              entry_selection: "first",
              train_size: 0.8,
              test_size: 0.2,
              seed: 42,
            },
          },
        ],
      };

      const state = workflowToState(workflow);

      expect(state.dataset?.columns).toHaveLength(2);
      expect(state.dataset?.columns[0]?.id).toBe("question");
      expect(state.dataset?.columns[1]?.id).toBe("answer");
    });

    it("extracts agents with evaluatorIds references", () => {
      const workflow: Workflow = {
        ...createBaseWorkflow(),
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [],
              entry_selection: "first",
              train_size: 0.8,
              test_size: 0.2,
              seed: 42,
            },
          },
          {
            id: "agent-1",
            type: "signature",
            position: { x: 300, y: 0 },
            data: {
              name: "My LLM",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
          {
            id: "agent-1.eval-1",
            type: "evaluator",
            position: { x: 600, y: 0 },
            data: {
              name: "Exact Match",
              cls: "LangWatchEvaluator",
              evaluator: "langevals/exact_match",
              inputs: [{ identifier: "output", type: "str" }],
              outputs: [],
            },
          },
        ],
      };

      const state = workflowToState(workflow);

      expect(state.agents).toHaveLength(1);
      expect(state.agents?.[0]?.type).toBe("llm");
      expect(state.agents?.[0]?.name).toBe("My LLM");
      // Agent should have evaluatorIds reference
      expect(state.agents?.[0]?.evaluatorIds).toContain("eval-1");
      // Evaluator should be extracted as global
      expect(state.evaluators).toHaveLength(1);
      expect(state.evaluators?.[0]?.id).toBe("eval-1");
      expect(state.evaluators?.[0]?.evaluatorType).toBe("langevals/exact_match");
    });

    it("extracts agent mappings inside agent", () => {
      const workflow: Workflow = {
        ...createBaseWorkflow(),
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [{ identifier: "input", type: "str" }],
              entry_selection: "first",
              train_size: 0.8,
              test_size: 0.2,
              seed: 42,
            },
          },
          {
            id: "agent-1",
            type: "signature",
            position: { x: 300, y: 0 },
            data: {
              name: "Agent",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            sourceHandle: "output-input",
            target: "agent-1",
            targetHandle: "input-input",
          },
        ],
      };

      const state = workflowToState(workflow);

      expect(state.agents?.[0]?.mappings["input"]).toEqual({
        source: "dataset",
        sourceField: "input",
      });
    });

    it("extracts evaluator mappings inside global evaluator", () => {
      const workflow: Workflow = {
        ...createBaseWorkflow(),
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [{ identifier: "expected_output", type: "str" }],
              entry_selection: "first",
              train_size: 0.8,
              test_size: 0.2,
              seed: 42,
            },
          },
          {
            id: "agent-1",
            type: "signature",
            position: { x: 300, y: 0 },
            data: {
              name: "Agent",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
          {
            id: "agent-1.eval-1",
            type: "evaluator",
            position: { x: 600, y: 0 },
            data: {
              name: "Exact Match",
              cls: "LangWatchEvaluator",
              evaluator: "langevals/exact_match",
              inputs: [
                { identifier: "output", type: "str" },
                { identifier: "expected_output", type: "str" },
              ],
              outputs: [],
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "agent-1",
            sourceHandle: "output-output",
            target: "agent-1.eval-1",
            targetHandle: "input-output",
          },
          {
            id: "e2",
            source: "entry",
            sourceHandle: "output-expected_output",
            target: "agent-1.eval-1",
            targetHandle: "input-expected_output",
          },
        ],
      };

      const state = workflowToState(workflow);

      // Mappings should be inside the global evaluator, keyed by agentId
      expect(
        state.evaluators?.[0]?.mappings["agent-1"]?.["output"]
      ).toEqual({
        source: "agent-1",
        sourceField: "output",
      });
      expect(
        state.evaluators?.[0]?.mappings["agent-1"]?.["expected_output"]
      ).toEqual({
        source: "dataset",
        sourceField: "expected_output",
      });
    });

    it("deduplicates evaluators from multiple agents", () => {
      const workflow: Workflow = {
        ...createBaseWorkflow(),
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [],
              entry_selection: "first",
              train_size: 0.8,
              test_size: 0.2,
              seed: 42,
            },
          },
          {
            id: "agent-1",
            type: "signature",
            position: { x: 300, y: 0 },
            data: {
              name: "Agent 1",
              inputs: [],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
          {
            id: "agent-2",
            type: "signature",
            position: { x: 300, y: 200 },
            data: {
              name: "Agent 2",
              inputs: [],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
          {
            id: "agent-1.eval-1",
            type: "evaluator",
            position: { x: 600, y: 0 },
            data: {
              name: "Exact Match",
              cls: "LangWatchEvaluator",
              evaluator: "langevals/exact_match",
              inputs: [{ identifier: "output", type: "str" }],
              outputs: [],
            },
          },
          {
            id: "agent-2.eval-1",
            type: "evaluator",
            position: { x: 600, y: 200 },
            data: {
              name: "Exact Match",
              cls: "LangWatchEvaluator",
              evaluator: "langevals/exact_match",
              inputs: [{ identifier: "output", type: "str" }],
              outputs: [],
            },
          },
        ],
      };

      const state = workflowToState(workflow);

      // Same evaluator ID should be deduplicated into one global evaluator
      expect(state.evaluators).toHaveLength(1);
      expect(state.evaluators?.[0]?.id).toBe("eval-1");
      // Both agents should reference it
      expect(state.agents?.[0]?.evaluatorIds).toContain("eval-1");
      expect(state.agents?.[1]?.evaluatorIds).toContain("eval-1");
    });
  });

  describe("round-trip conversion", () => {
    it("preserves data through state -> workflow -> state", () => {
      const originalState: EvaluationsV3State = {
        ...createInitialState(),
        name: "My Evaluation",
        dataset: {
          columns: [
            { id: "input", name: "input", type: "string" },
            { id: "expected", name: "expected", type: "string" },
          ],
          records: {
            input: ["hello", "world"],
            expected: ["hi", "earth"],
          },
        },
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            name: "Match",
            settings: {},
            inputs: [
              { identifier: "output", type: "str" },
              { identifier: "expected_output", type: "str" },
            ],
            mappings: {
              "agent-1": {
                output: { source: "agent-1", sourceField: "output" },
                expected_output: { source: "dataset", sourceField: "expected" },
              },
            },
          },
        ],
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "GPT Agent",
            llmConfig: { model: "openai/gpt-4o" },
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              input: { source: "dataset", sourceField: "input" },
            },
            evaluatorIds: ["eval-1"],
          },
        ],
      };

      const workflow = stateToWorkflow(originalState);
      const restoredState = workflowToState(workflow);

      // Name should be preserved
      expect(restoredState.name).toBe(originalState.name);

      // Agents should be preserved with their evaluatorIds
      expect(restoredState.agents).toHaveLength(1);
      expect(restoredState.agents?.[0]?.id).toBe("agent-1");
      expect(restoredState.agents?.[0]?.type).toBe("llm");
      expect(restoredState.agents?.[0]?.evaluatorIds).toContain("eval-1");

      // Global evaluators should be preserved
      expect(restoredState.evaluators).toHaveLength(1);
      expect(restoredState.evaluators?.[0]?.id).toBe("eval-1");

      // Agent mappings should be preserved inside agent
      expect(restoredState.agents?.[0]?.mappings["input"]).toEqual(
        originalState.agents[0]?.mappings["input"]
      );

      // Evaluator mappings should be preserved inside evaluator
      expect(
        restoredState.evaluators?.[0]?.mappings["agent-1"]?.["output"]
      ).toEqual(originalState.evaluators[0]?.mappings["agent-1"]?.output);
    });
  });
});
