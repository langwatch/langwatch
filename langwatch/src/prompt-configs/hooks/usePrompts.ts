import { api } from "~/utils/api";

/**
 * Custom hook to abstract the logic of prompts operations that require refreshes.
 * Enforces refresh of queries when mutations are successful.
 */
export const usePrompts = () => {
  const trpc = api.useContext();
  const upsertPrompt = api.prompts.upsert.useMutation();
  const updatePrompt = api.prompts.update.useMutation();

  const invalidateAll = async () => Promise.all([
    await trpc.prompts.invalidate(),
  ]);

  const wrappedUpsertPrompt: typeof upsertPrompt.mutateAsync = async (params)=> {
    const prompt = await upsertPrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedUpdatePrompt: typeof updatePrompt.mutateAsync = async (params)=> {
    const prompt = await updatePrompt.mutateAsync(params);
    await invalidateAll();
    return prompt;
  };

  const wrappedGetPromptById: typeof trpc.prompts.getById.fetch = async (params) => {
    const prompt = await trpc.prompts.getById.fetch(params);
    await invalidateAll();
    return prompt;
  };

  return {
    upsertPrompt: wrappedUpsertPrompt,
    updatePrompt: wrappedUpdatePrompt,
    getPromptById: wrappedGetPromptById,
  };
};