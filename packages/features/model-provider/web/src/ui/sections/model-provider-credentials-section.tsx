import { Box, Field, Input, VStack } from "@chakra-ui/react";
import type React from "react";
import { useEffect } from "react";
import { ManagedModelProviderAlert } from "@langwatch/enterprise-managed-provider-web";
import { fieldMetadataFor } from "../../model/model-provider-field-metadata";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form";
import { useRequiredCredentialKeys } from "../../behavior/use-required-credential-keys";
import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "@langwatch/model-provider-contract";
import { api } from "../../behavior/model-provider-api";
import { isSecretCredentialField } from "../../model/model-provider-helpers";
import { SmallLabel } from "../elements/small-label";

/**
 * Renders credential input fields (API keys, endpoints, etc.) based on the provider's schema.
 * For managed providers (enterprise deployments), displays a managed provider component instead of input fields.
 * Handles field validation, password masking, and optional field indicators.
 * @param state - Form state containing credential values and display configuration
 * @param actions - Form actions for updating credential values
 * @param provider - The model provider configuration
 * @param fieldErrors - Map of field names to validation error messages
 * @param setFieldErrors - Function to update field errors
 * @param organizationId - Optional organization identifier for managed providers
 */
export const CredentialsSection = ({
  state,
  actions,
  provider,
  fieldErrors,
  setFieldErrors,
  organizationId,
  apiKeyValidationError,
  onApiKeyValidationClear,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  organizationId?: string;
  apiKeyValidationError?: string;
  onApiKeyValidationClear?: () => void;
}) => {
  const { data: managedProviderData } = api.modelProvider.isManagedProvider.useQuery(
    {
      organizationId: organizationId ?? "",
      provider: provider.provider,
    },
    { enabled: !!organizationId },
  );
  const isManaged = managedProviderData?.managed ?? false;

  const fieldMetadata = fieldMetadataFor(provider.provider);

  const requiredKeys = useRequiredCredentialKeys({
    providerKey: provider.provider,
    displayKeys: state.displayKeys,
    customKeys: state.customKeys,
  });

  useEffect(() => {
    if (isManaged) {
      actions.setManaged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManaged]);

  if (isManaged) {
    return <ManagedModelProviderAlert provider={provider} error={state.errors.customKeysRoot} />;
  }

  return (
    <>
      <VStack align="stretch" gap={3} width="full">
        {Object.keys(state.displayKeys).map((key) => {
          // Requiredness is derived from the provider's own schema against
          // the values entered so far, so a field that a base URL makes
          // optional loses its marker the moment that URL is typed.
          const description = fieldMetadata?.[key]?.description;
          const isOptional = !requiredKeys.has(key);
          const isPassword = isSecretCredentialField(key);
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
              {description && <Field.HelperText>{description}</Field.HelperText>}
              {fieldErrors[key] && <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText>}
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
