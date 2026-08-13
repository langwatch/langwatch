import { Badge, Box, chakra, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { type KeyboardEvent, useId, useRef } from "react";
import { GATED_NOTE, type LayoutGroup, type LayoutRow } from "./layoutRows";
import type { SlackBlockKitTemplateId } from "./registry";

interface Props {
  groups: LayoutGroup[];
  highlightedId: SlackBlockKitTemplateId | undefined;
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
  groups,
  highlightedId,
  onHighlight,
  onApply,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // Arrow keys move the preview, they never apply. Applying is Enter, Space or
  // a click, so walking the list past a layout built for the other cadence
  // can't switch the automation's cadence behind the author's back.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextId = nextIdFor({
      key: event.key,
      ids: groups.flatMap((group) => group.rows.map((row) => row.option.id)),
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
      gap={3}
      align="stretch"
      onKeyDown={handleKeyDown}
    >
      {groups.map((group) => (
        <GroupSection
          key={group.cadence}
          group={group}
          highlightedId={highlightedId}
          onHighlight={onHighlight}
          onApply={onApply}
        />
      ))}
    </Stack>
  );
}

function GroupSection({
  group,
  highlightedId,
  onHighlight,
  onApply,
}: Omit<Props, "groups"> & { group: LayoutGroup }) {
  const headingId = useId();
  return (
    <Stack
      gap={1}
      align="stretch"
      role={group.heading ? "group" : "presentation"}
      aria-labelledby={group.heading ? headingId : undefined}
    >
      {group.heading ? (
        <Text
          id={headingId}
          textStyle="2xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          {group.heading}
        </Text>
      ) : null}
      {group.rows.map((row) => (
        <LayoutOption
          key={row.option.id}
          row={row}
          isHighlighted={row.option.id === highlightedId}
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
  onHighlight,
  onApply,
}: {
  row: LayoutRow;
  isHighlighted: boolean;
  onHighlight: (id: SlackBlockKitTemplateId) => void;
  onApply: (row: LayoutRow) => void;
}) {
  const { option, locked, isDefault, isSelected } = row;
  return (
    <chakra.button
      type="button"
      role="option"
      aria-selected={isSelected}
      aria-disabled={locked ? true : undefined}
      data-layout-id={option.id}
      tabIndex={isHighlighted ? 0 : -1}
      textAlign="left"
      width="full"
      cursor={locked ? "not-allowed" : "pointer"}
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
        if (!locked) onApply(row);
      }}
    >
      <HStack gap={2}>
        <SelectionDot isSelected={isSelected} />
        <Text textStyle="xs" opacity={locked ? 0.6 : 1}>
          {option.emoji}
        </Text>
        <Text
          textStyle="xs"
          flex="1"
          lineClamp={1}
          color={locked ? "fg.muted" : "fg"}
          fontWeight={isSelected ? "medium" : "normal"}
        >
          {option.displayName}
        </Text>
        {locked ? (
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
    </chakra.button>
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
