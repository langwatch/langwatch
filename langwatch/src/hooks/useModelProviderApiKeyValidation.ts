import { useCallback, useState } from "react";
import { api } from "../utils/api";

/**
 * Hook for validating model provider API keys.
 * Provides validation state and functions to trigger validation.
 * Uses tRPC to call the backend validation endpoints.
 *
 * @param provider - The provider key (e.g., "openai", "gemini")
 * @param customKeys - The form state containing API keys and configuration
 * @param projectId - The project ID for permission checking
 * @returns Object containing validation state and functions
 */
export function useModelProviderApiKeyValidation(
  provider: string,
  customKeys: Record<string, string>,
  projectId: string | undefined,
) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>();
  const utils = api.useContext();

  const validate = useCallback(async (): Promise<boolean> => {
    if (!projectId) {
      setValidationError("Project ID is required for validation");
      return false;
    }

    setIsValidating(true);
    setValidationError(undefined);

    try {
      const result = await utils.modelProvider.validateApiKey.fetch({
        projectId,
        provider,
        customKeys,
      });

      if (!result.valid) {
        setValidationError(result.error);
        return false;
      }

      return true;
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during validation",
      );
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [projectId, provider, customKeys, utils.modelProvider.validateApiKey]);

  /**
   * Validates stored or env var API key against a custom URL or default URL.
   * When customBaseUrl is not provided, validates against the provider's default URL.
   */
  const validateWithCustomUrl = useCallback(async (customBaseUrl?: string): Promise<boolean> => {
    if (!projectId) {
      setValidationError("Project ID is required for validation");
      return false;
    }

    setIsValidating(true);
    setValidationError(undefined);

    try {
      const result = await utils.modelProvider.validateKeyWithCustomUrl.fetch({
        projectId,
        provider,
        customBaseUrl,
      });

      if (!result.valid) {
        setValidationError(result.error);
        return false;
      }

      return true;
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during validation",
      );
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [projectId, provider, utils.modelProvider.validateKeyWithCustomUrl]);

  const clearError = useCallback(() => {
    setValidationError(undefined);
  }, []);

  return {
    isValidating,
    validationError,
    validate,
    validateWithCustomUrl,
    clearError,
  };
}
