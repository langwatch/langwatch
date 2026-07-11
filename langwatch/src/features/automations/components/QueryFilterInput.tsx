import { Box, Code, HStack, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSuggestionState } from "~/features/traces-v2/components/SearchBar/getSuggestionState";
import {
  getFieldSuggestions,
  getValueSuggestions,
} from "~/features/traces-v2/components/SearchBar/suggestionItems";

/** One dropdown row: `value` lands in the query, `label`/`hint` render. */
interface Row {
  value: string;
  label: string;
  hint?: string;
  isPrefix?: boolean;
}

/**
 * A controlled trace-filter query input with field/value autocomplete.
 *
 * Reuses the traces-view suggestion engine verbatim (`getSuggestionState` +
 * `getFieldSuggestions` / `getValueSuggestions`), so the fields, values, and
 * ranking match the search bar exactly — but stays fully controlled off a
 * `value`/`onChange` pair instead of the traces-view's global filter store, so
 * editing here never touches the live traces view.
 */
export function QueryFilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const state = useMemo(
    () => getSuggestionState(value, cursor),
    [value, cursor],
  );

  const rows: Row[] = useMemo(() => {
    if (!state.open) return [];
    if (state.mode === "field") {
      return getFieldSuggestions(state.query).map((i) => ({
        value: i.value,
        label: i.label,
        hint: i.field,
        isPrefix: i.isPrefix,
      }));
    }
    return getValueSuggestions(state.field, state.query).map((v) => ({
      value: v,
      label: v,
    }));
  }, [state]);

  // Keep the highlighted row in range as the candidate list changes.
  useEffect(() => {
    setHighlight((h) => (h >= rows.length ? 0 : h));
  }, [rows.length]);

  const showDropdown = open && rows.length > 0;

  const syncCursor = () => {
    const el = ref.current;
    if (el) setCursor(el.selectionStart ?? 0);
  };

  const accept = (row: Row) => {
    if (!state.open) return;
    // Fields append `:` (ready for a value) unless they're a dynamic prefix
    // that still needs a key; accepted values get a trailing space.
    const suffix = state.mode === "field" ? (row.isPrefix ? "" : ":") : " ";
    // Replace only the fragment typed so far — `state.query` — so a value
    // accept keeps the `field:` prefix intact rather than clobbering the token.
    const fragmentStart = cursor - state.query.length;
    const before = value.slice(0, fragmentStart);
    const after = value.slice(cursor);
    const inserted = `${row.value}${suffix}`;
    const nextValue = before + inserted + after;
    const nextCursor = (before + inserted).length;
    onChange(nextValue);
    // Keep the dropdown open after a field (so the user picks a value next);
    // close after committing a value.
    setOpen(state.mode === "field");
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const row = rows[highlight];
      if (row) accept(row);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Box position="relative">
      <Textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        fontFamily="mono"
        fontSize="sm"
        rows={2}
        autoresize
        onChange={(e) => {
          onChange(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCursor}
        onClick={syncCursor}
        onFocus={() => {
          syncCursor();
          setOpen(true);
        }}
        // Delay close so a mousedown on a dropdown row still registers.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showDropdown ? (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          marginTop={1}
          zIndex="dropdown"
          maxHeight="240px"
          overflowY="auto"
          bg="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          boxShadow="md"
          paddingY={1}
        >
          {rows.map((row, i) => (
            <HStack
              key={`${row.value}-${i}`}
              gap={2}
              paddingX={3}
              paddingY={1.5}
              cursor="pointer"
              bg={i === highlight ? "bg.emphasized" : undefined}
              _hover={{ bg: "bg.emphasized" }}
              onMouseEnter={() => setHighlight(i)}
              // mousedown (not click) so it fires before the textarea blur.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(row);
              }}
            >
              <Text textStyle="sm" flex={1} minWidth={0} truncate>
                {row.label}
              </Text>
              {row.hint && row.hint !== row.label ? (
                <Code size="sm" color="fg.muted" flexShrink={0}>
                  {row.hint}
                </Code>
              ) : null}
            </HStack>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
