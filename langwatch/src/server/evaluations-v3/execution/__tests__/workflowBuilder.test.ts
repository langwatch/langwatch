import { describe, expect, it } from "vitest";
import type { EvaluatorConfig, TargetConfig } from "~/evaluations-v3/types";
import type {
  HttpComponentConfig,
  SignatureComponentConfig,
} from "~/optimization_studio/types/dsl";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { ExecutionCell } from "../types";
import {
  buildCodeNodeFromAgent,
  buildEvaluatorNode,
  buildEvaluatorTargetNode,
  buildHttpNodeFromAgent,
  buildSignatureNodeFromAgent,
} from "../workflowBuilder";

describe("buildEvaluatorNode", () => {
  const createBasicEvaluatorConfig = (): EvaluatorConfig => ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      "dataset-1": {
        "target-1": {
          output: {
            type: "source",
            source: "target",
            sourceId: "target-1",
            sourceField: "output",
          },
          expected_output: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "expected",
          },
        },
      },
    },
  });

  const createBasicCell = (): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: {
      id: "target-1",
      type: "prompt",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    },
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      input: "test input",
      expected: "expected output",
    },
  });

  it("converts custom evaluator settings to parameters format", () => {
    const evaluator: EvaluatorConfig = {
      ...createBasicEvaluatorConfig(),
      evaluatorType: "langevals/llm_score",
    };
    const cell = createBasicCell();

    // Settings are passed from DB (6th parameter)
    const settings = {
      model: "openai/gpt-4o-mini",
      prompt: "Custom prompt for evaluation",
      max_tokens: 100,
    };

    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
      settings,
      undefined, // dbEvaluatorId
      "Custom LLM Score", // name
    );

    // Settings should be in parameters array (format expected by langwatch_nlp)
    const parameters = (node.data as Record<string, unknown>)
      .parameters as Array<{
      identifier: string;
      type: string;
      value: unknown;
    }>;
    expect(parameters).toBeDefined();
    expect(parameters.length).toBe(3);

    const modelParam = parameters.find((p) => p.identifier === "model");
    expect(modelParam?.value).toBe("openai/gpt-4o-mini");

    const promptParam = parameters.find((p) => p.identifier === "prompt");
    expect(promptParam?.value).toBe("Custom prompt for evaluation");

    const maxTokensParam = parameters.find(
      (p) => p.identifier === "max_tokens",
    );
    expect(maxTokensParam?.value).toBe(100);

    // Should still have required fields
    expect(node.data.evaluator).toBe("langevals/llm_score");
    expect(node.data.name).toBe("Custom LLM Score");
  });

  it("handles empty settings with empty parameters array", () => {
    const evaluator = createBasicEvaluatorConfig();
    const cell = createBasicCell();

    // No settings passed (defaults to empty)
    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
      {}, // settings
      undefined, // dbEvaluatorId
      "Exact Match", // name
    );

    // Should have empty parameters array when no settings
    const parameters = (node.data as Record<string, unknown>)
      .parameters as Array<{
      identifier: string;
      type: string;
      value: unknown;
    }>;
    expect(parameters).toEqual([]);

    // Should still have required fields
    expect(node.data.evaluator).toBe("langevals/exact_match");
    expect(node.data.name).toBe("Exact Match");
    expect(node.data.inputs).toHaveLength(2);
  });

  it("sets evaluator type correctly", () => {
    const evaluator = createBasicEvaluatorConfig();
    const cell = createBasicCell();

    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
    );

    expect(node.data.evaluator).toBe("langevals/exact_match");
  });

  it("sets standard evaluator outputs", () => {
    const evaluator = createBasicEvaluatorConfig();
    const cell = createBasicCell();

    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
    );

    expect(node.data.outputs?.map((o) => o.identifier)).toEqual([
      "passed",
      "score",
      "label",
    ]);
  });
});

describe("buildSignatureNodeFromAgent", () => {
  const createSignatureAgentWithTopLevelLlm = (): TypedAgent => ({
    id: "signature-agent-1",
    projectId: "project-1",
    name: "My Signature Agent",
    type: "signature",
    config: {
      name: "Test Signature",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      // Top-level LLM config (agent drawer format)
      llm: {
        model: "openai/gpt-4o",
        temperature: 0.7,
        max_tokens: 1024,
      },
      prompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "{{input}}" }],
    } as SignatureComponentConfig,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createSignatureAgentWithLlmInParameters = (): TypedAgent => ({
    id: "signature-agent-2",
    projectId: "project-1",
    name: "My Signature Agent",
    type: "signature",
    config: {
      name: "Test Signature",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      // LLM config in parameters array (workflow node format)
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: {
            model: "openai/gpt-4o-mini",
            temperature: 0.5,
            max_tokens: 2048,
          },
        },
        {
          identifier: "instructions",
          type: "str",
          value: "You are a helpful assistant.",
        },
      ],
    } as SignatureComponentConfig,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createTargetConfig = (): TargetConfig => ({
    id: "target-1",
    type: "agent",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "question",
        },
      },
    },
  });

  const createCell = (): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: createTargetConfig(),
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      question: "What is the capital of France?",
    },
  });

  it("creates signature node with correct type", () => {
    const agent = createSignatureAgentWithTopLevelLlm();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildSignatureNodeFromAgent(
      "target-1",
      agent,
      targetConfig,
      cell,
    );

    expect(node.type).toBe("signature");
  });

  it("includes top-level llm field in parameters array", () => {
    const agent = createSignatureAgentWithTopLevelLlm();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildSignatureNodeFromAgent(
      "target-1",
      agent,
      targetConfig,
      cell,
    );

    // LLM config should be in parameters array
    const llmParam = node.data.parameters?.find(
      (p) => p.identifier === "llm" && p.type === "llm",
    );
    expect(llmParam).toBeDefined();
    expect(llmParam?.value).toEqual({
      model: "openai/gpt-4o",
      temperature: 0.7,
      max_tokens: 1024,
    });
  });

  it("includes top-level prompt as instructions in parameters array", () => {
    const agent = createSignatureAgentWithTopLevelLlm();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildSignatureNodeFromAgent(
      "target-1",
      agent,
      targetConfig,
      cell,
    );

    // Prompt should be converted to instructions parameter
    const instructionsParam = node.data.parameters?.find(
      (p) => p.identifier === "instructions" && p.type === "str",
    );
    expect(instructionsParam).toBeDefined();
    expect(instructionsParam?.value).toBe("You are a helpful assistant.");
  });

  it("includes top-level messages in parameters array", () => {
    const agent = createSignatureAgentWithTopLevelLlm();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildSignatureNodeFromAgent(
      "target-1",
      agent,
      targetConfig,
      cell,
    );

    // Messages should be in parameters array
    const messagesParam = node.data.parameters?.find(
      (p) => p.identifier === "messages" && p.type === "chat_messages",
    );
    expect(messagesParam).toBeDefined();
    expect(messagesParam?.value).toEqual([
      { role: "user", content: "{{input}}" },
    ]);
  });

  it("preserves llm in parameters array when already present", () => {
    const agent = createSignatureAgentWithLlmInParameters();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildSignatureNodeFromAgent(
      "target-1",
      agent,
      targetConfig,
      cell,
    );

    // LLM config should still be from parameters array
    const llmParam = node.data.parameters?.find(
      (p) => p.identifier === "llm" && p.type === "llm",
    );
    expect(llmParam).toBeDefined();
    expect(llmParam?.value).toEqual({
      model: "openai/gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 2048,
    });

    // Should not duplicate llm parameter
    const llmParams = node.data.parameters?.filter(
      (p) => p.identifier === "llm" && p.type === "llm",
    );
    expect(llmParams).toHaveLength(1);
  });
});

describe("buildHttpNodeFromAgent", () => {
  const createHttpAgent = (): TypedAgent => ({
    id: "http-agent-1",
    projectId: "project-1",
    name: "My HTTP Agent",
    type: "http",
    config: {
      url: "https://api.example.com/chat",
      method: "POST",
      bodyTemplate: '{"input": "{{input}}", "thread_id": "{{threadId}}"}',
      outputPath: "$.response.content",
      headers: [{ key: "X-Custom", value: "test-value" }],
      timeoutMs: 5000,
    } as HttpComponentConfig,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createTargetConfig = (): TargetConfig => ({
    id: "target-1",
    type: "agent",
    inputs: [
      { identifier: "input", type: "str" },
      { identifier: "threadId", type: "str" },
    ],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "question",
        },
        threadId: {
          type: "value",
          value: "test-thread-123",
        },
      },
    },
  });

  const createCell = (): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: createTargetConfig(),
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      question: "What is the capital of France?",
    },
  });

  it("creates HTTP node with correct type", () => {
    const agent = createHttpAgent();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildHttpNodeFromAgent("target-1", agent, targetConfig, cell);

    expect(node.type).toBe("http");
  });

  it("extracts variables from body template as inputs", () => {
    const agent = createHttpAgent();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildHttpNodeFromAgent("target-1", agent, targetConfig, cell);

    // Should extract {{input}} and {{threadId}} from body template
    const inputIdentifiers = node.data.inputs?.map((i) => i.identifier);
    expect(inputIdentifiers).toContain("input");
    expect(inputIdentifiers).toContain("threadId");
  });

  it("applies value mappings to inputs", () => {
    const agent = createHttpAgent();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildHttpNodeFromAgent("target-1", agent, targetConfig, cell);

    // threadId has a value mapping, should have that value
    const threadIdInput = node.data.inputs?.find(
      (i) => i.identifier === "threadId",
    );
    expect(threadIdInput?.value).toBe("test-thread-123");

    // input has a source mapping, should have undefined value (comes from edge)
    const inputInput = node.data.inputs?.find((i) => i.identifier === "input");
    expect(inputInput?.value).toBeUndefined();
  });

  it("includes HTTP config in parameters array", () => {
    const agent = createHttpAgent();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildHttpNodeFromAgent("target-1", agent, targetConfig, cell);

    // HTTP config is stored in parameters (consistent with other node types)
    const params = node.data.parameters ?? [];
    const getParam = (id: string) => params.find((p) => p.identifier === id)?.value;

    expect(getParam("url")).toBe("https://api.example.com/chat");
    expect(getParam("method")).toBe("POST");
    expect(getParam("body_template")).toBe(
      '{"input": "{{input}}", "thread_id": "{{threadId}}"}',
    );
    expect(getParam("output_path")).toBe("$.response.content");
    expect(getParam("timeout_ms")).toBe(5000);
    expect(getParam("headers")).toEqual({ "X-Custom": "test-value" });
  });

  it("has single output named 'output'", () => {
    const agent = createHttpAgent();
    const targetConfig = createTargetConfig();
    const cell = createCell();

    const node = buildHttpNodeFromAgent("target-1", agent, targetConfig, cell);

    expect(node.data.outputs).toHaveLength(1);
    expect(node.data.outputs?.[0]?.identifier).toBe("output");
    expect(node.data.outputs?.[0]?.type).toBe("str");
  });
});

describe("buildEvaluatorTargetNode", () => {
  const createEvaluatorTargetConfig = (): TargetConfig => ({
    id: "target-eval-1",
    type: "evaluator",
    targetEvaluatorId: "eval-abc-123",
    inputs: [
      { identifier: "output", type: "str" },
    ],
    outputs: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
      { identifier: "label", type: "str" },
    ],
    mappings: {
      "dataset-1": {
        output: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "response",
        },
      },
    },
  });

  const createCell = (): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-eval-1",
    targetConfig: createEvaluatorTargetConfig(),
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      response: "This is a positive sentiment response!",
    },
  });

  it("creates evaluator node with target ID (not composite)", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    // Node ID should be the target ID, not a composite ID
    expect(node.id).toBe("target-eval-1");
    expect(node.id).not.toContain(".");
  });

  it("creates evaluator node with correct type", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    expect(node.type).toBe("evaluator");
  });

  it("uses evaluators/{id} path when dbEvaluatorId is set", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    expect(node.data.evaluator).toBe("evaluators/eval-abc-123");
  });

  it("throws error when targetEvaluatorId is not set", () => {
    const targetConfig: TargetConfig = {
      ...createEvaluatorTargetConfig(),
      targetEvaluatorId: undefined,
    };
    const cell: ExecutionCell = {
      ...createCell(),
      targetConfig,
    };

    expect(() =>
      buildEvaluatorTargetNode("target-eval-1", targetConfig, cell),
    ).toThrow(
      'Evaluator target "target-eval-1" has no evaluator ID. targetEvaluatorId must be set.',
    );
  });

  it("has standard evaluator outputs (passed, score, label)", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    expect(node.data.outputs?.map((o) => o.identifier)).toEqual([
      "passed",
      "score",
      "label",
    ]);
    expect(node.data.outputs?.map((o) => o.type)).toEqual([
      "bool",
      "float",
      "str",
    ]);
  });

  it("applies input mappings from dataset", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    // The 'output' input should NOT have a value (it comes from edge/dataset)
    const outputInput = node.data.inputs?.find(
      (i) => i.identifier === "output",
    );
    expect(outputInput).toBeDefined();
    // Source mappings are handled via edges, not value
    expect(outputInput?.value).toBeUndefined();
  });

  it("applies value mappings directly to inputs", () => {
    const targetConfig: TargetConfig = {
      ...createEvaluatorTargetConfig(),
      mappings: {
        "dataset-1": {
          output: {
            type: "value",
            value: "literal value for output",
          },
        },
      },
    };
    const cell: ExecutionCell = {
      ...createCell(),
      targetConfig,
    };

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    const outputInput = node.data.inputs?.find(
      (i) => i.identifier === "output",
    );
    expect(outputInput?.value).toBe("literal value for output");
  });

  it("loads settings from loadedEvaluators when available", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    // Mock loaded evaluators map with settings
    const loadedEvaluators = new Map([
      [
        "eval-abc-123",
        {
          id: "eval-abc-123",
          name: "Sentiment Evaluator",
          config: {
            evaluatorType: "langevals/sentiment",
            settings: {
              threshold: 0.8,
              model: "openai/gpt-4o-mini",
            },
          },
        },
      ],
    ]);

    const node = buildEvaluatorTargetNode(
      "target-eval-1",
      targetConfig,
      cell,
      loadedEvaluators,
    );

    // Settings should be converted to parameters
    const params = node.data.parameters ?? [];
    expect(params).toHaveLength(2);

    const thresholdParam = params.find((p) => p.identifier === "threshold");
    expect(thresholdParam?.value).toBe(0.8);

    const modelParam = params.find((p) => p.identifier === "model");
    expect(modelParam?.value).toBe("openai/gpt-4o-mini");
  });

  it("has cls set to LangWatchEvaluator", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    expect(node.data.cls).toBe("LangWatchEvaluator");
  });

  it("preserves target name from loaded evaluator", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    // Must provide loadedEvaluators to get the evaluator name
    const loadedEvaluators = new Map([
      [
        "eval-abc-123",
        {
          id: "eval-abc-123",
          name: "Sentiment Evaluator",
          config: {},
        },
      ],
    ]);

    const node = buildEvaluatorTargetNode(
      "target-eval-1",
      targetConfig,
      cell,
      loadedEvaluators,
    );

    expect(node.data.name).toBe("Sentiment Evaluator");
  });

  it("falls back to nodeId when evaluator not loaded", () => {
    const targetConfig = createEvaluatorTargetConfig();
    const cell = createCell();

    const node = buildEvaluatorTargetNode("target-eval-1", targetConfig, cell);

    expect(node.data.name).toBe("target-eval-1");
  });

});
