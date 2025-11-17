import type { Node } from "@xyflow/react";
import { describe, it, expect } from "vitest";

import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";

import { isNodeDataEqual } from "../nodeDataComparison";

type NodeData = Node<LlmPromptConfigComponent>["data"];

const baseNodeData: NodeData = {
  handle: "test-prompt",
  inputs: [
    { identifier: "query", type: "str" },
    { identifier: "context", type: "str" },
  ],
  outputs: [{ identifier: "answer", type: "str" }],
  parameters: [
    {
      identifier: "llm",
      type: "llm",
      value: { model: "gpt-4", temperature: 0.7 },
    },
    { identifier: "instructions", type: "str", value: "Answer the question" },
    { identifier: "messages", type: "chat_messages", value: [] },
    {
      identifier: "prompting_technique",
      type: "prompting_technique",
      value: "cot",
    },
  ],
};

describe("isNodeDataEqual", () => {
  it("identical data", () => {
    expect(isNodeDataEqual(baseNodeData, baseNodeData)).toBe(true);
  });

  it("different parameter ordering", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        { identifier: "llm", type: "llm", value: { model: "gpt-4" } },
        { identifier: "instructions", type: "str", value: "test" },
        { identifier: "messages", type: "chat_messages", value: [] },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        { identifier: "messages", type: "chat_messages", value: [] },
        { identifier: "llm", type: "llm", value: { model: "gpt-4" } },
        { identifier: "instructions", type: "str", value: "test" },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("different input ordering", () => {
    const node1: NodeData = {
      ...baseNodeData,
      inputs: [
        { identifier: "query", type: "str" },
        { identifier: "context", type: "str" },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      inputs: [
        { identifier: "context", type: "str" },
        { identifier: "query", type: "str" },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("different output ordering", () => {
    const node1: NodeData = {
      ...baseNodeData,
      outputs: [
        { identifier: "answer", type: "str" },
        { identifier: "confidence", type: "float" },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      outputs: [
        { identifier: "confidence", type: "float" },
        { identifier: "answer", type: "str" },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("missing optional field: name", () => {
    const node1: NodeData = { ...baseNodeData, name: "My Prompt" };
    const node2: NodeData = { ...baseNodeData };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("missing optional field: configId", () => {
    const node1: NodeData = { ...baseNodeData, configId: "config-123" };
    const node2: NodeData = { ...baseNodeData };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("missing optional field: versionMetadata", () => {
    const node1: NodeData = {
      ...baseNodeData,
      versionMetadata: {
        versionId: "v1",
        versionNumber: 1,
        versionCreatedAt: new Date().toISOString(),
      },
    };
    const node2: NodeData = { ...baseNodeData };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("demonstrations: both only columns, different columns", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "1", name: "input", type: "string" }],
              records: {},
            },
          },
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "2", name: "input", type: "string" }],
              records: {},
            },
          },
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("demonstrations: both have records, same values", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "1", name: "input", type: "string" }],
              records: { "1": ["example"] },
            },
          },
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "2", name: "input", type: "string" }],
              records: { "1": ["example"] },
            },
          },
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("demonstrations: both have records, different values", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "1", name: "input", type: "string" }],
              records: { "1": ["example"] },
            },
          },
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "2", name: "input", type: "string" }],
              records: { "1": ["DIFFERENT"] },
            },
          },
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("demonstrations: one has only columns, one has records", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "1", name: "input", type: "string" }],
              records: {},
            },
          },
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              columnTypes: [{ id: "2", name: "input", type: "string" }],
              records: { "1": ["example"] },
            },
          },
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("demonstrations: one has demonstrations, other doesn't", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        ...baseNodeData.parameters,
        {
          identifier: "demonstrations",
          type: "dataset",
          value: { inline: { columnTypes: [], records: {} } },
        },
      ],
    };
    const node2: NodeData = { ...baseNodeData };
    expect(isNodeDataEqual(node1, node2)).toBe(true);
  });

  it("different handle", () => {
    const node1: NodeData = { ...baseNodeData, handle: "prompt-a" };
    const node2: NodeData = { ...baseNodeData, handle: "prompt-b" };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different parameter value", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: { model: "gpt-4", temperature: 0.7 },
        },
        { identifier: "instructions", type: "str", value: "Answer carefully" },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: { model: "gpt-4", temperature: 0.7 },
        },
        { identifier: "instructions", type: "str", value: "Answer quickly" },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different llm model", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        { identifier: "llm", type: "llm", value: { model: "gpt-4" } },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        { identifier: "llm", type: "llm", value: { model: "gpt-3.5-turbo" } },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different llm temperature", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: { model: "gpt-4", temperature: 0.7 },
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: { model: "gpt-4", temperature: 0.9 },
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different input identifier", () => {
    const node1: NodeData = {
      ...baseNodeData,
      inputs: [{ identifier: "query", type: "str" }],
    };
    const node2: NodeData = {
      ...baseNodeData,
      inputs: [{ identifier: "question", type: "str" }],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different input type", () => {
    const node1: NodeData = {
      ...baseNodeData,
      inputs: [{ identifier: "query", type: "str" }],
    };
    const node2: NodeData = {
      ...baseNodeData,
      inputs: [{ identifier: "query", type: "list[str]" }],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different number of inputs", () => {
    const node1: NodeData = {
      ...baseNodeData,
      inputs: [
        { identifier: "query", type: "str" },
        { identifier: "context", type: "str" },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      inputs: [{ identifier: "query", type: "str" }],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different output identifier", () => {
    const node1: NodeData = {
      ...baseNodeData,
      outputs: [{ identifier: "answer", type: "str" }],
    };
    const node2: NodeData = {
      ...baseNodeData,
      outputs: [{ identifier: "response", type: "str" }],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different output type", () => {
    const node1: NodeData = {
      ...baseNodeData,
      outputs: [{ identifier: "answer", type: "str" }],
    };
    const node2: NodeData = {
      ...baseNodeData,
      outputs: [{ identifier: "answer", type: "json_schema" }],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different number of outputs", () => {
    const node1: NodeData = {
      ...baseNodeData,
      outputs: [
        { identifier: "answer", type: "str" },
        { identifier: "confidence", type: "float" },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      outputs: [{ identifier: "answer", type: "str" }],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different parameter type", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [{ identifier: "instructions", type: "str", value: "test" }],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        // @ts-expect-error - invalid type
        {
          identifier: "instructions",
          type: "prompting_technique",
          value: "test",
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("missing parameter", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        { identifier: "llm", type: "llm", value: { model: "gpt-4" } },
        { identifier: "instructions", type: "str", value: "test" },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        { identifier: "llm", type: "llm", value: { model: "gpt-4" } },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different messages content", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "messages",
          type: "chat_messages",
          value: [{ role: "user", content: "Hello" }],
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "messages",
          type: "chat_messages",
          value: [{ role: "user", content: "Hi" }],
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });

  it("different prompting technique", () => {
    const node1: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "prompting_technique",
          type: "prompting_technique",
          value: "cot",
        },
      ],
    };
    const node2: NodeData = {
      ...baseNodeData,
      parameters: [
        {
          identifier: "prompting_technique",
          type: "prompting_technique",
          value: "few_shot",
        },
      ],
    };
    expect(isNodeDataEqual(node1, node2)).toBe(false);
  });
});
