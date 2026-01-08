import {
  VStack,
  Input,
  Box,
  Field,
} from "@chakra-ui/react";
import React, { useEffect } from "react";
import type {
  UseModelProviderFormState,
  UseModelProviderFormActions,
} from "../../hooks/useModelProviderForm";
import { dependencies } from "../../injection/dependencies.client";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { KEY_CHECK } from "../../utils/constants";
import { SmallLabel } from "../SmallLabel";

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
  const ManagedModelProvider = dependencies.managedModelProviderComponent?.({
    projectId: projectId ?? "",
    organizationId: organizationId ?? "",
    provider,
  });
  // Type assertion needed: managedModelProviderComponent is dynamically injected and may vary by deployment
  const ManagedModelProviderAny = ManagedModelProvider as React.ComponentType<{ provider: MaybeStoredModelProvider }> | undefined;

  useEffect(() => {
    if (ManagedModelProviderAny) {
      actions.setManaged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(state.customKeys)]);

  if (ManagedModelProviderAny) {
    return React.createElement(ManagedModelProviderAny, { provider });
  }

  return (
    <>
      <VStack align="stretch" gap={3} width="full">
        {Object.keys(state.displayKeys).map((key) => {
          // Check if field is optional using Zod's public API
          const zodSchema = state.displayKeys[key];
          const isOptional = zodSchema?.isOptional?.() ?? false;
          const isPassword = KEY_CHECK.some((k) => key.includes(k));
          const isInvalid = Boolean(fieldErrors[key]);

          return (
            <Field.Root key={key} required={!isOptional} invalid={isInvalid} width="full">
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
                      setFieldErrors(prev => {
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
