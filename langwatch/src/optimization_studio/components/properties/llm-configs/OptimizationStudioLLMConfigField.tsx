import { useCallback } from "react";
import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "../../../../components/ModelSelector";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { LLMConfig } from "../../../types/dsl";
import { normalizeToSnakeCase } from "./normalizeToSnakeCase";

type OptimizationStudioLLMConfigFieldProps = {
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
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
}: OptimizationStudioLLMConfigFieldProps) {
  const model = llmConfig?.model ?? "";
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat",
  );

  const { hasCodeNodes } = useWorkflowStore((state) => ({
    hasCodeNodes: state.nodes.some((node) => node.type === "code"),
  }));

  const { modelProviders } = useOrganizationTeamProject();
  const hasCustomKeys = Object.values(modelProviders ?? {}).some(
    (modelProvider) =>
      model.split("/")[0] === modelProvider.provider &&
      modelProvider.customKeys,
  );
  const requiresCustomKey = hasCodeNodes && !hasCustomKeys;

  const handleChange = useCallback(
    (newLlmConfig: LLMConfig) => {
      onChange(normalizeToSnakeCase(newLlmConfig));
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
    />
  );
}
