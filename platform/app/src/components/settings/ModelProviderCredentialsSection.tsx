import { Box, Field, Input, VStack } from "@chakra-ui/react";
import React, { useEffect } from "react";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import {
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../../server/modelProviders/registry";
import { KEY_CHECK } from "../../utils/constants";
import { SmallLabel } from "../SmallLabel";
import { ManagedModelProviderAlert } from "../../../ee/managed-providers/ManagedModelProviderAlert";
import { api } from "../../utils/api";

/**
 * Renders credential input fields (API keys, endpoints, etc.) based on the provider's schema.
 * For managed providers (enterprise deployments), displays a managed provider component instead of input fields.
 * Handles field validation, password masking, and optional field indicators.
 * @param state - Form state containing credential values and display configuration
 * @param actions - Form actions for updating credential values
 * @param provider - The model provider configuration
 * @param fieldErrors - Map of field names to validation error messages
 * @param setFieldErrors - Function to update field errors
 * @param projectId - Optional project identifier for managed providers
 * @param organizationId - Optional organization identifier for managed providers
 */
export const CredentialsSection = ({
  state,
  actions,
  provider,
  fieldErrors,
  setFieldErrors,
  projectId,
  organizationId,
  apiKeyValidationError,
  onApiKeyValidationClear,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  projectId?: string;
  organizationId?: string;
  apiKeyValidationError?: string;
  onApiKeyValidationClear?: () => void;
}) => {
  const { data: managedProviderData } =
    api.modelProvider.isManagedProvider.useQuery(
      {
        organizationId: organizationId ?? "",
        provider: provider.provider,
      },
      { enabled: !!organizationId },
    );
  const isManaged = managedProviderData?.managed ?? false;

  const providerDefinition = modelProvidersRegistry[
    provider.provider as keyof typeof modelProvidersRegistry
  ] as { optionalKeys?: readonly string[] } | undefined;
  const optionalKeySet = providerDefinition?.optionalKeys
    ? new Set(providerDefinition.optionalKeys)
    : undefined;

  useEffect(() => {
    if (isManaged) {
      actions.setManaged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManaged]);

  if (isManaged) {
    return (
      <ManagedModelProviderAlert
        provider={provider}
        error={state.errors.customKeysRoot}
      />
    );
  }

  return (
    <>
      <VStack align="stretch" gap={3} width="full">
        {Object.keys(state.displayKeys).map((key) => {
          // Prefer the provider's explicit optionalKeys list (ground truth
          // for UI affordance). Fall back to Zod introspection for
          // providers that haven't declared it yet — `.nullable().optional()`
          // is used on the schemas for env-var fallback, so `.isOptional()`
          // alone over-reports "optional".
          const zodSchema = state.displayKeys[key];
          const isOptional = optionalKeySet
            ? optionalKeySet.has(key)
            : (zodSchema?.isOptional?.() ?? false);
          const isPassword = KEY_CHECK.some((k) => key.includes(k));
          const isInvalid = Boolean(fieldErrors[key]);

          return (
            <Field.Root
              key={key}
              required={!isOptional}
              invalid={isInvalid}
              width="full"
            >
              <SmallLabel>
                {key}
                {!isOptional && <Field.RequiredIndicator />}
              </SmallLabel>
              <Box width="full">
                <Input
                  value={state.customKeys[key] ?? ""}
                  onChange={(e) => {
                    actions.setCustomKey(key, e.target.value);
                    if (fieldErrors[key]) {
                      setFieldErrors((prev) => {
                        const updated = { ...prev };
                        delete updated[key];
                        return updated;
                      });
                    }
                    // Clear API key validation error when user modifies the field
                    if (onApiKeyValidationClear && apiKeyValidationError) {
                      onApiKeyValidationClear();
                    }
                  }}
                  type={isPassword ? "password" : "text"}
                  autoComplete="off"
                  placeholder={isOptional ? "optional" : undefined}
                  width="full"
                />
              </Box>
              {fieldErrors[key] && (
                <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText>
              )}
            </Field.Root>
          );
        })}
      </VStack>
      {apiKeyValidationError && (
        <Field.Root invalid>
          <Field.ErrorText>{apiKeyValidationError}</Field.ErrorText>
        </Field.Root>
      )}
      {state.errors.customKeysRoot && (
        <Field.Root invalid>
          <Field.ErrorText>{state.errors.customKeysRoot}</Field.ErrorText>
        </Field.Root>
      )}
    </>
  );
};
