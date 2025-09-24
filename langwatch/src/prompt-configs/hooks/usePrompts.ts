import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Custom hook to abstract the logic of prompts operations.
 * Enforces refresh of queries when mutations are successful.
 */
export const usePrompts = () => {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const upsertPrompt = api.prompts.upsert.useMutation();

  const invalidateAll = async () => Promise.all([
    await trpc.llmConfigs.getPromptConfigs.invalidate(),
    await trpc.llmConfigs.getByIdWithLatestVersion.invalidate(),
    await trpc.llmConfigs.getPromptConfigs.invalidate(),
    await trpc.llmConfigs.versions.getVersionsForConfigById.invalidate(),
    await trpc.llmConfigs.getByIdWithLatestVersion.invalidate()
  ]);

  const wrappedUpsertPrompt: typeof upsertPrompt.mutateAsync = async (promptData)=> {
    const prompt = await upsertPrompt.mutateAsync({
      projectId,
      promptId: promptData.promptId,
      handle: promptData.handle,
      scope: promptData.scope,
      commitMessage: promptData.commitMessage,
      versionData: promptData.versionData,
    });

    await invalidateAll();
    return prompt;
  };

  return {
    upsertPrompt: wrappedUpsertPrompt,
  };
};