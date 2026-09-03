import { z } from "zod";

import {
  fieldSchema,
  localPromptConfigSchema,
  type AgentComponent,
  type Component,
  type Evaluator,
  type Field,
  type LlmPromptConfigComponent,
  type LocalPromptConfig,
  type Signature,
  type StudioNode,
} from "./studio-workflow";
import { buildWorkflowLlmConfig } from "./workflow-llm-config";

type LocalComponentConfig = {
  name?: string;
  settings?: Record<string, unknown>;
};

const localComponentConfigSchema = z.object({
  name: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Convert editor-only local state into the execution DSL without mutating the
 * graph. The local fields are deliberately removed before dispatch.
 */
export function mergeLocalConfigsIntoDsl(nodes: StudioNode<Component>[]): StudioNode<Component>[] {
  return nodes.map((node) => {
    if (node.type === "signature" && hasLocalPromptConfig(node.data)) {
      return mergeSignatureLocalConfig(node);
    }

    if (node.type === "evaluator" && hasLocalConfig(node.data)) {
      return mergeEvaluatorLocalConfig(node);
    }

    if (node.type === "agent" && hasAgentLocalConfig(node.data)) {
      return mergeAgentLocalConfig(node);
    }

    return node;
  });
}

function mergeSignatureLocalConfig(node: StudioNode<Component>): StudioNode<Component> {
  if (!isSignature(node.data)) {
    return node;
  }

  const data = node.data;
  const local = localPromptConfigSchema.parse(data.localPromptConfig);
  const systemMessage = local.messages.find((message) => message.role === "system");
  const nonSystemMessages = local.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const parameters: LlmPromptConfigComponent["parameters"] = [
    {
      identifier: "llm",
      type: "llm",
      value: buildWorkflowLlmConfig(local.llm),
    },
    {
      identifier: "instructions",
      type: "str",
      value: systemMessage?.content ?? "",
    },
    {
      identifier: "messages",
      type: "chat_messages",
      value: nonSystemMessages,
    },
  ];
  const outputs: LlmPromptConfigComponent["outputs"] = local.outputs.map((output) => {
    const field = fieldSchema.parse(output);

    return { ...field, type: output.type };
  });
  const mergedData: LlmPromptConfigComponent = {
    ...data,
    inputs: local.inputs,
    outputs,
    parameters,
    localPromptConfig: void 0,
    promptDraft: true,
  };

  return { ...node, data: mergedData };
}

function mergeEvaluatorLocalConfig(node: StudioNode<Component>): StudioNode<Component> {
  if (!isEvaluator(node.data)) {
    return node;
  }

  const data = node.data;
  const local = parseLocalComponentConfig(data.localConfig);
  const parameters: Field[] = Object.entries(local.settings ?? {}).map(([identifier, value]) => ({
    identifier,
    type: "str",
    value,
  }));

  return {
    ...node,
    data: {
      ...data,
      name: local.name ?? data.name,
      parameters,
      localConfig: void 0,
    },
  };
}

const AGENT_SETTING_TO_PARAMETER: Record<string, string> = {
  code: "code",
  url: "url",
  method: "method",
  bodyTemplate: "body_template",
  outputPath: "output_path",
};

function mergeAgentLocalConfig(node: StudioNode<Component>): StudioNode<Component> {
  if (!isAgent(node.data)) {
    return node;
  }

  const data = node.data;
  const local = parseLocalComponentConfig(data.localConfig);
  const settings = local.settings ?? {};
  const parameters: Field[] = (data.parameters ?? []).map((parameter) => {
    const settingKey = Object.entries(AGENT_SETTING_TO_PARAMETER).find(
      ([, identifier]) => identifier === parameter.identifier,
    )?.[0];

    if (settingKey && settings[settingKey] !== void 0) {
      return { ...parameter, value: settings[settingKey] };
    }

    return parameter;
  });

  return {
    ...node,
    data: {
      ...data,
      name: local.name ?? data.name,
      parameters,
      localConfig: void 0,
    },
  };
}

function isSignature(
  data: Component,
): data is Signature & { localPromptConfig: LocalPromptConfig } {
  return (
    "localPromptConfig" in data &&
    data.localPromptConfig !== null &&
    data.localPromptConfig !== void 0
  );
}

function hasLocalPromptConfig(
  data: Component,
): data is Signature & { localPromptConfig: LocalPromptConfig } {
  return isSignature(data);
}

function isEvaluator(data: Component): data is Evaluator & { localConfig: LocalComponentConfig } {
  return "localConfig" in data && data.localConfig !== null && data.localConfig !== void 0;
}

function hasLocalConfig(
  data: Component,
): data is Evaluator & { localConfig: LocalComponentConfig } {
  return isEvaluator(data);
}

function isAgent(data: Component): data is AgentComponent & { localConfig: LocalComponentConfig } {
  return "localConfig" in data && data.localConfig !== null && data.localConfig !== void 0;
}

function hasAgentLocalConfig(
  data: Component,
): data is AgentComponent & { localConfig: LocalComponentConfig } {
  return isAgent(data);
}

function parseLocalComponentConfig(value: unknown): LocalComponentConfig {
  return localComponentConfigSchema.parse(value);
}
