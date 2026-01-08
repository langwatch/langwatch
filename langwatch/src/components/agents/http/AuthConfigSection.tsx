import {
  Field,
  Input,
  NativeSelect,
  VStack,
} from "@chakra-ui/react";
import type { HttpAuth, HttpAuthType } from "~/optimization_studio/types/dsl";

export type AuthConfigSectionProps = {
  value: HttpAuth | undefined;
  onChange: (auth: HttpAuth | undefined) => void;
  disabled?: boolean;
};

const AUTH_TYPE_OPTIONS: Array<{ value: HttpAuthType; label: string }> = [
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
  disabled = false,
}: AuthConfigSectionProps) {
  const authType = value?.type ?? "none";

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
        <NativeSelect.Root>
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
          <Input
            type="password"
            value={value.token}
            onChange={(e) => onChange({ ...value, token: e.target.value })}
            placeholder="Enter bearer token"
            disabled={disabled}
          />
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
            <Input
              type="password"
              value={value.value}
              onChange={(e) => onChange({ ...value, value: e.target.value })}
              placeholder="Enter API key"
              disabled={disabled}
            />
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
            <Input
              type="password"
              value={value.password}
              onChange={(e) => onChange({ ...value, password: e.target.value })}
              placeholder="Password"
              disabled={disabled}
            />
          </Field.Root>
        </>
      )}
    </VStack>
  );
}
