import { Field, HStack, IconButton, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { Tooltip } from "../../../../../components/ui/tooltip";
import type { DerivedFieldMeta } from "../../../../../hooks/useModelProviderFields";
import type { FieldMetadata } from "../../../regions/model-providers/types";
import { InputWithPrefix } from "../shared/InputWithPrefix";

interface ModelProviderCredentialFieldsProps {
  displayKeys: Record<string, unknown> | undefined;
  customKeys: Record<string, string>;
  derivedFields: DerivedFieldMeta[];
  fieldMetadata?: Record<string, FieldMetadata>;
  fieldErrors: Record<string, string>;
  openAiValidationError?: string;
  isOpenAiProvider: boolean;
  onCustomKeyChange: (key: string, value: string) => void;
  onFieldErrorClear: (key: string) => void;
  onOpenAiValidationClear: () => void;
}

export const ModelProviderCredentialFields: React.FC<
  ModelProviderCredentialFieldsProps
> = ({
  displayKeys,
  customKeys,
  derivedFields,
  fieldMetadata,
  fieldErrors,
  openAiValidationError,
  isOpenAiProvider,
  onCustomKeyChange,
  onFieldErrorClear,
  onOpenAiValidationClear,
}: ModelProviderCredentialFieldsProps) => {
  const credentialKeys = useMemo(
    () => Object.keys(displayKeys ?? {}),
    [displayKeys],
  );

  if (credentialKeys.length === 0) {
    return null;
  }

  const primaryKey = credentialKeys[0];

  return (
    <VStack align="stretch">
      <VStack align="stretch" gap={3}>
        {credentialKeys.map((key) => {
          const metaField = derivedFields.find((field) => field.key === key);
          const metadata = fieldMetadata?.[key];
          const isPassword = metaField?.type === "password";
          const required = metaField?.required ?? false;
          const fieldLabel = metadata?.label ?? key;
          const fieldDescription = metadata?.description;
          const showOpenAiError =
            isOpenAiProvider && !!openAiValidationError && key === primaryKey;
          const isInvalid = Boolean(fieldErrors[key]) || showOpenAiError;

          return (
            <Field.Root key={key} required={required} invalid={isInvalid}>
              <HStack gap={1} align="center">
                <Field.Label>
                  {fieldLabel}
                  {required && <Field.RequiredIndicator />}
                </Field.Label>
                {fieldDescription && (
                  <Tooltip
                    content={fieldDescription}
                    positioning={{ placement: "top" }}
                    showArrow
                  >
                    <IconButton
                      aria-label={`Info about ${fieldLabel}`}
                      variant="ghost"
                      size="2xs"
                      colorPalette="gray"
                    >
                      <Info />
                    </IconButton>
                  </Tooltip>
                )}
              </HStack>
              <InputWithPrefix
                prefix={`${key}=`}
                placeholder={metaField?.placeholder}
                autoComplete="off"
                value={customKeys[key] ?? ""}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  onCustomKeyChange(key, event.target.value);
                  if (fieldErrors[key]) {
                    onFieldErrorClear(key);
                  }
                  if (isOpenAiProvider && openAiValidationError) {
                    onOpenAiValidationClear();
                  }
                }}
                showVisibilityToggle={isPassword}
                ariaLabel={key}
                invalid={Boolean(fieldErrors[key])}
              />
              {fieldErrors[key] && (
                <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText>
              )}
            </Field.Root>
          );
        })}
      </VStack>
      {isOpenAiProvider && openAiValidationError && (
        <Field.Root invalid>
          <Field.ErrorText>{openAiValidationError}</Field.ErrorText>
        </Field.Root>
      )}
    </VStack>
  );
};
