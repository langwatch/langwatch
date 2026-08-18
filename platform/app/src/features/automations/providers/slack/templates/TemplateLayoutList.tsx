import { Badge, Box, chakra, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";
import { GATED_NOTE, type LayoutRow } from "./layoutRows";
import type { SlackBlockKitTemplateId } from "./registry";

interface Props {
  rows: LayoutRow[];
  highlightedId: SlackBlockKitTemplateId | undefined;
  /** The preview pane this list drives. The highlighted option points at it
   *  as its description, so what moved into the pane — the delivery note, the
   *  tagline, the connection a layout needs — is read out with the option a
   *  screen reader lands on, rather than being announced to nobody. */
  previewId: string;
  onHighlight: (id: SlackBlockKitTemplateId) => void;
  onApply: (row: LayoutRow) => void;
}

function nextIdFor({
  key,
  ids,
  highlightedId,
}: {
  key: string;
  ids: SlackBlockKitTemplateId[];
  highlightedId: SlackBlockKitTemplateId | undefined;
}): SlackBlockKitTemplateId | undefined {
  const last = ids.length - 1;
  const current = highlightedId ? ids.indexOf(highlightedId) : -1;
  if (key === "ArrowDown") return ids[Math.min(current + 1, last)];
  if (key === "ArrowUp") return ids[Math.max(current - 1, 0)];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[last];
  return undefined;
}

export function TemplateLayoutList({
  rows,
  highlightedId,
  previewId,
  onHighlight,
  onApply,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // Arrow keys move the preview, they never apply. Applying is Enter, Space or
  // a click, so walking the list to compare layouts can't change the
  // automation behind the author's back.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextId = nextIdFor({
      key: event.key,
      ids: rows.map((row) => row.option.id),
      highlightedId,
    });
    if (nextId === undefined) return;
    event.preventDefault();
    onHighlight(nextId);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-layout-id="${nextId}"]`)
      ?.focus();
  };

  return (
    <Stack
      ref={listRef}
      role="listbox"
      aria-label="Message layout"
      aria-controls={previewId}
      gap={1}
      align="stretch"
      onKeyDown={handleKeyDown}
    >
      {rows.map((row) => (
        <LayoutOption
          key={row.option.id}
          row={row}
          isHighlighted={row.option.id === highlightedId}
          previewId={previewId}
          onHighlight={onHighlight}
          onApply={onApply}
        />
      ))}
    </Stack>
  );
}

function LayoutOption({
  row,
  isHighlighted,
  previewId,
  onHighlight,
  onApply,
}: {
  row: LayoutRow;
  isHighlighted: boolean;
  previewId: string;
  onHighlight: (id: SlackBlockKitTemplateId) => void;
  onApply: (row: LayoutRow) => void;
}) {
  const { option, isLocked, isSelected } = row;
  return (
    <chakra.button
      type="button"
      role="option"
      aria-selected={isSelected}
      aria-disabled={isLocked ? true : undefined}
      aria-describedby={isHighlighted ? previewId : undefined}
      data-layout-id={option.id}
      tabIndex={isHighlighted ? 0 : -1}
      textAlign="left"
      width="full"
      cursor={isLocked ? "not-allowed" : "pointer"}
      borderWidth="1px"
      borderColor={isHighlighted ? "border.emphasized" : "transparent"}
      borderRadius="md"
      bg={isHighlighted ? "bg.muted" : undefined}
      paddingX={2}
      paddingY={1.5}
      transition="background-color 120ms ease"
      _hover={{ bg: "bg.muted" }}
      onFocus={() => onHighlight(option.id)}
      onClick={() => {
        onHighlight(option.id);
        if (!isLocked) onApply(row);
      }}
    >
      <OptionLabel row={row} />
    </chakra.button>
  );
}

function OptionLabel({ row }: { row: LayoutRow }) {
  const { option, isLocked, isDefault, isSelected } = row;
  return (
    <HStack gap={2}>
      <SelectionDot isSelected={isSelected} />
      <Text textStyle="xs" opacity={isLocked ? 0.6 : 1} aria-hidden>
        {option.emoji}
      </Text>
      <Text
        textStyle="xs"
        flex="1"
        lineClamp={1}
        color={isLocked ? "fg.muted" : "fg"}
        fontWeight={isSelected ? "medium" : "normal"}
      >
        {option.displayName}
      </Text>
      {isLocked ? (
        <>
          <Text srOnly>{GATED_NOTE}</Text>
          <Box color="fg.muted" flexShrink={0} aria-hidden>
            <Lock size={11} />
          </Box>
        </>
      ) : null}
      {isDefault ? (
        <Badge size="xs" variant="subtle" colorPalette="orange">
          Default
        </Badge>
      ) : null}
    </HStack>
  );
}

function SelectionDot({ isSelected }: { isSelected: boolean }) {
  return (
    <Box
      width="10px"
      height="10px"
      flexShrink={0}
      borderRadius="full"
      borderWidth={isSelected ? "3px" : "1px"}
      borderColor={isSelected ? "orange.solid" : "border.emphasized"}
    />
  );
}
