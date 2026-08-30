/**
 * One input that edits parameters and offers what the run declares.
 *
 * The field edits a `name=value, name=value` line, or the name or the value
 * of one row. Before the "=" of the token under the cursor it lists the
 * declared parameters, with their description, default and where they come
 * from; after it, it lists what the parameter accepts. The arrow keys move
 * through the list, Enter and Tab take the highlighted entry, Escape closes
 * the list. Free text always commits.
 *
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */

import { Badge, Box, chakra, HStack, Input, Text } from "@chakra-ui/react";
import { useRef } from "react";
import type { DeclaredParameter } from "~/components/suites/useRunSuite";
import { SuggestionPanel } from "~/features/traces-v2/components/SearchBar/SuggestionDropdown";
import { DIALOG_FIELD_STYLE, FieldError } from "../shared/DialogFields";
import type {
  ParameterFieldMode,
  ParameterSuggestionRow,
} from "./parameter-suggestions";
import { useParameterLineField } from "./useParameterLineField";

const LINE_MODE: ParameterFieldMode = { kind: "line" };

export function ParameterLineField({
  value,
  onChange,
  definitions,
  mode = LINE_MODE,
  placeholder,
  disabled = false,
  error,
  ariaLabel,
  testId,
  flex,
  minWidth,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The parameters the run declares, which the list offers. */
  definitions: readonly DeclaredParameter[];
  /** What the field edits: the whole line, or one row's name or value. */
  mode?: ParameterFieldMode;
  placeholder?: string;
  disabled?: boolean;
  /** What the server refused about this field, read under it. */
  error?: string;
  ariaLabel: string;
  testId: string;
  flex?: string | number;
  minWidth?: number | string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const list = useParameterLineField({
    value,
    onChange,
    definitions,
    mode,
    inputRef,
  });

  return (
    <Box position="relative" flex={flex} minWidth={minWidth}>
      <Input
        {...DIALOG_FIELD_STYLE}
        ref={inputRef}
        width="full"
        fontFamily="mono"
        fontSize="12px"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-expanded={list.isListOpen}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          list.edit(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length,
          )
        }
        onKeyDown={list.onKeyDown}
        onKeyUp={list.syncCursor}
        onClick={list.syncCursor}
        onFocus={() => {
          list.syncCursor();
          list.open();
        }}
        onBlur={list.closeAfterBlur}
        data-testid={testId}
      />
      {list.isListOpen && (
        <SuggestionPanel testId={`${testId}-suggestions`}>
          {list.items.map((row, index) => (
            <ParameterSuggestionRowView
              key={`${row.kind}:${row.value}`}
              row={row}
              isSelected={index === list.ui.selectedIndex}
              onSelect={list.accept}
            />
          ))}
        </SuggestionPanel>
      )}
      <FieldError message={error} />
    </Box>
  );
}

/** Where a key comes from, in one word or the agent's label. */
function SourceBadge({ row }: { row: ParameterSuggestionRow }) {
  if (!row.source) return null;
  return (
    <Badge
      size="xs"
      variant="subtle"
      colorPalette={row.source === "agent" ? "purple" : "blue"}
      flexShrink={0}
      marginLeft="auto"
      maxWidth="160px"
      truncate
    >
      {row.source === "agent" ? (row.agentLabel ?? "agent") : "scenario"}
    </Badge>
  );
}

/** One row of the list: a key with what it is, or a value. */
function ParameterSuggestionRowView({
  row,
  isSelected,
  onSelect,
}: {
  row: ParameterSuggestionRow;
  isSelected: boolean;
  onSelect: (row: ParameterSuggestionRow) => void;
}) {
  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      width="full"
      paddingX={3}
      paddingY={1.5}
      gap={2}
      textAlign="left"
      bg={isSelected ? "blue.solid/12" : "transparent"}
      color="fg"
      cursor="pointer"
      _hover={{ bg: "blue.solid/8" }}
      onMouseDown={(event) => {
        // mouseDown, so the input's blur does not close the list first.
        event.preventDefault();
        onSelect(row);
      }}
      role="option"
      aria-selected={isSelected}
      data-testid={`parameter-suggestion-${row.kind}-${row.value}`}
    >
      <HStack gap={2} minWidth={0} flex={1}>
        <Text
          textStyle="xs"
          fontFamily="mono"
          fontWeight="medium"
          flexShrink={0}
        >
          {row.label}
        </Text>
        {row.description && (
          <Text textStyle="2xs" color="fg.subtle" truncate minWidth={0}>
            {row.description}
          </Text>
        )}
        {row.defaultText !== undefined && row.defaultText !== "" && (
          <Text
            textStyle="2xs"
            color="fg.subtle"
            fontFamily="mono"
            flexShrink={0}
          >
            default {row.defaultText}
          </Text>
        )}
        {row.isTyped && (
          <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
            as typed
          </Text>
        )}
        <SourceBadge row={row} />
      </HStack>
    </chakra.button>
  );
}
