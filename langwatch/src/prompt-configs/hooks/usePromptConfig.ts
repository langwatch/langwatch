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

  const updatePromptConfig = async (
    configId: string,
    configData: { name: string; referenceId?: string }
  ) => {
    const config = await updateConfig.mutateAsync({
      projectId,
      id: configId,
      name: configData.name,
      referenceId: configData.referenceId,
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
    updatePromptConfig,
    createNewVersion,
    isLoading: updateConfig.isLoading || createVersion.isLoading,
  };
};
