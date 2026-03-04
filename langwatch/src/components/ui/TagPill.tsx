/**
 * Lovable-style tag pill components for displaying labels across surfaces.
 *
 * TagPill renders a single tag as a rounded pill with `#` prefix and optional
 * remove button. TagList renders a list of tags with optional add/remove actions.
 */

import { Box, HStack, Input, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useRef, useState } from "react";

type TagPillProps = {
  label: string;
  onRemove?: () => void;
};

/** A single tag rendered as a rounded pill with `#` prefix. */
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
      <Text fontSize="xs">#{label}</Text>
      {onRemove && (
        <Box
          as="button"
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
        </Box>
      )}
    </HStack>
  );
}

type TagListProps = {
  labels: string[];
  onRemove?: (label: string) => void;
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

  const handleSubmit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = inputValue.trim();
    if (trimmed && onAdd) {
      onAdd(trimmed);
    }
    setInputValue("");
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      submittedRef.current = true;
      setInputValue("");
      setIsAdding(false);
    }
  };

  return (
    <HStack gap={1} flexWrap="wrap">
      {labels.map((label) => (
        <TagPill
          key={label}
          label={label}
          onRemove={onRemove ? () => onRemove(label) : undefined}
        />
      ))}
      {onAdd && !isAdding && (
        <Box
          as="button"
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
        </Box>
      )}
      {onAdd && isAdding && (
        <Input
          size="xs"
          placeholder="Add label..."
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSubmit}
          width="100px"
          borderRadius="full"
          autoFocus
        />
      )}
    </HStack>
  );
}
