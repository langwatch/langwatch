import { Box, Field, Input, VStack } from "@chakra-ui/react";
import type React from "react";
import { useEffect } from "react";
import { UiSlot } from "@langwatch/ui-host/slots";
import { fieldMetadataFor } from "../../model/model-provider-field-metadata.ts";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import { useRequiredCredentialKeys } from "../../behavior/use-required-credential-keys.ts";
import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "@langwatch/model-provider-contract";
import { api } from "../../behavior/model-provider-api.ts";
import { isSecretCredentialField } from "../../model/model-provider-helpers.ts";
import { SmallLabel } from "../elements/small-label.tsx";

/**
 * One credential input. Requiredness is derived from the provider's own schema
 * against the values entered so far, so a field that a base URL makes optional
 * loses its marker the moment that URL is typed.
 */
const CredentialField = ({
  apiKeyValidationError,
  credentialKey,
  description,
  fieldErrors,
  isOptional,
  onApiKeyValidationClear,
  onChange,
  setFieldErrors,
  value,
}: {
  apiKeyValidationError?: string;
  credentialKey: string;
  description?: string;
  fieldErrors: Record<string, string>;
  isOptional: boolean;
  onApiKeyValidationClear?: () => void;
  onChange: (value: string) => void;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  value: string;
}) => {
  const isPassword = isSecretCredentialField(credentialKey);
  const fieldError = fieldErrors[credentialKey];

  const handleChange = (nextValue: string) => {
    onChange(nextValue);
    if (fieldError) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated[credentialKey];
        return updated;
      });
    }
    // Clear API key validation error when user modifies the field
    const shouldClearValidation = onApiKeyValidationClear && apiKeyValidationError;
    if (shouldClearValidation) onApiKeyValidationClear();
  };

  return (
    <Field.Root required={!isOptional} invalid={Boolean(fieldError)} width="full">
      <SmallLabel>
        {credentialKey}
        {!isOptional && <Field.RequiredIndicator />}
      </SmallLabel>
      <Box width="full">
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          type={isPassword ? "password" : "text"}
          // The label above is a styled Text, not a real label element,
          // so the field carries its own accessible name.
          aria-label={credentialKey}
          autoComplete="off"
          placeholder={isOptional ? "optional" : undefined}
          width="full"
        />
      </Box>
      {description && <Field.HelperText>{description}</Field.HelperText>}
      {fieldError && <Field.ErrorText>{fieldError}</Field.ErrorText>}
    </Field.Root>
  );
};

/**
 * Renders credential input fields based on the provider's schema, or whatever the
 * composition put in the managed-provider slot when the credentials are not the
 * customer's to enter.
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
    return (
      <UiSlot
        name="managedModelProviderAlert"
        props={{ provider: provider.provider, error: state.errors.customKeysRoot }}
      />
    );
  }

  return (
    <>
      <VStack align="stretch" gap={3} width="full">
        {Object.keys(state.displayKeys).map((key) => (
          <CredentialField
            key={key}
            apiKeyValidationError={apiKeyValidationError}
            credentialKey={key}
            description={fieldMetadata?.[key]?.description}
            fieldErrors={fieldErrors}
            isOptional={!requiredKeys.has(key)}
            onApiKeyValidationClear={onApiKeyValidationClear}
            onChange={(value) => actions.setCustomKey(key, value)}
            setFieldErrors={setFieldErrors}
            value={state.customKeys[key] ?? ""}
          />
        ))}
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
