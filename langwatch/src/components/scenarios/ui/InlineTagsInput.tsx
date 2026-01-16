import { HStack, Input, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useRef, useState } from "react";

type InlineTagsInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
};

/**
 * Inline tags input with auto-add on blur/Enter.
 * Shows tags with x buttons and an input that automatically adds labels.
 * Labels are added when: pressing Enter, pressing comma, or clicking outside.
 */
export function InlineTagsInput({
  value,
  onChange,
  placeholder = "Add label...",
}: InlineTagsInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addLabel = (label: string) => {
    const trimmed = label.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue("");
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addLabel(inputValue);
    }
    if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      // Remove last tag when pressing backspace on empty input
      onChange(value.slice(0, -1));
    }
  };

  const handleBlur = () => {
    // Auto-add label when user clicks away
    if (inputValue.trim()) {
      addLabel(inputValue);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // If user types a comma, add the label immediately
    if (val.includes(",")) {
      const parts = val.split(",");
      parts.forEach((part, i) => {
        if (i < parts.length - 1) {
          addLabel(part);
        } else {
          setInputValue(part);
        }
      });
    } else {
      setInputValue(val);
    }
  };

  return (
    <HStack
      flexWrap="wrap"
      gap={2}
      align="center"
      padding={2}
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      minHeight="40px"
      cursor="text"
      onClick={() => inputRef.current?.focus()}
      _focusWithin={{
        borderColor: "blue.500",
        boxShadow: "0 0 0 1px var(--chakra-colors-blue-500)",
      }}
    >
      {/* Existing tags */}
      {value.map((tag, index) => (
        <HStack
          key={index}
          bg="blue.50"
          color="blue.700"
          px={2}
          py={0.5}
          borderRadius="md"
          fontSize="sm"
          gap={1}
        >
          <Text>{tag}</Text>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove(index);
            }}
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

      {/* Input field - always visible */}
      <Input
        ref={inputRef}
        size="sm"
        variant="flushed"
        border="none"
        width="auto"
        minWidth="100px"
        flex={1}
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ""}
        _placeholder={{ color: "gray.400" }}
        _focus={{ boxShadow: "none" }}
      />
    </HStack>
  );
}
