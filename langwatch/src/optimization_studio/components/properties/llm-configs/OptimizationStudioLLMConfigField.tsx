import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "../../../../components/ModelSelector";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { LLMConfig } from "../../../types/dsl";

/**
 * LLM Config field for the Optimization Studio
 * Specific to the optimization studio store
 */
export function OptimizationStudioLLMConfigField({
  allowDefault = undefined,
  llmConfig,
  defaultLLMConfig = undefined,
  onChange,
}:
  | {
      allowDefault: true;
      llmConfig?: LLMConfig | undefined;
      defaultLLMConfig: LLMConfig;
      onChange: (llmConfig: LLMConfig | undefined) => void;
    }
  | {
      allowDefault?: undefined;
      llmConfig: LLMConfig;
      defaultLLMConfig?: undefined;
      onChange: (llmConfig: LLMConfig) => void;
    }) {
  const model = llmConfig?.model ?? defaultLLMConfig?.model ?? "";
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat"
  );

  const { hasCodeNodes } = useWorkflowStore((state) => ({
    hasCodeNodes: state.nodes.some((node) => node.type === "code"),
  }));

  const { modelProviders } = useOrganizationTeamProject();
  const hasCustomKeys = Object.values(modelProviders ?? {}).some(
    (modelProvider) =>
      model.split("/")[0] === modelProvider.provider && modelProvider.customKeys
  );
  const requiresCustomKey = hasCodeNodes && !hasCustomKeys;

  return (
    <LLMConfigField
      allowDefault={allowDefault}
      llmConfig={llmConfig ?? defaultLLMConfig!}
      onChange={onChange}
      modelOption={modelOption}
      requiresCustomKey={requiresCustomKey}
    />
  );
}
