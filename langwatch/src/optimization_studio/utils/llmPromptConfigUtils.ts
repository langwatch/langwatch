import type { Node } from "@xyflow/react";

import { parseLlmConfigVersion } from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import type { Signature } from "../types/dsl";

import type { PromptConfigFormValues } from "~/prompt-configs/hooks/usePromptConfigForm";

export function llmConfigToNodeData(
  config: LlmConfigWithLatestVersion
): Node<Signature>["data"] {
  const { latestVersion } = config;
  const version = parseLlmConfigVersion(latestVersion);

  return {
    // We need this to be able to update the config
    configId: config.id,
    name: config.name,
    inputs: version.configData.inputs,
    outputs: version.configData.outputs,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: version.configData.model,
      },
      {
        identifier: "instructions",
        type: "str",
        value: version.configData.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: version.configData.demonstrations,
      },
    ],
  };
}

export function promptConfigFormValuesToNodeData(
  configId: string,
  formValues: PromptConfigFormValues
): Node<Signature>["data"] {
  return {
    configId,
    name: formValues.name,
    inputs: formValues.version?.configData?.inputs,
    outputs: formValues.version?.configData?.outputs,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: formValues.version?.configData?.model,
      },
      {
        identifier: "instructions",
        type: "str",
        value: formValues.version?.configData?.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: formValues.version?.configData?.demonstrations,
      },
    ],
  };
}

export function nodeDataToPromptConfigFormValues(
  nodeData: Node<Signature>["data"]
): PromptConfigFormValues {
  return {
    name: nodeData.name ?? "",
    version: {
      commitMessage: "",
      configData: {
        inputs: nodeData.inputs ?? [],
        outputs: nodeData.outputs ?? [],
        model: nodeData.parameters?.find((p) => p.identifier === "llm")
          ?.value as string,
        prompt: nodeData.parameters?.find(
          (p) => p.identifier === "instructions"
        )?.value as string,
        demonstrations: nodeData.parameters?.find(
          (p) => p.identifier === "demonstrations"
        )
          ?.value as PromptConfigFormValues["version"]["configData"]["demonstrations"],
      },
    },
  };
}
