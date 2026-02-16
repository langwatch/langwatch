import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { LocalPromptConfig } from "~/evaluations-v3/types";
import type {
  Component,
  Evaluator,
  LlmPromptConfigComponent,
  Signature,
} from "../../types/dsl";
import { mergeLocalConfigsIntoDsl } from "../mergeLocalConfigs";

describe("mergeLocalConfigsIntoDsl()", () => {
  const createSignatureNode = ({
    localPromptConfig,
  }: {
    localPromptConfig?: LocalPromptConfig;
  }): Node<Component> => ({
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
          value: { model: "openai/gpt-4o", temperature: 1.0, max_tokens: 500 },
        },
        {
          identifier: "instructions",
          type: "str",
          value: "You are original.",
        },
        {
          identifier: "messages",
          type: "chat_messages",
          value: [{ role: "user", content: "Hello" }],
        },
      ],
      localPromptConfig,
    } as LlmPromptConfigComponent,
  });

  const createEvaluatorNode = ({
    localConfig,
  }: {
    localConfig?: Evaluator["localConfig"];
  }): Node<Component> => ({
    id: "eval-1",
    type: "evaluator",
    position: { x: 0, y: 0 },
    data: {
      name: "Original Evaluator",
      cls: "LangWatchEvaluator",
      evaluator: "langevals/exact_match",
      inputs: [{ identifier: "output", type: "str" }],
      outputs: [{ identifier: "passed", type: "bool" }],
      parameters: [
        { identifier: "threshold", type: "float", value: 0.5 },
      ],
      localConfig,
    } as Evaluator,
  });

  const createPlainNode = (): Node<Component> => ({
    id: "entry-1",
    type: "entry",
    position: { x: 0, y: 0 },
    data: {
      name: "Entry",
      outputs: [{ identifier: "input", type: "str" }],
    },
  });

  describe("when nodes have no local state", () => {
    it("returns nodes unchanged", () => {
      const nodes = [
        createPlainNode(),
        createSignatureNode({}),
        createEvaluatorNode({}),
      ];

      const result = mergeLocalConfigsIntoDsl(nodes);

      expect(result).toEqual(nodes);
    });
  });

  describe("when a signature node has localPromptConfig", () => {
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

    it("merges llm config into the llm parameter", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const llmParam = (result[0]!.data as LlmPromptConfigComponent)
        .parameters.find((p) => p.identifier === "llm");

      expect(llmParam?.value).toEqual({
        model: "openai/gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 2048,
      });
    });

    it("extracts system message into instructions parameter", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const instructionsParam = (result[0]!.data as LlmPromptConfigComponent)
        .parameters.find((p) => p.identifier === "instructions");

      expect(instructionsParam?.value).toBe("You are a local assistant.");
    });

    it("sets non-system messages into messages parameter", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const messagesParam = (result[0]!.data as LlmPromptConfigComponent)
        .parameters.find((p) => p.identifier === "messages");

      expect(messagesParam?.value).toEqual([
        { role: "user", content: "Answer: {{question}}" },
      ]);
    });

    it("replaces inputs with local config inputs", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const data = result[0]!.data as LlmPromptConfigComponent;

      expect(data.inputs).toEqual([
        { identifier: "question", type: "str" },
      ]);
    });

    it("replaces outputs with local config outputs", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const data = result[0]!.data as LlmPromptConfigComponent;

      expect(data.outputs).toEqual([
        { identifier: "answer", type: "str" },
        { identifier: "confidence", type: "float" },
      ]);
    });

    it("strips localPromptConfig from the output", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const data = result[0]!.data as Signature;

      expect(data.localPromptConfig).toBeUndefined();
    });

    it("does not mutate the original node", () => {
      const nodes = [createSignatureNode({ localPromptConfig })];
      const originalData = { ...nodes[0]!.data };
      mergeLocalConfigsIntoDsl(nodes);

      expect(nodes[0]!.data).toEqual(originalData);
    });
  });

  describe("when a signature node has localPromptConfig without system message", () => {
    it("sets instructions to empty string", () => {
      const localPromptConfig: LocalPromptConfig = {
        llm: { model: "openai/gpt-4o-mini" },
        messages: [{ role: "user", content: "Hello {{input}}" }],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      const nodes = [createSignatureNode({ localPromptConfig })];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const instructionsParam = (result[0]!.data as LlmPromptConfigComponent)
        .parameters.find((p) => p.identifier === "instructions");

      expect(instructionsParam?.value).toBe("");
    });
  });

  describe("when an evaluator node has localConfig", () => {
    it("merges name from localConfig", () => {
      const nodes = [
        createEvaluatorNode({
          localConfig: { name: "Custom Evaluator Name", settings: {} },
        }),
      ];
      const result = mergeLocalConfigsIntoDsl(nodes);

      expect(result[0]!.data.name).toBe("Custom Evaluator Name");
    });

    it("merges settings into parameters", () => {
      const nodes = [
        createEvaluatorNode({
          localConfig: {
            settings: { model: "openai/gpt-5", max_tokens: 1000 },
          },
        }),
      ];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const data = result[0]!.data as Evaluator;

      expect(data.parameters).toEqual([
        { identifier: "model", type: "str", value: "openai/gpt-5" },
        { identifier: "max_tokens", type: "str", value: 1000 },
      ]);
    });

    it("replaces existing parameters completely with settings", () => {
      const nodes = [
        createEvaluatorNode({
          localConfig: {
            settings: { new_param: "value" },
          },
        }),
      ];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const data = result[0]!.data as Evaluator;

      // Original had threshold parameter, should be replaced by settings
      expect(data.parameters).toEqual([
        { identifier: "new_param", type: "str", value: "value" },
      ]);
    });

    it("strips localConfig from the output", () => {
      const nodes = [
        createEvaluatorNode({
          localConfig: { name: "Test", settings: { foo: "bar" } },
        }),
      ];
      const result = mergeLocalConfigsIntoDsl(nodes);
      const data = result[0]!.data as Evaluator;

      expect(data.localConfig).toBeUndefined();
    });

    it("keeps original name when localConfig has no name", () => {
      const nodes = [
        createEvaluatorNode({
          localConfig: { settings: { foo: "bar" } },
        }),
      ];
      const result = mergeLocalConfigsIntoDsl(nodes);

      expect(result[0]!.data.name).toBe("Original Evaluator");
    });

    it("does not mutate the original node", () => {
      const nodes = [
        createEvaluatorNode({
          localConfig: { name: "Test", settings: { foo: "bar" } },
        }),
      ];
      const originalData = { ...nodes[0]!.data };
      mergeLocalConfigsIntoDsl(nodes);

      expect(nodes[0]!.data).toEqual(originalData);
    });
  });

  describe("when nodes include a mix of types", () => {
    it("only transforms nodes with local state", () => {
      const plainNode = createPlainNode();
      const sigNode = createSignatureNode({
        localPromptConfig: {
          llm: { model: "openai/gpt-4o-mini" },
          messages: [{ role: "user", content: "Hello" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      });
      const evalNode = createEvaluatorNode({
        localConfig: { name: "Updated", settings: { key: "val" } },
      });
      const plainSigNode = createSignatureNode({});

      const nodes = [plainNode, sigNode, evalNode, plainSigNode];
      const result = mergeLocalConfigsIntoDsl(nodes);

      // Plain node is unchanged
      expect(result[0]).toEqual(plainNode);
      // Signature with local config is transformed
      expect((result[1]!.data as Signature).localPromptConfig).toBeUndefined();
      // Evaluator with local config is transformed
      expect((result[2]!.data as Evaluator).localConfig).toBeUndefined();
      expect(result[2]!.data.name).toBe("Updated");
      // Signature without local config is unchanged
      expect(result[3]).toEqual(plainSigNode);
    });
  });
});
