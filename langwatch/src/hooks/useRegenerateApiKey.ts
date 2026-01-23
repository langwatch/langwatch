import { useCallback, useState } from "react";
import { api } from "../utils/api";
import { toaster } from "../components/ui/toaster";

/**
 * Hook for regenerating API keys.
 * Handles mutation logic, cache invalidation, and toast notifications.
 *
 * @param projectId - The project ID for which to regenerate the API key
 * @returns Object containing mutation state and regenerate function
 */
export function useRegenerateApiKey(projectId: string) {
  const [newApiKey, setNewApiKey] = useState<string>("");
  const apiContext = api.useContext();

  const regenerateApiKey = api.project.regenerateApiKey.useMutation({
    onSuccess: (data) => {
      setNewApiKey(data.apiKey);
      void apiContext.organization.getAll.invalidate();

      toaster.create({
        title: "API Key Regenerated",
        description:
          "Your old API key has been invalidated. Make sure to update your applications.",
        type: "danger",
        meta: { closable: true },
      });
    },
    onError: () => {
      toaster.create({
        title: "Failed to regenerate API key",
        description: "Please try again or contact support",
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const regenerate = useCallback(() => {
    regenerateApiKey.mutate({ projectId });
  }, [projectId, regenerateApiKey]);

  const clearNewApiKey = useCallback(() => {
    setNewApiKey("");
  }, []);

  return {
    regenerate,
    newApiKey,
    clearNewApiKey,
    isLoading: regenerateApiKey.isLoading,
  } as const;
}
