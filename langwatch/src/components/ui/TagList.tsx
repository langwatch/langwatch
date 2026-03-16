/**
 * Lovable-style tag list component for displaying and managing labels.
 *
 * Renders a list of TagPills with optional add/remove actions.
 * Display-only when neither onRemove nor onAdd are provided.
 */

import { Button, HStack, Input } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { TagPill } from "./TagPill";

type TagListProps = {
  labels: string[];
  onRemove?: (label: string, index: number) => void;
  onAdd?: (label: string) => void;
};

export function TagList({ labels, onRemove, onAdd }: TagListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const submittedRef = useRef(false);

  if (labels.length === 0 && !onAdd) {
    return null;
  }

  const addCurrentValue = () => {
    const trimmed = inputValue.trim();
    if (trimmed && onAdd && !labels.includes(trimmed)) {
      onAdd(trimmed);
    }
    setInputValue("");
  };

  const handleBlur = () => {
    if (submittedRef.current) return;
    addCurrentValue();
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCurrentValue();
    }
    if (e.key === "Escape") {
      submittedRef.current = true;
      setInputValue("");
      setIsAdding(false);
    }
  };

  return (
    <HStack gap={1} flexWrap="wrap">
      {labels.map((label, index) => (
        <TagPill
          key={`${label}-${index}`}
          label={label}
          onRemove={onRemove ? () => onRemove(label, index) : undefined}
        />
      ))}
      {onAdd && !isAdding && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          borderRadius="full"
          borderColor="border"
          onClick={(e) => {
            e.stopPropagation();
            submittedRef.current = false;
            setIsAdding(true);
          }}
        >
          + add
        </Button>
      )}
      {onAdd && isAdding && (
        <Input
          size="xs"
          placeholder="Add label..."
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          width="100px"
          borderRadius="full"
          autoFocus
        />
      )}
    </HStack>
  );
}
