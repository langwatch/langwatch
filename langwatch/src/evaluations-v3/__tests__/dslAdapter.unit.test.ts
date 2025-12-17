import { describe, expect, it } from "vitest";

import type { Workflow } from "~/optimization_studio/types/dsl";

import { createInitialState, type EvaluationsV3State } from "../types";
import {
  hasStateChanged,
  stateToWorkflow,
  workflowToState,
} from "../utils/dslAdapter";

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
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const codeNode = workflow.nodes.find((n) => n.type === "code");
      expect(codeNode).toBeDefined();
      expect(codeNode?.id).toBe("agent-1");
    });

    it("creates evaluator nodes", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            name: "Exact Match",
            settings: {},
            inputs: [{ identifier: "output", type: "str" }],
          },
        ],
      };

      const workflow = stateToWorkflow(state);

      const evaluatorNode = workflow.nodes.find((n) => n.type === "evaluator");
      expect(evaluatorNode).toBeDefined();
      expect(evaluatorNode?.id).toBe("eval-1");
      expect((evaluatorNode?.data as { evaluator?: string })?.evaluator).toBe("langevals/exact_match");
    });

    it("creates edges from agent mappings", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        ],
        agentMappings: {
          "agent-1": {
            input: { source: "dataset", sourceField: "input" },
          },
        },
      };

      const workflow = stateToWorkflow(state);

      const edge = workflow.edges.find((e) => e.target === "agent-1");
      expect(edge).toBeDefined();
      expect(edge?.source).toBe("entry");
      expect(edge?.sourceHandle).toBe("outputs.input");
      expect(edge?.targetHandle).toBe("inputs.input");
    });

    it("creates edges from evaluator mappings", () => {
      const state: EvaluationsV3State = {
        ...createInitialState(),
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
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
              { identifier: "expected_output", type: "str" },
            ],
          },
        ],
        evaluatorMappings: {
          "eval-1": {
            output: { source: "agent-1", sourceField: "output" },
            expected_output: { source: "dataset", sourceField: "expected_output" },
          },
        },
      };

      const workflow = stateToWorkflow(state);

      const edges = workflow.edges.filter((e) => e.target === "eval-1");
      expect(edges).toHaveLength(2);

      const outputEdge = edges.find((e) => e.targetHandle === "inputs.output");
      expect(outputEdge?.source).toBe("agent-1");

      const expectedEdge = edges.find(
        (e) => e.targetHandle === "inputs.expected_output"
      );
      expect(expectedEdge?.source).toBe("entry");
    });
  });

  describe("workflowToState", () => {
    it("extracts dataset from entry node", () => {
      const workflow: Workflow = {
        spec_version: "1.4",
        name: "Test",
        icon: "📊",
        description: "",
        version: "1.0",
        default_llm: { model: "openai/gpt-4o" },
        template_adapter: "default",
        enable_tracing: true,
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
              dataset: {
                inline: {
                  records: {
                    question: ["Q1", "Q2"],
                    answer: ["A1", "A2"],
                  },
                  columnTypes: [
                    { name: "question", type: "string" },
                    { name: "answer", type: "string" },
                  ],
                },
              },
            },
          },
        ],
        edges: [],
        state: {},
      };

      const state = workflowToState(workflow);

      expect(state.dataset?.columns).toHaveLength(2);
      expect(state.dataset?.records["question"]).toEqual(["Q1", "Q2"]);
    });

    it("extracts agents from signature nodes", () => {
      const workflow: Workflow = {
        spec_version: "1.4",
        name: "Test",
        icon: "📊",
        description: "",
        version: "1.0",
        default_llm: { model: "openai/gpt-4o" },
        template_adapter: "default",
        enable_tracing: true,
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
              parameters: [
                {
                  identifier: "llm",
                  type: "llm",
                  value: { model: "openai/gpt-4o" },
                },
                {
                  identifier: "instructions",
                  type: "str",
                  value: "Be helpful",
                },
              ],
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
        ],
        edges: [],
        state: {},
      };

      const state = workflowToState(workflow);

      expect(state.agents).toHaveLength(1);
      expect(state.agents?.[0]?.type).toBe("llm");
      expect(state.agents?.[0]?.name).toBe("My LLM");
      expect(state.agents?.[0]?.instructions).toBe("Be helpful");
    });

    it("extracts evaluators from evaluator nodes", () => {
      const workflow: Workflow = {
        spec_version: "1.4",
        name: "Test",
        icon: "📊",
        description: "",
        version: "1.0",
        default_llm: { model: "openai/gpt-4o" },
        template_adapter: "default",
        enable_tracing: true,
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
            id: "eval-1",
            type: "evaluator",
            position: { x: 600, y: 0 },
            data: {
              name: "Exact Match",
              cls: "LangWatchEvaluator",
              evaluator: "langevals/exact_match",
              parameters: [],
              inputs: [{ identifier: "output", type: "str" }],
              outputs: [],
            },
          },
        ],
        edges: [],
        state: {},
      };

      const state = workflowToState(workflow);

      expect(state.evaluators).toHaveLength(1);
      expect(state.evaluators?.[0]?.evaluatorType).toBe(
        "langevals/exact_match"
      );
    });

    it("extracts mappings from edges", () => {
      const workflow: Workflow = {
        spec_version: "1.4",
        name: "Test",
        icon: "📊",
        description: "",
        version: "1.0",
        default_llm: { model: "openai/gpt-4o" },
        template_adapter: "default",
        enable_tracing: true,
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
              parameters: [],
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            sourceHandle: "outputs.input",
            target: "agent-1",
            targetHandle: "inputs.input",
            type: "default",
          },
        ],
        state: {},
      };

      const state = workflowToState(workflow);

      expect(state.agentMappings?.["agent-1"]?.["input"]).toEqual({
        source: "dataset",
        sourceField: "input",
      });
    });
  });

  describe("hasStateChanged", () => {
    it("returns false for identical states", () => {
      const state = createInitialState();
      expect(hasStateChanged(state, state)).toBe(false);
    });

    it("returns true when name changes", () => {
      const prev = createInitialState();
      const current = { ...prev, name: "Different Name" };
      expect(hasStateChanged(prev, current)).toBe(true);
    });

    it("returns true when dataset changes", () => {
      const prev = createInitialState();
      const current = {
        ...prev,
        dataset: {
          ...prev.dataset,
          records: { input: ["new value"], expected_output: [] },
        },
      };
      expect(hasStateChanged(prev, current)).toBe(true);
    });

    it("returns true when agents change", () => {
      const prev = createInitialState();
      const current: EvaluationsV3State = {
        ...prev,
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "Agent",
            inputs: [],
            outputs: [],
          },
        ],
      };
      expect(hasStateChanged(prev, current)).toBe(true);
    });

    it("ignores UI state changes", () => {
      const prev = createInitialState();
      const current: EvaluationsV3State = {
        ...prev,
        ui: { openOverlay: "agent", overlayTargetId: "agent-1" },
      };
      expect(hasStateChanged(prev, current)).toBe(false);
    });

    it("ignores results changes", () => {
      const prev = createInitialState();
      const current: EvaluationsV3State = {
        ...prev,
        results: {
          ...prev.results,
          status: "running",
          progress: 50,
        },
      };
      expect(hasStateChanged(prev, current)).toBe(false);
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
        agents: [
          {
            id: "agent-1",
            type: "llm",
            name: "GPT Agent",
            llmConfig: { model: "openai/gpt-4o" },
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        ],
        agentMappings: {
          "agent-1": {
            input: { source: "dataset", sourceField: "input" },
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
          },
        ],
        evaluatorMappings: {
          "eval-1": {
            output: { source: "agent-1", sourceField: "output" },
            expected_output: { source: "dataset", sourceField: "expected" },
          },
        },
      };

      const workflow = stateToWorkflow(originalState);
      const restoredState = workflowToState(workflow);

      // Name should be preserved
      expect(restoredState.name).toBe(originalState.name);

      // Agents should be preserved
      expect(restoredState.agents).toHaveLength(1);
      expect(restoredState.agents?.[0]?.id).toBe("agent-1");
      expect(restoredState.agents?.[0]?.type).toBe("llm");

      // Evaluators should be preserved
      expect(restoredState.evaluators).toHaveLength(1);
      expect(restoredState.evaluators?.[0]?.id).toBe("eval-1");

      // Mappings should be preserved
      expect(restoredState.agentMappings?.["agent-1"]?.["input"]).toEqual(
        originalState.agentMappings["agent-1"]?.["input"]
      );
    });
  });
});
