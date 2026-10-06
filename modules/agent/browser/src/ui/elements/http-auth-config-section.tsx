import { type HttpAuth, type HttpAuthType, readSecretReference } from "@langwatch/agent-contract";
import { Field, Input, NativeSelect, VStack } from "@langwatch/design-system/primitives";

import { SecretReferenceLine } from "./secret-reference-line.tsx";

export type AuthConfigSectionProps = {
  value: HttpAuth | undefined;
  onChange: (auth: HttpAuth | undefined) => void;
  disabled?: boolean;
  /** Credentials live on the agent: the section is read-only and says where they are. */
  readOnly?: boolean;
  /** The saved auth kind: its secret is kept by the server while the field is left blank. */
  storedType?: HttpAuthType;
};

const AUTH_TYPE_OPTIONS: { value: HttpAuthType; label: string }[] = [
  { value: "none", label: "No Authentication" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api_key", label: "API Key" },
  { value: "basic", label: "Basic Auth" },
];

/**
 * Authentication configuration section for HTTP agents.
 * Supports: None, Bearer Token, API Key, Basic Auth
 */
export function AuthConfigSection({
  value,
  onChange,
  disabled: disabledProp = false,
  readOnly = false,
  storedType,
}: AuthConfigSectionProps) {
  const authType = value?.type ?? "none";
  const disabled = disabledProp || readOnly;
  const keptPlaceholder = (fallback: string) => {
    if (readOnly) return "Stored on the agent";
    return storedType !== void 0 && storedType === authType
      ? "Stored; enter a new value to replace it"
      : fallback;
  };

  const credentialField = ({
    value: current,
    onValueChange,
    placeholder,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    placeholder: string;
  }) => {
    const reference = readSecretReference(current);
    if (reference.isReference) {
      return (
        <SecretReferenceLine
          name={reference.name}
          {...(disabled ? {} : { onReplace: () => onValueChange("") })}
        />
      );
    }
    return (
      <Input
        type="password"
        value={current}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  };

  const handleTypeChange = (newType: HttpAuthType) => {
    switch (newType) {
      case "none":
        onChange({ type: "none" });
        break;
      case "bearer":
        onChange({ type: "bearer", token: "" });
        break;
      case "api_key":
        onChange({ type: "api_key", header: "X-API-Key", value: "" });
        break;
      case "basic":
        onChange({ type: "basic", username: "", password: "" });
        break;
    }
  };

  return (
    <VStack align="stretch" gap={4} width="full">
      <Field.Root>
        <Field.Label>Auth Type</Field.Label>
        <NativeSelect.Root disabled={disabled}>
          <NativeSelect.Field
            value={authType}
            onChange={(e) => handleTypeChange(e.target.value as HttpAuthType)}
          >
            {AUTH_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>

      {/* Bearer Token fields */}
      {value?.type === "bearer" && (
        <Field.Root>
          <Field.Label>Token</Field.Label>
          {credentialField({
            value: value.token,
            onValueChange: (token) => onChange({ ...value, token }),
            placeholder: keptPlaceholder("Enter bearer token"),
          })}
        </Field.Root>
      )}

      {/* API Key fields */}
      {value?.type === "api_key" && (
        <>
          <Field.Root>
            <Field.Label>Header Name</Field.Label>
            <Input
              value={value.header}
              onChange={(e) => onChange({ ...value, header: e.target.value })}
              placeholder="X-API-Key"
              disabled={disabled}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>API Key Value</Field.Label>
            {credentialField({
              value: value.value,
              onValueChange: (next) => onChange({ ...value, value: next }),
              placeholder: keptPlaceholder("Enter API key"),
            })}
          </Field.Root>
        </>
      )}

      {/* Basic Auth fields */}
      {value?.type === "basic" && (
        <>
          <Field.Root>
            <Field.Label>Username</Field.Label>
            <Input
              value={value.username}
              onChange={(e) => onChange({ ...value, username: e.target.value })}
              placeholder="Username"
              disabled={disabled}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Password</Field.Label>
            {credentialField({
              value: value.password,
              onValueChange: (password) => onChange({ ...value, password }),
              placeholder: keptPlaceholder("Password"),
            })}
          </Field.Root>
        </>
      )}
    </VStack>
  );
}
