import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { BookOpen } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import {
  SEARCH_FIELDS,
  type SearchFieldMeta,
} from "~/server/app-layer/traces/query-language/queryParser";
import { useUIStore } from "../../stores/uiStore";
import type { SuggestionState } from "./getSuggestionState";
import type { SuggestionUIState } from "./suggestionUI";

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: anchorX !== undefined ? `${Math.max(0, anchorX)}px` : 0,
        borderRadius: "var(--chakra-radii-lg)",
        zIndex: 2050,
        minWidth: "320px",
        transformOrigin: "top",
        // Outer wrapper carries the focus ring + glow. No overflow:hidden here
        // so the ring is never clipped by the inner content's clipping context.
        boxShadow:
          "0 0 0 1px var(--chakra-colors-border), 0 0 0 4px color-mix(in oklab, var(--chakra-colors-blue-solid) 14%, transparent), 0 18px 40px -12px color-mix(in oklab, #000 40%, transparent)",
        background: "var(--chakra-colors-bg-panel)",
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
        <VStack gap={0} align="stretch" maxHeight="240px" overflowY="auto">
          {ui.items.map((label, index) => (
            <SuggestionRow
              key={label}
              label={label}
              state={state}
              count={ui.itemCounts?.[label]}
              isSelected={index === ui.selectedIndex}
              onSelect={onSelect}
            />
          ))}
        </VStack>
        <DropdownFooter />
      </Box>
    </motion.div>
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

interface SuggestionRowProps {
  label: string;
  state: Extract<SuggestionState, { open: true }>;
  count?: number;
  isSelected: boolean;
  onSelect: (label: string) => void;
}

const SuggestionRow: React.FC<SuggestionRowProps> = ({
  label,
  state,
  count,
  isSelected,
  onSelect,
}) => {
  const primary = state.mode === "field" ? label : state.field;
  const secondary = state.mode === "field" ? "" : `:${label}`;
  const fieldMeta = state.mode === "field" ? SEARCH_FIELDS[label] : undefined;

  return (
    <Button
      alignItems="center"
      justifyContent="space-between"
      width="full"
      height="auto"
      minHeight="unset"
      paddingX={3}
      paddingY={1.5}
      data-selected={isSelected || undefined}
      _selected={{ bg: "blue.solid/12" }}
      _hover={{ bg: "blue.solid/8" }}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(label);
      }}
      variant="ghost"
      fontWeight="normal"
      borderRadius={0}
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
    </Button>
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
