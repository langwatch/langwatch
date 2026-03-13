/**
 * Lovable-style tag pill components for displaying labels across surfaces.
 *
 * TagPill renders a single tag as a rounded pill with optional
 * remove button. TagList renders a list of tags with optional add/remove actions.
 */

import { HStack, Input, Text, chakra } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useRef, useState } from "react";

const StyledButton = chakra("button");

type TagPillProps = {
  label: string;
  onRemove?: () => void;
};

/** A single tag rendered as a rounded pill. */
export function TagPill({ label, onRemove }: TagPillProps) {
  return (
    <HStack
      gap={1}
      bg="bg.muted"
      px={2}
      py={0.5}
      borderRadius="full"
      fontSize="xs"
      data-testid={`tag-pill-${label}`}
    >
      <Text fontSize="xs">{label}</Text>
      {onRemove && (
        <StyledButton
          type="button"
          aria-label={`Remove ${label} tag`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
          display="flex"
          alignItems="center"
          cursor="pointer"
          color="fg.muted"
          _hover={{ color: "fg" }}
          background="transparent"
          border="none"
          padding={0}
        >
          <X size={12} />
        </StyledButton>
      )}
    </HStack>
  );
}

type TagListProps = {
  labels: string[];
  onRemove?: (label: string, index: number) => void;
  onAdd?: (label: string) => void;
};

/**
 * Renders a list of TagPills with optional add/remove functionality.
 * Display-only when neither onRemove nor onAdd are provided.
 */
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
        <StyledButton
          type="button"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            submittedRef.current = false;
            setIsAdding(true);
          }}
          px={2}
          py={0.5}
          borderRadius="full"
          border="1px dashed"
          borderColor="border"
          fontSize="xs"
          color="fg.muted"
          cursor="pointer"
          background="transparent"
          _hover={{ borderColor: "fg.muted", color: "fg" }}
        >
          + add
        </StyledButton>
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
