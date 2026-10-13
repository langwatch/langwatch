import {
  Box,
  Field,
  Group,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Eye, EyeOff, Info } from "lucide-react";
import type React from "react";
import { useState } from "react";

import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import { useRequiredCredentialKeys } from "../../behavior/use-required-credential-keys.ts";
import { fieldMetadataFor } from "../../model/model-provider-field-metadata.ts";
import { isSecretCredentialField } from "../../model/model-provider-helpers.ts";

/** A credential input that reads as the `.env` line it fills: `KEY=` then the value. */
function PrefixedCredentialInput({
  credentialKey,
  value,
  placeholder,
  invalid,
  onChange,
}: {
  credentialKey: string;
  value: string;
  placeholder: string | undefined;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const secret = isSecretCredentialField(credentialKey);
  const [visible, setVisible] = useState(false);
  const borderColor = invalid ? "border.error" : "border";

  return (
    <Group
      attached
      width="full"
      alignItems="stretch"
      borderRadius="l2"
      _focusWithin={{ boxShadow: "sm" }}
    >
      <Box
        display="flex"
        alignItems="center"
        paddingX={3}
        bg="bg.muted/60"
        color="fg.muted"
        borderWidth="1px"
        borderEndWidth={0}
        borderColor={borderColor}
        borderStartRadius="l2"
        flexShrink={0}
      >
        <Text fontSize="xs">{credentialKey}=</Text>
      </Box>
      <Input
        size="sm"
        bg="bg.muted/40"
        borderColor={borderColor}
        borderStartWidth={0}
        borderEndWidth={secret ? 0 : undefined}
        type={secret && !visible ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={credentialKey}
        aria-invalid={invalid ? true : undefined}
        data-testid={`model-provider-credential-${credentialKey}`}
        focusVisibleRing="none"
        _focus={{ outline: "none", boxShadow: "none", borderColor }}
      />
      {secret ? (
        <Box
          display="flex"
          alignItems="center"
          paddingX={1}
          bg="bg.muted/40"
          borderWidth="1px"
          borderStartWidth={0}
          borderColor={borderColor}
          borderEndRadius="l2"
        >
          <Tooltip content={visible ? "Hide value" : "Show value"} openDelay={0} showArrow>
            <IconButton
              size="2xs"
              variant="ghost"
              onClick={() => setVisible((shown) => !shown)}
              aria-label={visible ? "Hide value" : "Show value"}
            >
              {visible ? <EyeOff /> : <Eye />}
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </Group>
  );
}

/** The credentials of the embedded setup: each field's label, an info tip and a prefixed input. */
export function EmbeddedCredentialFields({
  providerKey,
  state,
  actions,
  fieldErrors,
  setFieldErrors,
  refusal,
  clearRefusal,
}: {
  providerKey: string;
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  refusal: string | undefined;
  clearRefusal: () => void;
}) {
  const metadata = fieldMetadataFor(providerKey);
  const requiredKeys = useRequiredCredentialKeys({
    providerKey,
    displayKeys: state.displayKeys,
    customKeys: state.customKeys,
  });
  const keys = Object.keys(state.displayKeys);
  if (keys.length === 0) return null;

  const change = (key: string, value: string) => {
    actions.setCustomKey(key, value);
    if (fieldErrors[key]) {
      setFieldErrors((previous) => {
        const { [key]: _cleared, ...rest } = previous;
        return rest;
      });
    }
    if (refusal) clearRefusal();
  };

  return (
    <VStack align="stretch" gap={3}>
      {keys.map((key) => {
        const required = requiredKeys.has(key);
        const label = metadata?.[key]?.label ?? key;
        const description = metadata?.[key]?.description;
        return (
          <Field.Root key={key} required={required} invalid={Boolean(fieldErrors[key])}>
            <HStack gap={1} align="center">
              <Field.Label>
                {label}
                {required && <Field.RequiredIndicator />}
              </Field.Label>
              {description ? (
                <Tooltip content={description} positioning={{ placement: "top" }} showArrow>
                  <IconButton
                    aria-label={`Info about ${label}`}
                    variant="ghost"
                    size="2xs"
                    colorPalette="gray"
                  >
                    <Info />
                  </IconButton>
                </Tooltip>
              ) : null}
            </HStack>
            <PrefixedCredentialInput
              credentialKey={key}
              value={state.customKeys[key] ?? ""}
              placeholder={required ? undefined : "optional"}
              invalid={Boolean(fieldErrors[key])}
              onChange={(value) => change(key, value)}
            />
            {fieldErrors[key] ? <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText> : null}
          </Field.Root>
        );
      })}
      {refusal ? (
        <Field.Root invalid>
          <Field.ErrorText>{refusal}</Field.ErrorText>
        </Field.Root>
      ) : null}
      {state.errors.customKeysRoot ? (
        <Field.Root invalid>
          <Field.ErrorText>{state.errors.customKeysRoot}</Field.ErrorText>
        </Field.Root>
      ) : null}
    </VStack>
  );
}
