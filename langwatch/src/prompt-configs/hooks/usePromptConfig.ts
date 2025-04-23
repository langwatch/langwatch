import {
  SchemaVersion,
  type LatestConfigVersionSchema,
} from "~/server/prompt-config/repositories/llm-config-version-schema";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Custom hook to abstract the logic of prompt config and version operations
 * with a simplified interface.
 * Enforces refresh of queries when mutations are successful.
 */
export const usePromptConfig = ({ configId }: { configId: string }) => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  // This is only so we can refetch the prompt configs list when a new version is created
  // Otherwise the rest of this logic is config specific
  const getPromptConfigsQuery = api.llmConfigs.getPromptConfigs.useQuery(
    { projectId },
    { enabled: !!projectId }
  );
  const updateConfig = api.llmConfigs.updatePromptConfig.useMutation();
  const createVersion = api.llmConfigs.versions.create.useMutation();

  const promptConfigQuery = api.llmConfigs.getByIdWithLatestVersion.useQuery(
    { projectId, id: configId },
    { enabled: false } // We don't want to fetch the prompt config, we only want to refetch it when a new version is created
  );
  const versionHistoryQuery =
    api.llmConfigs.versions.getVersionsForConfigById.useQuery(
      { projectId, configId },
      { enabled: false } // We don't want to fetch the version history, we only want to refetch it when a new version is created
    );

  const updatePromptNameIfChanged = async (name: string) => {
    if (!promptConfigQuery.data) return;
    if (promptConfigQuery.data.name === name) return;

    const config = await updateConfig.mutateAsync({
      projectId,
      id: configId,
      name,
    });
    await getPromptConfigsQuery.refetch();
    await promptConfigQuery.refetch();
    return config;
  };

  const createNewVersion = async (
    configData: LatestConfigVersionSchema["configData"],
    commitMessage: string
  ) => {
    const version = await createVersion.mutateAsync({
      projectId,
      configId,
      configData,
      commitMessage,
      schemaVersion: SchemaVersion.V1_0,
    });

    await getPromptConfigsQuery.refetch();
    await versionHistoryQuery.refetch();
    await promptConfigQuery.refetch();

    return version;
  };

  return {
    promptConfig: promptConfigQuery.data,
    updatePromptNameIfChanged,
    createNewVersion,
    isLoading:
      updateConfig.isLoading ||
      createVersion.isLoading ||
      promptConfigQuery.isLoading ||
      promptConfigQuery.isRefetching,
  };
};
