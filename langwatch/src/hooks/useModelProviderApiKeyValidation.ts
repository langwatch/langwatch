import { useCallback, useState } from "react";
import { api } from "../utils/api";

/**
 * Hook for validating model provider API keys.
 * Provides validation state and a function to trigger validation.
 * Uses tRPC to call the backend validation endpoint.
 *
 * @param provider - The provider key (e.g., "openai", "gemini")
 * @param customKeys - The form state containing API keys and configuration
 * @returns Object containing validation state and functions
 */
export function useModelProviderApiKeyValidation(
  provider: string,
  customKeys: Record<string, string>,
) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>();
  const utils = api.useContext();

  const validate = useCallback(async (): Promise<boolean> => {
    setIsValidating(true);
    setValidationError(undefined);

    try {
      const result = await utils.modelProvider.validateApiKey.fetch({
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
  }, [provider, customKeys, utils.modelProvider.validateApiKey]);

  const clearError = useCallback(() => {
    setValidationError(undefined);
  }, []);

  return {
    isValidating,
    validationError,
    validate,
    clearError,
  };
}
