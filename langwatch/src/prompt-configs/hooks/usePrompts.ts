import { api } from "~/utils/api";

/**
 * Custom hook to abstract the logic of prompts operations that require refreshes.
 * Enforces refresh of queries when mutations are successful.
 */
export const usePrompts = () => {
  const trpc = api.useContext();
  const createPrompt = api.prompts.create.useMutation();
  const updatePrompt = api.prompts.update.useMutation();
  const restoreVersion = api.prompts.restoreVersion.useMutation();
  const deletePrompt = api.prompts.delete.useMutation();

  const invalidateAll = async () => Promise.all([
    await trpc.prompts.invalidate(),
  ]);

  const wrappedCreatePrompt: typeof createPrompt.mutateAsync = async (params)=> {
    const prompt = await createPrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedUpdatePrompt: typeof updatePrompt.mutateAsync = async (params)=> {
    const prompt = await updatePrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedGetPromptById = async ({ id, projectId }: { id: string, projectId: string }) => {
    const prompt = await trpc.prompts.getByIdOrHandle.fetch({
      idOrHandle: id,
      projectId,
    });
    await invalidateAll();
    return prompt;
  };

  const wrappedRestoreVersion: typeof restoreVersion.mutateAsync = async (params) => {
    const prompt = await restoreVersion.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedDeletePrompt: typeof deletePrompt.mutateAsync = async (params) => {
    const prompt = await deletePrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  return {
    createPrompt: wrappedCreatePrompt,
    updatePrompt: wrappedUpdatePrompt,
    getPromptById: wrappedGetPromptById,
    restoreVersion: wrappedRestoreVersion,
    deletePrompt: wrappedDeletePrompt,
  };
};