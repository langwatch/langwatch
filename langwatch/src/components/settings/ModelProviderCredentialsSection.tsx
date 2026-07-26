import { Alert, Box, Field, Input, VStack } from "@chakra-ui/react";
import React, { useEffect, useMemo } from "react";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import {
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../../server/modelProviders/registry";
import { useRequiredCredentialKeys } from "../../hooks/useRequiredCredentialKeys";
import {
  getCredentialRepointNotice,
  isApiKeyField,
} from "../../utils/modelProviderHelpers";
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
  ] as { endpointKey?: string | undefined } | undefined;

  const requiredKeys = useRequiredCredentialKeys({
    providerKey: provider.provider,
    displayKeys: state.displayKeys,
    customKeys: state.customKeys,
  });

  // A base-URL edit on a provider that already holds a credential hands
  // that credential to a different host. The customer sees it here, at the
  // moment they cause it, rather than after the next request.
  const repointNotice = useMemo(
    () =>
      getCredentialRepointNotice({
        endpointKey: providerDefinition?.endpointKey,
        values: state.customKeys,
        storedKeys: state.initialKeys,
      }),
    [providerDefinition?.endpointKey, state.customKeys, state.initialKeys],
  );

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
          // Requiredness is derived from the provider's own schema against
          // the values entered so far, so a field that a base URL makes
          // optional loses its marker the moment that URL is typed.
          const isOptional = !requiredKeys.has(key);
          const isPassword = isApiKeyField(key);
          const isInvalid = Boolean(fieldErrors[key]);
          const showsRepointNotice =
            !!repointNotice && key === providerDefinition?.endpointKey;
          // Ties the notice to the input it belongs to, so focusing the
          // field announces where the key is about to go.
          const repointNoticeId = `${key}-repoint-notice`;

          return (
            <React.Fragment key={key}>
              <Field.Root
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
                    aria-describedby={
                      showsRepointNotice ? repointNoticeId : undefined
                    }
                  />
                </Box>
                {fieldErrors[key] && (
                  <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText>
                )}
              </Field.Root>
              {showsRepointNotice && (
                <Alert.Root status="warning" size="sm" id={repointNoticeId}>
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>
                      The saved API key follows this change
                    </Alert.Title>
                    <Alert.Description>
                      {repointNotice.destinationHost
                        ? `After you save, requests carry it to ${repointNotice.destinationHost}.`
                        : "After you save, requests carry it to the provider's own endpoint."}
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
            </React.Fragment>
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
