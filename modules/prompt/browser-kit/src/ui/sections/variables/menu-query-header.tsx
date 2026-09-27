import { Box, Input, Text } from "@chakra-ui/react";
import type { RefObject } from "react";

/** A suggestion menu's search input, or the typed query when it is read-only. */
export function MenuQueryHeader({
  query,
  onQueryChange,
  inputRef,
  onMove,
  onEnter,
  onEscape,
  readOnlyText,
  placeholder,
}: {
  query: string;
  onQueryChange?: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onMove: (delta: 1 | -1) => void;
  onEnter: () => void;
  onEscape: () => void;
  /** Shown in place of the input when the query is read-only. */
  readOnlyText: string;
  placeholder: string;
}) {
  if (!onQueryChange) {
    if (!query) return null;
    return (
      <Box padding={2} borderBottom="1px solid" borderColor="border.muted" background="bg.subtle">
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">
          {readOnlyText}
        </Text>
      </Box>
    );
  }
  const keyActions: Record<string, () => void> = {
    ArrowDown: () => onMove(1),
    ArrowUp: () => onMove(-1),
    Enter: onEnter,
    Escape: onEscape,
  };
  return (
    <Box padding={2} borderBottom="1px solid" borderColor="border.muted">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          const action = keyActions[e.key];
          if (!action) return;
          e.preventDefault();
          action();
        }}
        placeholder={placeholder}
        size="sm"
        variant="outline"
      />
    </Box>
  );
}
