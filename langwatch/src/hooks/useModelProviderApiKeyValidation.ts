import { useCallback, useState } from "react";
import { api } from "../utils/api";

/**
 * Hook for validating model provider API keys.
 * Provides validation state and functions to trigger validation.
 * Uses tRPC to call the backend validation endpoints.
 *
 * @param provider - The provider key (e.g., "openai", "gemini")
 * @param customKeys - The form state containing API keys and configuration
 * @param projectId - Project handle for the tenant, when there is one
 * @param organizationId - Organization handle for the tenant
 * @param scopes - Scopes the credential is being set up for. On the
 *   no-project path these are what the probe is authorized against, so a
 *   caller who cannot manage them cannot reach the outbound request.
 * @returns Object containing validation state and functions
 */
export function useModelProviderApiKeyValidation(
  provider: string,
  customKeys: Record<string, string>,
  projectId: string | undefined,
  organizationId: string | undefined,
  scopes?: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>,
) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>();
  const utils = api.useContext();

  const validate = useCallback(async (): Promise<boolean> => {
    // The probe reads nothing from storage — it sends the typed keys
    // straight at the provider — so it needs a tenant to authorize
    // against and nothing more. Either handle names one.
    if (!projectId && !organizationId) {
      setValidationError("No organization to validate against");
      return false;
    }

    setIsValidating(true);
    setValidationError(undefined);

    try {
      const result = await utils.modelProvider.validateApiKey.fetch({
        projectId,
        organizationId,
        provider,
        customKeys,
        scopes: scopes && scopes.length > 0 ? scopes : undefined,
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
  }, [
    projectId,
    organizationId,
    provider,
    customKeys,
    scopes,
    utils.modelProvider.validateApiKey,
  ]);

  /**
   * Validates stored or env var API key against a custom URL or default URL.
   * When customBaseUrl is not provided, validates against the provider's default URL.
   */
  const validateWithCustomUrl = useCallback(
    async (customBaseUrl?: string): Promise<boolean> => {
      if (!projectId) {
        setValidationError("Project ID is required for validation");
        return false;
      }

      setIsValidating(true);
      setValidationError(undefined);

      try {
        const result = await utils.modelProvider.validateKeyWithCustomUrl.fetch(
          {
            projectId,
            provider,
            customBaseUrl,
          },
        );

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
    },
    [projectId, provider, utils.modelProvider.validateKeyWithCustomUrl],
  );

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
