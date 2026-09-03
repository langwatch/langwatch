import { useCallback } from "react";
import type { Output } from "@langwatch/prompt-web/components/llmPromptConfigs/LLMConfigPopover";
import { LLMConfigField } from "@langwatch/prompt-web/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "@langwatch/model-provider-web/components/ModelSelector";
import { useOrganizationTeamProject } from "../../../../../behavior/studio-host/use-organization-team-project";
import { useWorkflowStore } from "@langwatch/workflow-web";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { normalizeWorkflowLlmConfig } from "@langwatch/workflow-contract";

type OptimizationStudioLLMConfigFieldProps = {
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
  /** Outputs configuration (for structured outputs) */
  outputs?: Output[];
  /** Callback when outputs change */
  onOutputsChange?: (outputs: Output[]) => void;
  /** Whether to show the structured outputs section */
  showStructuredOutputs?: boolean;
};

/**
 * LLM Config field for the Optimization Studio
 * Specific to the optimization studio store
 *
 * Ensures all LLM configs are normalized to snake_case format (max_tokens)
 * as required by the optimization studio DSL schema.
 */
export function OptimizationStudioLLMConfigField({
  llmConfig,
  onChange,
  showProviderKeyMessage = true,
  outputs,
  onOutputsChange,
  showStructuredOutputs = false,
}: OptimizationStudioLLMConfigFieldProps) {
  const model = llmConfig?.model ?? "";
  const { modelOption, isEmpty } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat",
  );

  const { hasCodeNodes } = useWorkflowStore((state) => ({
    hasCodeNodes: state.nodes.some((node) => node.type === "code"),
  }));

  const { modelProviders } = useOrganizationTeamProject();
  const providerIsConfigured = Object.values(modelProviders ?? {}).some(
    (modelProvider: any) =>
      model.split("/")[0] === modelProvider.provider &&
      (modelProvider.enabled || modelProvider.customKeys),
  );
  const requiresCustomKey = hasCodeNodes && !providerIsConfigured;

  const handleChange = useCallback(
    (newLlmConfig: LLMConfig) => {
      onChange(normalizeWorkflowLlmConfig(newLlmConfig));
    },
    [onChange],
  );

  return (
    <LLMConfigField
      llmConfig={llmConfig}
      onChange={handleChange}
      modelOption={modelOption}
      requiresCustomKey={requiresCustomKey}
      showProviderKeyMessage={showProviderKeyMessage}
      outputs={outputs}
      onOutputsChange={onOutputsChange}
      showStructuredOutputs={showStructuredOutputs}
      noModelsConfigured={isEmpty}
    />
  );
}
