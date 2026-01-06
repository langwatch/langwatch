import { Button, HStack, Input, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useState } from "react";

type InlineTagsInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
};

/**
 * Inline tags input matching the design.
 * Shows tags with x buttons, input field, Add/Cancel buttons.
 */
export function InlineTagsInput({
  value,
  onChange,
  placeholder = "Label name...",
}: InlineTagsInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    if (inputValue.trim()) {
      onChange([...value, inputValue.trim()]);
      setInputValue("");
      setIsAdding(false);
    }
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleCancel = () => {
    setInputValue("");
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <HStack flexWrap="wrap" gap={2} align="center">
      {/* Existing tags */}
      {value.map((tag, index) => (
        <HStack
          key={index}
          bg="blue.50"
          color="blue.700"
          px={2}
          py={1}
          borderRadius="md"
          fontSize="sm"
          gap={1}
        >
          <Text>{tag}</Text>
          <button
            type="button"
            onClick={() => handleRemove(index)}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              background: "transparent",
              border: "none",
              color: "var(--chakra-colors-blue-500)",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.color = "var(--chakra-colors-blue-700)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.color = "var(--chakra-colors-blue-500)")
            }
          >
            <X size={12} />
          </button>
        </HStack>
      ))}

      {/* Input field */}
      {isAdding || value.length === 0 ? (
        <HStack gap={2}>
          <Input
            size="sm"
            width="140px"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={handleKeyDown}
            autoFocus={isAdding}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleAdd}
            color="blue.500"
            fontWeight="medium"
          >
            Add
          </Button>
          {value.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              color="gray.500"
              fontWeight="medium"
            >
              Cancel
            </Button>
          )}
        </HStack>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setIsAdding(true)}
          color="blue.500"
          fontWeight="medium"
        >
          + Add Label
        </Button>
      )}
    </HStack>
  );
}




