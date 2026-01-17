import {
  Box,
  Button,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import type { HttpHeader } from "~/optimization_studio/types/dsl";

export type HeadersConfigSectionProps = {
  value: HttpHeader[];
  onChange: (headers: HttpHeader[]) => void;
  disabled?: boolean;
};

/**
 * Custom headers configuration section for HTTP agents.
 * Allows adding/removing key-value header pairs.
 */
export function HeadersConfigSection({
  value,
  onChange,
  disabled = false,
}: HeadersConfigSectionProps) {
  const handleAddHeader = () => {
    onChange([...value, { key: "", value: "" }]);
  };

  const handleRemoveHeader = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleUpdateHeader = (
    index: number,
    field: "key" | "value",
    newValue: string,
  ) => {
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
        <Text
          fontSize="xs"
          fontWeight="bold"
          textTransform="uppercase"
          color="gray.500"
        >
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
        <Text fontSize="13px" color="gray.400" textAlign="center" paddingY={4}>
          No custom headers defined
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {value.map((header, index) => (
            <HStack key={index} gap={2}>
              <Input
                value={header.key}
                onChange={(e) =>
                  handleUpdateHeader(index, "key", e.target.value)
                }
                placeholder="Header name"
                size="sm"
                flex={1}
                disabled={disabled}
                data-testid={`header-key-${index}`}
              />
              <Input
                value={header.value}
                onChange={(e) =>
                  handleUpdateHeader(index, "value", e.target.value)
                }
                placeholder="Header value"
                size="sm"
                flex={2}
                disabled={disabled}
                data-testid={`header-value-${index}`}
              />
              {!disabled && (
                <Tooltip
                  content="Remove header"
                  positioning={{ placement: "top" }}
                >
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="gray"
                    onClick={() => handleRemoveHeader(index)}
                    color="gray.400"
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
