import { Badge, Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { BookOpen } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import {
  type SearchFieldGroup,
  SEARCH_FIELDS,
  type SearchFieldMeta,
} from "~/server/app-layer/traces/query-language/metadata";
import { useUIStore } from "../../stores/uiStore";
import type { SuggestionState } from "./getSuggestionState";
import { SUGGESTION_GROUPS } from "./suggestionItems";
import type { SuggestionRow, SuggestionUIState } from "./suggestionUI";

interface SuggestionDropdownProps {
  ui: SuggestionUIState;
  onSelect: (label: string) => void;
  /**
   * Horizontal offset (in pixels) from the search bar's left edge to the
   * cursor's screen position. The dropdown anchors there instead of the
   * far-left of the input — important when typing the second/third clause
   * so the suggestions sit under the active token, not back at column 0.
   */
  anchorX?: number;
}

export const SuggestionDropdown: React.FC<SuggestionDropdownProps> = ({
  ui,
  onSelect,
  anchorX,
}) => {
  if (!ui.state.open || ui.items.length === 0) return null;
  const { state } = ui;

  return (
    <Box
      position="absolute"
      top="calc(100% + 6px)"
      left={anchorX !== undefined ? `${Math.max(0, anchorX)}px` : 0}
      borderRadius="lg"
      zIndex={2050}
      minWidth="320px"
      bg="bg.panel"
      boxShadow="0 0 0 1px var(--chakra-colors-border), 0 0 0 4px color-mix(in oklab, var(--chakra-colors-blue-solid) 14%, transparent), 0 18px 40px -12px color-mix(in oklab, #000 40%, transparent)"
      animation="suggestion-dropdown-fade 120ms ease-out"
      css={{
        "@keyframes suggestion-dropdown-fade": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      <Box
        borderRadius="lg"
        overflow="hidden"
        display="flex"
        flexDirection="column"
        bg="bg.panel"
        position="relative"
      >
        <VStack gap={0} align="stretch" maxHeight="320px" overflowY="auto">
          <GroupedItems ui={ui} state={state} onSelect={onSelect} />
        </VStack>
        <DropdownFooter />
      </Box>
    </Box>
  );
};

const DropdownFooter: React.FC = () => {
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      borderTopWidth="1px"
      borderColor="border"
      bg="bg.subtle"
      justify="space-between"
    >
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
        ↑↓ navigate · ⏎ select · esc close
      </Text>
      <Button
        size="2xs"
        variant="ghost"
        color="blue.fg"
        onMouseDown={(event) => {
          // mouseDown so the editor's onBlur doesn't race with the click —
          // openning the drawer needs to win even though the search loses focus.
          event.preventDefault();
          setSyntaxHelpOpen(true);
        }}
      >
        <BookOpen size={11} />
        <Text textStyle="2xs">Syntax docs</Text>
      </Button>
    </HStack>
  );
};

/**
 * Renders the items partitioned by `group`. Field-mode dropdowns show
 * section headers (Trace / Span / Event / Eval / Metrics / Scenario);
 * value-mode dropdowns have no group and render as a single ungrouped
 * list. Selection index threads through the partitioned layout —
 * keyboard navigation walks the *flat* list (`ui.items`) and we map
 * each row's flat index back to a per-section slot when rendering.
 */
const GroupedItems: React.FC<{
  ui: SuggestionUIState;
  state: Extract<SuggestionState, { open: true }>;
  onSelect: (label: string) => void;
}> = ({ ui, state, onSelect }) => {
  const grouped = useMemo(() => groupRows(ui.items), [ui.items]);

  if (state.mode === "value") {
    return (
      <>
        {ui.items.map((row, index) => (
          <SuggestionRowView
            key={row.value}
            row={row}
            state={state}
            count={ui.itemCounts?.[row.value]}
            isSelected={index === ui.selectedIndex}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {grouped.map((section) => (
        <Box key={section.label}>
          <Box
            paddingX={3}
            paddingY={1.5}
            bg="bg.subtle"
            borderTopWidth={section.first ? "0px" : "1px"}
            borderColor="border.subtle"
          >
            <Text
              textStyle="2xs"
              fontWeight="700"
              color="fg.subtle"
              textTransform="uppercase"
              letterSpacing="0.1em"
            >
              {section.label}
            </Text>
          </Box>
          {section.rows.map(({ row, flatIndex }) => (
            <SuggestionRowView
              key={row.value}
              row={row}
              state={state}
              count={ui.itemCounts?.[row.value]}
              isSelected={flatIndex === ui.selectedIndex}
              onSelect={onSelect}
            />
          ))}
        </Box>
      ))}
    </>
  );
};

interface GroupedSection {
  label: string;
  first: boolean;
  rows: Array<{ row: SuggestionRow; flatIndex: number }>;
}

function groupRows(items: SuggestionRow[]): GroupedSection[] {
  const buckets = new Map<
    string,
    { label: string; rows: Array<{ row: SuggestionRow; flatIndex: number }> }
  >();
  for (let i = 0; i < items.length; i++) {
    const row = items[i]!;
    const groupId = row.group ?? "__other__";
    const label = labelForGroup(row.group) ?? "Other";
    let bucket = buckets.get(groupId);
    if (!bucket) {
      bucket = { label, rows: [] };
      buckets.set(groupId, bucket);
    }
    bucket.rows.push({ row, flatIndex: i });
  }
  // Order sections by SUGGESTION_GROUPS, then trailing `Other`.
  const ordered: GroupedSection[] = [];
  for (const spec of SUGGESTION_GROUPS) {
    const b = buckets.get(spec.id);
    if (b) {
      ordered.push({ label: b.label, first: ordered.length === 0, rows: b.rows });
      buckets.delete(spec.id);
    }
  }
  for (const [, b] of buckets) {
    ordered.push({ label: b.label, first: ordered.length === 0, rows: b.rows });
  }
  return ordered;
}

function labelForGroup(group: SearchFieldGroup | null): string | null {
  if (!group) return null;
  return SUGGESTION_GROUPS.find((g) => g.id === group)?.label ?? null;
}

interface SuggestionRowProps {
  row: SuggestionRow;
  state: Extract<SuggestionState, { open: true }>;
  count?: number;
  isSelected: boolean;
  onSelect: (label: string) => void;
}

const SuggestionRowView: React.FC<SuggestionRowProps> = ({
  row,
  state,
  count,
  isSelected,
  onSelect,
}) => {
  const primary = state.mode === "field" ? row.label : state.field;
  const secondary = state.mode === "field" ? "" : `:${row.label}`;
  const fieldMeta =
    state.mode === "field" && !row.isPrefix
      ? SEARCH_FIELDS[row.value]
      : undefined;

  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      width="full"
      paddingX={3}
      paddingY={1.5}
      textAlign="left"
      bg={isSelected ? "blue.solid/12" : "transparent"}
      color="fg"
      cursor="pointer"
      _hover={{ bg: "blue.solid/8" }}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(row.value);
      }}
    >
      <HStack gap={2} minWidth={0} flex={1}>
        <Text textStyle="xs" fontFamily="mono" flexShrink={0}>
          <Text as="span" color="fg" fontWeight="medium">
            {primary}
          </Text>
          {secondary && (
            <Text as="span" color="fg.muted">
              {secondary}
            </Text>
          )}
        </Text>
        {fieldMeta && <FieldMetaSummary meta={fieldMeta} />}
        {row.isPrefix && (
          <Badge
            size="xs"
            variant="subtle"
            colorPalette="purple"
            flexShrink={0}
          >
            drill in
          </Badge>
        )}
      </HStack>
      {count !== undefined && (
        <Text
          textStyle="2xs"
          color="fg.subtle"
          fontFamily="mono"
          marginLeft={2}
        >
          {count}
        </Text>
      )}
    </chakra.button>
  );
};

const TYPE_PALETTE: Record<SearchFieldMeta["valueType"], string> = {
  categorical: "blue",
  range: "green",
  text: "gray",
  existence: "purple",
};

const TYPE_HINT: Record<SearchFieldMeta["valueType"], string> = {
  categorical: "= · *",
  range: "> · ≥ · [..]",
  text: '= · "…"',
  existence: "yes/no",
};

const FieldMetaSummary: React.FC<{ meta: SearchFieldMeta }> = ({ meta }) => (
  <HStack gap={1.5} minWidth={0} flexShrink={1} overflow="hidden">
    <Badge
      size="xs"
      variant="subtle"
      colorPalette={TYPE_PALETTE[meta.valueType]}
      flexShrink={0}
    >
      {meta.valueType}
    </Badge>
    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" truncate>
      {TYPE_HINT[meta.valueType]}
    </Text>
    <Text textStyle="2xs" color="fg.subtle" truncate>
      {meta.label}
    </Text>
  </HStack>
);
