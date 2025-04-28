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
export const usePromptConfig = () => {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const updateConfig = api.llmConfigs.updatePromptConfig.useMutation();
  const createVersion = api.llmConfigs.versions.create.useMutation();

  const updatePromptNameIfChanged = async (configId: string, name: string) => {
    const promptConfig =
      await trpc.client.llmConfigs.getByIdWithLatestVersion.query({
        projectId,
        id: configId,
      });
    if (!promptConfig) return;
    if (promptConfig.name === name) return;

    const config = await updateConfig.mutateAsync({
      projectId,
      id: configId,
      name,
    });
    await trpc.llmConfigs.getPromptConfigs.invalidate();
    await trpc.llmConfigs.getByIdWithLatestVersion.invalidate();
    return config;
  };

  const createNewVersion = async (
    configId: string,
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

    await trpc.llmConfigs.getPromptConfigs.invalidate();
    await trpc.llmConfigs.versions.getVersionsForConfigById.invalidate();
    await trpc.llmConfigs.getByIdWithLatestVersion.invalidate();

    return version;
  };

  return {
    updatePromptNameIfChanged,
    createNewVersion,
    isLoading: updateConfig.isLoading || createVersion.isLoading,
  };
};
