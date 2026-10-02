import { type HttpHeader, secretReferenceOf } from "@langwatch/agent-contract";
import { Button, HStack, Input, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Plus, X } from "lucide-react";

import { SecretReferenceLine } from "./secret-reference-line.tsx";

export type HeadersConfigSectionProps = {
  value: HttpHeader[];
  onChange: (headers: HttpHeader[]) => void;
  disabled?: boolean;
  /** Credentials live on the agent: the section is read-only and says where they are. */
  readOnly?: boolean;
  /** Names of saved headers whose values the server keeps while the field is left blank. */
  storedKeys?: string[];
};

function headerValuePlaceholder({
  readOnly,
  isStored,
}: {
  readOnly: boolean;
  isStored: boolean;
}): string {
  if (readOnly) return "Stored on the agent";
  return isStored ? "Stored; enter a new value to replace it" : "Header value";
}

function HeaderValueField({
  header,
  disabled,
  placeholder,
  onChange,
  testId,
}: {
  header: HttpHeader;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  const name = secretReferenceOf(header.value);
  if (name !== void 0) {
    return (
      <HStack flex={2}>
        <SecretReferenceLine name={name} {...(disabled ? {} : { onReplace: () => onChange("") })} />
      </HStack>
    );
  }
  return (
    <Input
      value={header.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      size="sm"
      flex={2}
      disabled={disabled}
      data-testid={testId}
    />
  );
}

/**
 * Custom headers configuration section for HTTP agents.
 * Allows adding/removing key-value header pairs.
 */
export function HeadersConfigSection({
  value,
  onChange,
  disabled: disabledProp = false,
  readOnly = false,
  storedKeys = [],
}: HeadersConfigSectionProps) {
  const disabled = disabledProp || readOnly;
  const handleAddHeader = () => {
    onChange([...value, { key: "", value: "" }]);
  };

  const handleRemoveHeader = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleUpdateHeader = (index: number, field: "key" | "value", newValue: string) => {
    const newHeaders = [...value];
    const header = newHeaders[index];
    if (header) {
      newHeaders[index] = { ...header, [field]: newValue };
      onChange(newHeaders);
    }
  };

  return (
    <VStack align="stretch" gap={3} width="full">
      {/* Header */}
      <HStack width="full">
        <Text fontSize="xs" fontWeight="bold" textTransform="uppercase" color="fg.muted">
          Custom Headers
        </Text>
        <Spacer />
        {!disabled && (
          <Button
            size="xs"
            variant="outline"
            onClick={handleAddHeader}
            data-testid="add-header-button"
          >
            <Plus size={14} />
            Add Header
          </Button>
        )}
      </HStack>

      {/* Headers List */}
      {value.length === 0 ? (
        <Text fontSize="13px" color="fg.subtle" textAlign="center" paddingY={4}>
          No custom headers defined
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {value.map((header, index) => (
            <HStack key={index} gap={2}>
              <Input
                value={header.key}
                onChange={(e) => handleUpdateHeader(index, "key", e.target.value)}
                placeholder="Header name"
                size="sm"
                flex={1}
                disabled={disabled}
                data-testid={`header-key-${index}`}
              />
              <HeaderValueField
                header={header}
                disabled={disabled}
                placeholder={headerValuePlaceholder({
                  readOnly,
                  isStored: storedKeys.includes(header.key),
                })}
                onChange={(next) => handleUpdateHeader(index, "value", next)}
                testId={`header-value-${index}`}
              />
              {!disabled && (
                <Tooltip content="Remove header" positioning={{ placement: "top" }}>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="gray"
                    onClick={() => handleRemoveHeader(index)}
                    color="fg.subtle"
                    data-testid={`remove-header-${index}`}
                  >
                    <X size={14} />
                  </Button>
                </Tooltip>
              )}
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
