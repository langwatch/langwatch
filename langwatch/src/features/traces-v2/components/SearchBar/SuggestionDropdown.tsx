import { Box, Button, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import type { SuggestionState } from "./getSuggestionState";
import type { SuggestionUIState } from "./suggestionUI";

interface SuggestionDropdownProps {
  ui: SuggestionUIState;
  onSelect: (label: string) => void;
}

export const SuggestionDropdown: React.FC<SuggestionDropdownProps> = ({
  ui,
  onSelect,
}) => {
  if (!ui.state.open || ui.items.length === 0) return null;
  const { state } = ui;

  return (
    <Box
      position="absolute"
      top="calc(100% + 4px)"
      left={0}
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      shadow="lg"
      zIndex={50}
      overflow="hidden"
      maxHeight="240px"
      overflowY="auto"
      minWidth="200px"
    >
      <VStack gap={0} align="stretch">
        {ui.items.map((label, index) => (
          <SuggestionRow
            key={label}
            label={label}
            state={state}
            isSelected={index === ui.selectedIndex}
            onSelect={onSelect}
          />
        ))}
      </VStack>
    </Box>
  );
};

interface SuggestionRowProps {
  label: string;
  state: Extract<SuggestionState, { open: true }>;
  isSelected: boolean;
  onSelect: (label: string) => void;
}

const SuggestionRow: React.FC<SuggestionRowProps> = ({
  label,
  state,
  isSelected,
  onSelect,
}) => {
  const primary = state.mode === "field" ? label : state.field;
  const secondary = state.mode === "field" ? "" : `:${label}`;

  return (
    <Button
      alignItems="center"
      justifyContent="flex-start"
      width="full"
      height="auto"
      minHeight="unset"
      paddingX={3}
      paddingY={1.5}
      data-selected={isSelected || undefined}
      _selected={{ bg: "blue.500/12" }}
      _hover={{ bg: "blue.500/8" }}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(label);
      }}
      variant="ghost"
      fontWeight="normal"
      borderRadius={0}
    >
      <Text textStyle="xs" fontFamily="mono">
        <Text as="span" color="fg" fontWeight="medium">
          {primary}
        </Text>
        {secondary && (
          <Text as="span" color="fg.muted">
            {secondary}
          </Text>
        )}
      </Text>
    </Button>
  );
};
