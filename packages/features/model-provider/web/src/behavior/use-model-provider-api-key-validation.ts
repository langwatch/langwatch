import type { SerializedHandledError } from "@langwatch/handled-error";
import { useCallback, useState } from "react";
import { describeError } from "@langwatch/ui-host/errors";
import { explainSerializedError } from "@langwatch/handled-error/presentation";
import { api } from "./model-provider-api";

/**
 * The refusal, in the words the registry chose for its code. A refused credential arrives as a
 * serialized handled error on the result rather than as a thrown one, so it is read with
 * `explainSerializedError` instead of `describeError`.
 */
const describeRefusal = (domainError: SerializedHandledError): string => {
  const { title, description } = explainSerializedError(domainError);

  return description ? `${title}. ${description}` : title;
};

/**
 * Hook for validating model provider API keys via tRPC, scoped to a project or organization.
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
  const utils = api.useUtils();
  // A mutation, so the key travels in a request body rather than encoded into
  // a URL. See the procedure for why that matters.
  const { mutateAsync: validateApiKey } = api.modelProvider.validateApiKey.useMutation();

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
      const result = await validateApiKey({
        projectId,
        organizationId,
        provider,
        customKeys,
        scopes: scopes && scopes.length > 0 ? scopes : undefined,
      });

      if (!result.valid) {
        setValidationError(describeRefusal(result.domainError));
        return false;
      }

      return true;
    } catch (error) {
      // Not `error.message`: a handled error's message is replaced with its
      // stable code on the wire, so reading it renders a slug like
      // `provider_unreachable` straight into the drawer. `describeError`
      // resolves the code against the presentation registry instead. The
      // drawer's slot is a plain string, which is exactly what it is for.
      setValidationError(describeError({ error, fallbackTitle: "Couldn't check this API key" }));
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [projectId, organizationId, provider, customKeys, scopes, validateApiKey]);

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
        const result = await utils.modelProvider.validateKeyWithCustomUrl.fetch({
          projectId,
          provider,
          customBaseUrl,
        });

        if (!result.valid) {
          setValidationError(describeRefusal(result.domainError));
          return false;
        }

        return true;
      } catch (error) {
        setValidationError(
          describeError({
            error,
            fallbackTitle: "Couldn't check this API key",
          }),
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
