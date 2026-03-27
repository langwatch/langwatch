import { Button, HStack, IconButton, Spacer, Text, Textarea, VStack } from "@chakra-ui/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CriteriaInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * Criteria input with inline editing.
 * - Saved criteria render as numbered plain text with edit button.
 * - Clicking edit turns a criterion into an auto-resizing textarea.
 * - "+ Add criteria" button always visible at the bottom.
 */
export function CriteriaInput({
  value,
  onChange,
  placeholder = "Add a criterion...",
  disabled = false,
}: CriteriaInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const addRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isAddingNew) {
      requestAnimationFrame(() => addRef.current?.focus());
    }
  }, [isAddingNew]);

  const handleSaveNew = () => {
    if (inputValue.trim()) {
      onChange([...value, inputValue.trim()]);
      setInputValue("");
    }
    setIsAddingNew(false);
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setEditingIndex(null);
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(value[index] ?? "");
  };

  const handleSaveEdit = () => {
    if (editingIndex === null) return;
    if (editingValue.trim()) {
      const updated = [...value];
      updated[editingIndex] = editingValue.trim();
      onChange(updated);
    } else {
      // Empty text = remove the criterion
      onChange(value.filter((_, i) => i !== editingIndex));
    }
    setEditingIndex(null);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveNew();
    }
    if (e.key === "Escape") {
      setInputValue("");
      setIsAddingNew(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === "Escape") {
      setEditingIndex(null);
    }
  };

  return (
    <VStack align="stretch" gap={2}>
      {/* Existing criteria */}
      {value.map((criterion, index) =>
        editingIndex === index ? (
          <HStack key={index} gap={2} align="start">
            <Text fontSize="sm" color="fg.muted" flexShrink={0} mt="6px">
              {index + 1}.
            </Text>
            <VStack align="stretch" gap={1} flex={1}>
              <Textarea
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                size="sm"
                autoresize
                rows={2}
                autoFocus
              />
              <HStack gap={1}>
                <IconButton
                  type="button"
                  size="xs"
                  variant="outline"
                  colorPalette="red"
                  onClick={() => handleRemove(index)}
                  aria-label="Delete criterion"
                >
                  <Trash2 size={12} />
                </IconButton>
                <Spacer />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setEditingIndex(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={handleSaveEdit}
                >
                  Save
                </Button>
              </HStack>
            </VStack>
          </HStack>
        ) : (
          <HStack
            key={index}
            gap={1}
            align="start"
            py={1}
            role="group"
            cursor="pointer"
            onClick={() => handleStartEdit(index)}
          >
            <Text fontSize="sm" color="fg.muted" flexShrink={0} mt="1px">
              {index + 1}.
            </Text>
            <Text flex={1} fontSize="sm" whiteSpace="pre-wrap">
              {criterion}
            </Text>
            <Pencil
              size={14}
              style={{
                flexShrink: 0,
                marginTop: "2px",
                color: "var(--chakra-colors-fg-muted)",
              }}
            />
          </HStack>
        ),
      )}

      {/* Add new criterion form */}
      {isAddingNew && (
        <VStack align="stretch" gap={1}>
          <HStack gap={2} align="start">
            <Text fontSize="sm" color="fg.muted" flexShrink={0} mt="6px">
              {value.length + 1}.
            </Text>
            <Textarea
              ref={addRef}
              size="sm"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={placeholder}
              flex={1}
              onKeyDown={handleAddKeyDown}
              _placeholder={{ color: "gray.400", fontStyle: "italic" }}
              autoresize
              rows={2}
            />
          </HStack>
          <HStack gap={1} justify="end">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                setInputValue("");
                setIsAddingNew(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={handleSaveNew}
            >
              Save
            </Button>
          </HStack>
        </VStack>
      )}

      {/* Add criteria button */}
      {!isAddingNew && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAddingNew(true)}
          disabled={disabled}
          alignSelf="start"
        >
          <Plus size={14} />
          {value.length === 0 ? "Add the first criteria" : "Add criteria"}
        </Button>
      )}
    </VStack>
  );
}
