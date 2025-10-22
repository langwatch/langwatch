import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Custom hook to abstract the logic of prompts operations that require refreshes.
 * Enforces refresh of queries when mutations are successful.
 */
export const usePrompts = () => {
  const trpc = api.useContext();
  const createDraft = api.prompts.createDraft.useMutation();
  const updateDraft = api.prompts.updateDraft.useMutation();
  const createPrompt = api.prompts.create.useMutation();
  const updatePrompt = api.prompts.update.useMutation();
  const updateHandle = api.prompts.updateHandle.useMutation();
  const restoreVersion = api.prompts.restoreVersion.useMutation();
  const deletePrompt = api.prompts.delete.useMutation();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const invalidateAll = async () =>
    Promise.all([await trpc.prompts.invalidate()]);

  const wrappedCreateDraft: typeof createDraft.mutateAsync = async (params) => {
    const prompt = await createDraft.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedUpdateDraft: typeof updateDraft.mutateAsync = async (params) => {
    const prompt = await updateDraft.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedCreatePrompt: typeof createPrompt.mutateAsync = async (
    params,
  ) => {
    const prompt = await createPrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedUpdatePrompt: typeof updatePrompt.mutateAsync = async (
    params,
  ) => {
    const prompt = await updatePrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedUpdateHandle: typeof updateHandle.mutateAsync = async (
    params,
  ) => {
    const prompt = await updateHandle.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedGetPromptById = async (params: {
    id: string;
    projectId?: string;
  }) => {
    const prompt = await trpc.prompts.getByIdOrHandle.fetch({
      idOrHandle: params.id,
      projectId: params.projectId ?? projectId,
    });
    await invalidateAll();
    return prompt;
  };

  const wrappedRestoreVersion: typeof restoreVersion.mutateAsync = async (
    params,
  ) => {
    const prompt = await restoreVersion.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedDeletePrompt: typeof deletePrompt.mutateAsync = async (
    params,
  ) => {
    const prompt = await deletePrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  return {
    createDraft: wrappedCreateDraft,
    createPrompt: wrappedCreatePrompt,
    updatePrompt: wrappedUpdatePrompt,
    updateDraft: wrappedUpdateDraft,
    updateHandle: wrappedUpdateHandle,
    getPromptById: wrappedGetPromptById,
    restoreVersion: wrappedRestoreVersion,
    deletePrompt: wrappedDeletePrompt,
  };
};
