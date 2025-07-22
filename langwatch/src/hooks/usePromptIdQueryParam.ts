import { useRouter } from "next/router";
import { useCallback, useMemo } from "react";

/**
 * Custom hook for managing selected prompt ID in URL query parameters
 * Single Responsibility: Manages prompt ID state via URL query params
 */
export const usePromptIdQueryParam = () => {
  const router = useRouter();

  // Get selected prompt ID from URL query params
  const selectedPromptId = useMemo(() => {
    return typeof router.query.promptId === "string"
      ? router.query.promptId
      : null;
  }, [router.query.promptId]);

  // Function to set selected prompt ID in URL
  const setSelectedPromptId = useCallback(
    (promptId: string | null) => {
      const query = { ...router.query };
      if (promptId) {
        query.promptId = promptId;
      } else {
        delete query.promptId;
      }
      void router.push({ query }, undefined, { shallow: true });
    },
    [router]
  );

  // Helper to clear selection
  const clearSelection = useCallback(() => {
    setSelectedPromptId(null);
  }, [setSelectedPromptId]);

  return {
    selectedPromptId,
    setSelectedPromptId,
    clearSelection,
  };
};
