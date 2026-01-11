import { describe, it, expect } from "vitest";
import {
  buildCellWorkflow,
  buildSignatureNodeFromLocalConfig,
  buildSignatureNodeFromPrompt,
  buildCodeNodeFromAgent,
  buildEvaluatorNode,
} from "../workflowBuilder";
import type { WorkflowBuilderInput, ExecutionCell } from "../types";
import type { TargetConfig, EvaluatorConfig, LocalPromptConfig } from "~/evaluations-v3/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";

describe("WorkflowBuilder", () => {
  const createBasicLocalPromptConfig = (): LocalPromptConfig => ({
    llm: {
      model: "openai/gpt-4o-mini",
      temperature: 0,
      maxTokens: 1024,
    },
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Answer: {{input}}" },
    ],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  });

  const createBasicTargetConfig = (overrides?: Partial<TargetConfig>): TargetConfig => ({
    id: "target-1",
    type: "prompt",
    name: "Test Prompt",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "user_input" },
      },
    },
    localPromptConfig: createBasicLocalPromptConfig(),
    ...overrides,
  });

  const createBasicEvaluatorConfig = (): EvaluatorConfig => ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match",
    name: "Exact Match",
    settings: {},
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      "dataset-1": {
        "target-1": {
          output: { type: "source", source: "target", sourceId: "target-1", sourceField: "output" },
          expected_output: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "expected" },
        },
      },
    },
  });

  const createBasicCell = (overrides?: Partial<ExecutionCell>): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: createBasicTargetConfig(),
    evaluatorConfigs: [createBasicEvaluatorConfig()],
    datasetEntry: {
      _datasetId: "dataset-1",
      user_input: "What is 2+2?",
      expected: "4",
    },
    ...overrides,
  });

  const createBasicInput = (overrides?: Partial<WorkflowBuilderInput>): WorkflowBuilderInput => ({
    projectId: "test-project",
    cell: createBasicCell(),
    datasetColumns: [
      { id: "user_input", name: "user_input", type: "string" },
      { id: "expected", name: "expected", type: "string" },
    ],
    ...overrides,
  });

  describe("buildCellWorkflow", () => {
    it("builds workflow with entry, target, and evaluator nodes", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      expect(result.workflow.nodes).toHaveLength(3);
      expect(result.workflow.nodes.map((n) => n.type)).toEqual(["entry", "signature", "evaluator"]);
    });

    it("sets correct workflow metadata", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      expect(result.workflow.spec_version).toBe("1.4");
      expect(result.workflow.name).toContain("Evaluation V3");
      expect(result.workflow.enable_tracing).toBe(true);
    });

    it("returns target and evaluator node IDs", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      expect(result.targetNodeId).toBe("target-1");
      expect(result.evaluatorNodeIds).toEqual({ "eval-1": "target-1.eval-1" });
    });

    it("builds edges connecting entry to target", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      const entryToTargetEdge = result.workflow.edges.find(
        (e) => e.source === "entry" && e.target === "target-1"
      );
      expect(entryToTargetEdge).toBeDefined();
    });

    it("builds edges connecting target to evaluator", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      const targetToEvalEdge = result.workflow.edges.find(
        (e) => e.source === "target-1" && e.target === "target-1.eval-1"
      );
      expect(targetToEvalEdge).toBeDefined();
    });

    it("builds edges connecting entry to evaluator for expected_output", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      const entryToEvalEdge = result.workflow.edges.find(
        (e) => e.source === "entry" && e.target === "target-1.eval-1"
      );
      expect(entryToEvalEdge).toBeDefined();
    });
  });

  describe("buildSignatureNodeFromLocalConfig", () => {
    it("builds signature node with correct structure", () => {
      const config = createBasicLocalPromptConfig();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromLocalConfig(
        "test-node",
        "Test Prompt",
        config,
        targetConfig,
        cell
      );

      expect(node.id).toBe("test-node");
      expect(node.type).toBe("signature");
      expect(node.data.name).toBe("Test Prompt");
    });

    it("sets LLM config correctly", () => {
      const config = createBasicLocalPromptConfig();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromLocalConfig(
        "test-node",
        "Test Prompt",
        config,
        targetConfig,
        cell
      );

      const llmParam = (node.data as LlmPromptConfigComponent).parameters.find(
        (p) => p.identifier === "llm"
      );
      expect(llmParam?.value).toEqual({
        model: "openai/gpt-4o-mini",
        temperature: 0,
        max_tokens: 1024,
        litellm_params: undefined,
      });
    });

    it("extracts system message as instructions", () => {
      const config = createBasicLocalPromptConfig();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromLocalConfig(
        "test-node",
        "Test Prompt",
        config,
        targetConfig,
        cell
      );

      const instructionsParam = (node.data as LlmPromptConfigComponent).parameters.find(
        (p) => p.identifier === "instructions"
      );
      expect(instructionsParam?.value).toBe("You are a helpful assistant.");
    });

    it("sets non-system messages", () => {
      const config = createBasicLocalPromptConfig();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromLocalConfig(
        "test-node",
        "Test Prompt",
        config,
        targetConfig,
        cell
      );

      const messagesParam = (node.data as LlmPromptConfigComponent).parameters.find(
        (p) => p.identifier === "messages"
      );
      expect(messagesParam?.value).toEqual([
        { role: "user", content: "Answer: {{input}}" },
      ]);
    });

    it("sets inputs and outputs", () => {
      const config = createBasicLocalPromptConfig();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromLocalConfig(
        "test-node",
        "Test Prompt",
        config,
        targetConfig,
        cell
      );

      expect(node.data.inputs).toHaveLength(1);
      expect(node.data.inputs?.[0]?.identifier).toBe("input");
      expect(node.data.outputs).toHaveLength(1);
      expect(node.data.outputs?.[0]?.identifier).toBe("output");
    });
  });

  describe("buildSignatureNodeFromPrompt", () => {
    const createMockPrompt = (): VersionedPrompt => ({
      id: "prompt-1",
      name: "Test Prompt",
      handle: "test-prompt",
      scope: "PROJECT",
      version: 1,
      versionId: "version-1",
      versionCreatedAt: new Date(),
      model: "openai/gpt-4o",
      temperature: 0.7,
      maxTokens: 2048,
      prompt: "You are a helpful assistant.",
      projectId: "project-1",
      organizationId: "org-1",
      messages: [
        { role: "user", content: "Hello {{input}}" },
      ],
      authorId: null,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it("builds signature node from database prompt", () => {
      const prompt = createMockPrompt();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromPrompt(
        "test-node",
        prompt,
        targetConfig,
        cell
      );

      expect(node.id).toBe("test-node");
      expect(node.type).toBe("signature");
      expect(node.data.name).toBe("test-prompt");
    });

    it("uses prompt model and settings", () => {
      const prompt = createMockPrompt();
      const targetConfig = createBasicTargetConfig();
      const cell = createBasicCell();

      const node = buildSignatureNodeFromPrompt(
        "test-node",
        prompt,
        targetConfig,
        cell
      );

      const llmParam = (node.data as LlmPromptConfigComponent).parameters.find(
        (p) => p.identifier === "llm"
      );
      expect(llmParam?.value).toEqual({
        model: "openai/gpt-4o",
        temperature: 0.7,
        max_tokens: 2048,
      });
    });
  });

  describe("buildEvaluatorNode", () => {
    it("builds evaluator node with correct type", () => {
      const evaluator = createBasicEvaluatorConfig();
      const cell = createBasicCell();

      const node = buildEvaluatorNode(evaluator, "target-1.eval-1", "target-1", cell, 0);

      expect(node.id).toBe("target-1.eval-1");
      expect(node.type).toBe("evaluator");
      expect(node.data.cls).toBe("LangWatchEvaluator");
    });

    it("sets evaluator type", () => {
      const evaluator = createBasicEvaluatorConfig();
      const cell = createBasicCell();

      const node = buildEvaluatorNode(evaluator, "target-1.eval-1", "target-1", cell, 0);

      expect(node.data.evaluator).toBe("exact_match");
    });

    it("sets evaluator inputs", () => {
      const evaluator = createBasicEvaluatorConfig();
      const cell = createBasicCell();

      const node = buildEvaluatorNode(evaluator, "target-1.eval-1", "target-1", cell, 0);

      expect(node.data.inputs).toHaveLength(2);
      expect(node.data.inputs?.map((i) => i.identifier)).toEqual(["output", "expected_output"]);
    });

    it("sets standard evaluator outputs", () => {
      const evaluator = createBasicEvaluatorConfig();
      const cell = createBasicCell();

      const node = buildEvaluatorNode(evaluator, "target-1.eval-1", "target-1", cell, 0);

      expect(node.data.outputs?.map((o) => o.identifier)).toEqual(["passed", "score", "label"]);
    });
  });

  describe("entry node", () => {
    it("entry node contains dataset values", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      const entryNode = result.workflow.nodes.find((n) => n.type === "entry");
      expect(entryNode?.data.outputs).toBeDefined();

      const userInputOutput = entryNode?.data.outputs?.find(
        (o) => o.identifier === "user_input"
      );
      expect(userInputOutput?.value).toBe("What is 2+2?");

      const expectedOutput = entryNode?.data.outputs?.find(
        (o) => o.identifier === "expected"
      );
      expect(expectedOutput?.value).toBe("4");
    });

    it("entry node has inline dataset with row data", () => {
      const input = createBasicInput();
      const result = buildCellWorkflow(input, {});

      const entryNode = result.workflow.nodes.find((n) => n.type === "entry");
      const dataset = (entryNode?.data as any).dataset;

      expect(dataset?.inline?.records?.user_input).toEqual(["What is 2+2?"]);
      expect(dataset?.inline?.records?.expected).toEqual(["4"]);
    });
  });

  describe("multiple evaluators", () => {
    it("creates separate nodes for each evaluator", () => {
      const evaluator2: EvaluatorConfig = {
        id: "eval-2",
        evaluatorType: "ragas/faithfulness",
        name: "Faithfulness",
        settings: {},
        inputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "dataset-1": {
            "target-1": {
              output: { type: "source", source: "target", sourceId: "target-1", sourceField: "output" },
            },
          },
        },
      };

      const cell = createBasicCell({
        evaluatorConfigs: [createBasicEvaluatorConfig(), evaluator2],
      });
      const input = createBasicInput({ cell });
      const result = buildCellWorkflow(input, {});

      const evaluatorNodes = result.workflow.nodes.filter((n) => n.type === "evaluator");
      expect(evaluatorNodes).toHaveLength(2);
      expect(evaluatorNodes.map((n) => n.id)).toEqual(["target-1.eval-1", "target-1.eval-2"]);
    });
  });

  describe("buildCodeNodeFromAgent", () => {
    const createMockAgent = (): TypedAgent => ({
      id: "agent-1",
      name: "Test Code Agent",
      projectId: "project-1",
      type: "code",
      config: {
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "result", type: "str" }],
        parameters: [
          {
            identifier: "code",
            type: "code",
            value: "return input.upper()",
          },
        ],
      },
      workflowId: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it("builds code node from agent", () => {
      const agent = createMockAgent();
      const targetConfig = createBasicTargetConfig({
        type: "agent",
        localPromptConfig: undefined,
        dbAgentId: "agent-1",
      });
      const cell = createBasicCell({ targetConfig });

      const node = buildCodeNodeFromAgent("test-node", agent, targetConfig, cell);

      expect(node.id).toBe("test-node");
      expect(node.type).toBe("code");
      expect(node.data.name).toBe("Test Code Agent");
    });

    it("sets inputs and outputs from agent config", () => {
      const agent = createMockAgent();
      const targetConfig = createBasicTargetConfig({
        type: "agent",
        localPromptConfig: undefined,
        dbAgentId: "agent-1",
      });
      const cell = createBasicCell({ targetConfig });

      const node = buildCodeNodeFromAgent("test-node", agent, targetConfig, cell);

      expect(node.data.inputs).toHaveLength(1);
      expect(node.data.inputs?.[0]?.identifier).toBe("input");
      expect(node.data.outputs).toHaveLength(1);
      expect(node.data.outputs?.[0]?.identifier).toBe("result");
    });

    it("preserves agent parameters", () => {
      const agent = createMockAgent();
      const targetConfig = createBasicTargetConfig({
        type: "agent",
        localPromptConfig: undefined,
        dbAgentId: "agent-1",
      });
      const cell = createBasicCell({ targetConfig });

      const node = buildCodeNodeFromAgent("test-node", agent, targetConfig, cell);

      expect(node.data.parameters).toBeDefined();
      expect(node.data.parameters?.length).toBeGreaterThan(0);
    });

    it("uses loaded agent when building workflow for agent target", () => {
      const agent = createMockAgent();
      const targetConfig = createBasicTargetConfig({
        type: "agent",
        localPromptConfig: undefined,
        dbAgentId: "agent-1",
        outputs: [{ identifier: "result", type: "str" }],
      });
      const cell = createBasicCell({ targetConfig });
      const input = createBasicInput({ cell });

      const result = buildCellWorkflow(input, { agent });

      const codeNode = result.workflow.nodes.find((n) => n.type === "code");
      expect(codeNode).toBeDefined();
      expect(codeNode?.data.name).toBe("Test Code Agent");
    });
  });

  describe("error cases", () => {
    it("throws when prompt target has no local config or loaded prompt", () => {
      const targetConfig = createBasicTargetConfig({ localPromptConfig: undefined });
      const cell = createBasicCell({ targetConfig });
      const input = createBasicInput({ cell });

      expect(() => buildCellWorkflow(input, {})).toThrow(
        "Prompt target target-1 has no local config and no loaded prompt"
      );
    });

    it("throws when agent target has no loaded agent", () => {
      const targetConfig = createBasicTargetConfig({
        type: "agent",
        localPromptConfig: undefined,
        dbAgentId: "agent-1",
      });
      const cell = createBasicCell({ targetConfig });
      const input = createBasicInput({ cell });

      expect(() => buildCellWorkflow(input, {})).toThrow(
        "Agent target target-1 has no loaded agent"
      );
    });
  });
});
