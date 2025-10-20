import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { buildDefaultFormValues } from "~/prompt-configs/utils/buildDefaultFormValues";
import {
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompt-configs/utils/llmPromptConfigUtils";
import { useMemo } from "react";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

export const usePromptQueryForFormValues = (params: {
  configId?: string;
  useSystemMessage?: boolean;
}) => {
  const { configId = "", useSystemMessage } = params;
  const { projectId = "", project } = useOrganizationTeamProject();
  const defaultModel = project?.defaultModel;

  // Fetch the LLM configuration
  const { data: prompt, isLoading } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: configId,
      projectId,
    },
    {
      enabled: !!projectId && !!configId,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    },
  );

  // ---- Form setup and configuration ----
  // Transform the LLM config into form values
  const initialConfigValues: PromptConfigFormValues = useMemo(
    () => {
      // If prompt is found, use the prompt values
      return prompt
        ? useSystemMessage
          ? versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt)
          : versionedPromptToPromptConfigFormValues(prompt)
        : // If default model is set, use the default model merged with the default values
        typeof defaultModel === "string"
        ? buildDefaultFormValues({
            version: { configData: { llm: { model: defaultModel } } },
          })
        : // If no default model is set, use the default values
          buildDefaultFormValues({});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(prompt), defaultModel, configId],
  );

  return {
    isLoading,
    initialConfigValues,
  };
};
