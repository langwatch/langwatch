import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Custom hook to abstract the logic of prompts operations that require refreshes.
 * Enforces refresh of queries when mutations are successful.
 */
export const usePrompts = () => {
  const trpc = api.useContext();
  const createPrompt = api.prompts.create.useMutation();
  const updatePrompt = api.prompts.update.useMutation();
  const updateHandle = api.prompts.updateHandle.useMutation();
  const restoreVersion = api.prompts.restoreVersion.useMutation();
  const deletePrompt = api.prompts.delete.useMutation();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const invalidateAll = useCallback(
    async () => Promise.all([await trpc.prompts.invalidate()]),
    [trpc.prompts],
  );

  const wrappedCreatePrompt: typeof createPrompt.mutateAsync = useCallback(
    async (params) => {
      const prompt = await createPrompt.mutateAsync(params);
      await invalidateAll();
      return prompt;
    },
    [createPrompt, invalidateAll],
  );

  const wrappedUpdatePrompt: typeof updatePrompt.mutateAsync = useCallback(
    async (params) => {
      const prompt = await updatePrompt.mutateAsync(params);
      await invalidateAll();
      return prompt;
    },
    [updatePrompt, invalidateAll],
  );

  const wrappedUpdateHandle: typeof updateHandle.mutateAsync = useCallback(
    async (params) => {
      const prompt = await updateHandle.mutateAsync(params);
      await invalidateAll();
      return prompt;
    },
    [updateHandle, invalidateAll],
  );

  const wrappedGetPromptById = useCallback(
    async (params: { id: string; projectId?: string }) => {
      const prompt = await trpc.prompts.getByIdOrHandle.fetch({
        idOrHandle: params.id,
        projectId: params.projectId ?? projectId,
      });
      await invalidateAll();
      return prompt;
    },
    [trpc.prompts.getByIdOrHandle, projectId, invalidateAll],
  );

  const wrappedRestoreVersion: typeof restoreVersion.mutateAsync = useCallback(
    async (params) => {
      const prompt = await restoreVersion.mutateAsync(params);
      await invalidateAll();
      return prompt;
    },
    [restoreVersion, invalidateAll],
  );

  const wrappedDeletePrompt: typeof deletePrompt.mutateAsync = useCallback(
    async (params) => {
      const prompt = await deletePrompt.mutateAsync(params);
      await invalidateAll();
      return prompt;
    },
    [deletePrompt, invalidateAll],
  );

  return {
    createPrompt: wrappedCreatePrompt,
    updatePrompt: wrappedUpdatePrompt,
    updateHandle: wrappedUpdateHandle,
    getPromptById: wrappedGetPromptById,
    restoreVersion: wrappedRestoreVersion,
    deletePrompt: wrappedDeletePrompt,
  };
};
