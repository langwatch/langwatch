import { useCallback } from "react";
import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "../../../../components/ModelSelector";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { LLMConfig } from "../../../types/dsl";

/**
 * Normalizes LLM config to snake_case format required by optimization studio DSL
 */
function normalizeToSnakeCase(
  llmConfig: LLMConfig & { maxTokens?: number },
): LLMConfig {
  const normalized: LLMConfig = {
    model: llmConfig.model,
  };

  if (llmConfig.temperature !== undefined) {
    normalized.temperature = llmConfig.temperature;
  }

  // Prefer maxTokens if present, otherwise use max_tokens
  const maxTokens = (llmConfig as any).maxTokens ?? llmConfig.max_tokens;
  if (maxTokens !== undefined) {
    normalized.max_tokens = maxTokens;
  }

  if (llmConfig.litellm_params !== undefined) {
    normalized.litellm_params = llmConfig.litellm_params;
  }

  return normalized;
}

/**
 * LLM Config field for the Optimization Studio
 * Specific to the optimization studio store
 *
 * Ensures all LLM configs are normalized to snake_case format (max_tokens)
 * as required by the optimization studio DSL schema.
 */
export function OptimizationStudioLLMConfigField({
  allowDefault = undefined,
  llmConfig,
  defaultLLMConfig = undefined,
  onChange,
  showProviderKeyMessage = true,
}:
  | {
      allowDefault: true;
      llmConfig?: LLMConfig | undefined;
      defaultLLMConfig: LLMConfig;
      onChange: (llmConfig: LLMConfig | undefined) => void;
      showProviderKeyMessage?: boolean;
    }
  | {
      allowDefault?: undefined;
      llmConfig: LLMConfig;
      defaultLLMConfig?: undefined;
      onChange: (llmConfig: LLMConfig) => void;
      showProviderKeyMessage?: boolean;
    }) {
  const model = llmConfig?.model ?? defaultLLMConfig?.model ?? "";
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
    (newLlmConfig: LLMConfig | undefined) => {
      if (newLlmConfig === undefined) {
        onChange(undefined as any);
      } else {
        onChange(normalizeToSnakeCase(newLlmConfig));
      }
    },
    [onChange],
  );

  return (
    <LLMConfigField
      allowDefault={allowDefault}
      llmConfig={llmConfig ?? defaultLLMConfig!}
      onChange={handleChange}
      modelOption={modelOption}
      requiresCustomKey={requiresCustomKey}
      showProviderKeyMessage={showProviderKeyMessage}
    />
  );
}
