import { Button, HStack, Input, VStack } from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";

type CriteriaInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
};

/**
 * Criteria input matching the design.
 * Shows existing criteria with remove buttons, input + Add button.
 */
export function CriteriaInput({
  value,
  onChange,
  placeholder = "Add a criterion...",
}: CriteriaInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    if (inputValue.trim()) {
      onChange([...value, inputValue.trim()]);
      setInputValue("");
    }
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <VStack align="stretch" gap={2}>
      {/* Existing criteria */}
      {value.map((criterion, index) => (
        <HStack key={index} gap={2}>
          <Input value={criterion} size="sm" readOnly flex={1} bg="gray.50" />
          <button
            type="button"
            onClick={() => handleRemove(index)}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              padding: "8px",
              background: "transparent",
              border: "none",
              color: "var(--chakra-colors-gray-400)",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.color = "var(--chakra-colors-red-500)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.color = "var(--chakra-colors-gray-400)")
            }
          >
            <X size={14} />
          </button>
        </HStack>
      ))}

      {/* Add new criterion */}
      <HStack>
        <Input
          size="sm"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={placeholder}
          flex={1}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleAdd}
          color="blue.500"
        >
          <Plus size={14} />
          Add
        </Button>
      </HStack>
    </VStack>
  );
}




