import { describe, expect, it } from "vitest";

import { mergeLocalConfigsIntoDsl } from "../src/merge-local-configs";
import type {
  AgentComponent,
  Evaluator,
  LlmPromptConfigComponent,
  LocalPromptConfig,
  StudioNode,
} from "../src/studio-workflow";

const localPromptConfig: LocalPromptConfig = {
  llm: {
    model: "openai/gpt-4o-mini",
    temperature: 0.5,
    maxTokens: 2048,
  },
  messages: [
    { role: "system", content: "You are a local assistant." },
    { role: "user", content: "Answer: {{question}}" },
  ],
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [
    { identifier: "answer", type: "str" },
    { identifier: "confidence", type: "float" },
  ],
};

function signatureNode(
  localConfig?: LocalPromptConfig,
): StudioNode<LlmPromptConfigComponent> {
  return {
    id: "sig-1",
    type: "signature",
    position: { x: 0, y: 0 },
    data: {
      name: "Original Prompt",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: { model: "openai/gpt-4o", temperature: 1, max_tokens: 500 },
        },
        { identifier: "instructions", type: "str", value: "You are original." },
        {
          identifier: "messages",
          type: "chat_messages",
          value: [{ role: "user", content: "Hello" }],
        },
      ],
      ...(localConfig ? { localPromptConfig: localConfig } : {}),
    },
  };
}

function evaluatorNode(localConfig?: Evaluator["localConfig"]): StudioNode<Evaluator> {
  return {
    id: "eval-1",
    type: "evaluator",
    position: { x: 0, y: 0 },
    data: {
      name: "Original Evaluator",
      cls: "LangWatchEvaluator",
      evaluator: "langevals/exact_match",
      inputs: [{ identifier: "output", type: "str" }],
      outputs: [{ identifier: "passed", type: "bool" }],
      parameters: [{ identifier: "threshold", type: "float", value: 0.5 }],
      ...(localConfig ? { localConfig } : {}),
    },
  };
}

function agentNode(
  localConfig?: AgentComponent["localConfig"],
): StudioNode<AgentComponent> {
  return {
    id: "agent-1",
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      name: "Code agent",
      agent: "agents/agent-1",
      agentType: "code",
      parameters: [
        { identifier: "agent_type", type: "str", value: "code" },
        { identifier: "code", type: "code", value: "print('saved')" },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      ...(localConfig ? { localConfig } : {}),
    },
  };
}

function first<T>(values: T[]): T {
  const value = values[0];
  if (value === void 0) {
    throw new Error("expected a transformed node");
  }

  return value;
}

describe("mergeLocalConfigsIntoDsl", () => {
  it("leaves nodes without local state unchanged", () => {
    const nodes = [signatureNode(), evaluatorNode()];

    expect(mergeLocalConfigsIntoDsl(nodes)).toEqual(nodes);
  });

  it("merges a local signature without mutating the source node", () => {
    const node = signatureNode(localPromptConfig);
    const original = structuredClone(node);
    const merged = first(mergeLocalConfigsIntoDsl([node]));

    expect(merged.data).toMatchObject({
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [
        { identifier: "answer", type: "str" },
        { identifier: "confidence", type: "float" },
      ],
      promptDraft: true,
    });
    expect(merged.data).toHaveProperty("localPromptConfig", void 0);
    expect(node).toEqual(original);
  });

  it("maps signature instructions and non-system messages", () => {
    const merged = first(mergeLocalConfigsIntoDsl([signatureNode(localPromptConfig)]));
    const data = merged.data;
    const instructions = data.parameters?.find(
      (parameter) => parameter.identifier === "instructions",
    );
    const messages = data.parameters?.find(
      (parameter) => parameter.identifier === "messages",
    );

    expect(instructions).toMatchObject({ value: "You are a local assistant." });
    expect(messages).toMatchObject({
      value: [{ role: "user", content: "Answer: {{question}}" }],
    });
  });

  it("uses an empty instruction when there is no system message", () => {
    const config = {
      ...localPromptConfig,
      messages: [{ role: "user", content: "Hello" }],
    } satisfies LocalPromptConfig;
    const merged = first(mergeLocalConfigsIntoDsl([signatureNode(config)]));
    const instructions = merged.data.parameters?.find(
      (parameter) => parameter.identifier === "instructions",
    );

    expect(instructions).toMatchObject({ value: "" });
  });

  it("merges evaluator names and settings into parameters", () => {
    const node = evaluatorNode({
      name: "Custom Evaluator",
      settings: { threshold: 0.8 },
    });
    const original = structuredClone(node);
    const merged = first(mergeLocalConfigsIntoDsl([node]));

    expect(merged.data).toMatchObject({
      name: "Custom Evaluator",
      parameters: [{ identifier: "threshold", type: "str", value: 0.8 }],
    });
    expect(merged.data).toHaveProperty("localConfig", void 0);
    expect(node).toEqual(original);
  });

  it("keeps the evaluator name when the local name is absent", () => {
    const merged = first(
      mergeLocalConfigsIntoDsl([evaluatorNode({ settings: { mode: "strict" } })]),
    );

    expect(merged.data).toMatchObject({ name: "Original Evaluator" });
  });

  it("overlays agent settings onto matching execution parameters", () => {
    const merged = first(
      mergeLocalConfigsIntoDsl([agentNode({ settings: { code: "print('draft')" } })]),
    );
    const code = merged.data.parameters?.find(
      (parameter) => parameter.identifier === "code",
    );

    expect(code).toMatchObject({ value: "print('draft')" });
    expect(merged.data.parameters).toContainEqual({
      identifier: "agent_type",
      type: "str",
      value: "code",
    });
    expect(merged.data).toHaveProperty("localConfig", void 0);
  });

  it("only transforms nodes carrying local state", () => {
    const plain = evaluatorNode();
    const nodes = [plain, signatureNode(localPromptConfig), agentNode()];
    const result = mergeLocalConfigsIntoDsl(nodes);

    expect(result[0]).toEqual(plain);
    expect(result[1]?.data).toHaveProperty("localPromptConfig", void 0);
    expect(result[2]).toEqual(nodes[2]);
  });
});
