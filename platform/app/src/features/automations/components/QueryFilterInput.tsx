import { Box, Textarea } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSuggestionState } from "~/features/traces-v2/components/SearchBar/getSuggestionState";
import { SuggestionDropdown } from "~/features/traces-v2/components/SearchBar/SuggestionDropdown";
import { SyntaxHelpDrawerHost } from "~/features/traces-v2/components/SearchBar/SyntaxHelpDrawer";
import {
  buildSuggestionUI,
  CLOSED_SUGGESTION,
  highlightedRow,
  navigateSuggestion,
  type SuggestionRow,
} from "~/features/traces-v2/components/SearchBar/suggestionUI";

/**
 * A controlled trace-filter query input with field/value autocomplete.
 *
 * Reuses the traces-view suggestion engine AND its dropdown verbatim
 * (`getSuggestionState` + `buildSuggestionUI` + `SuggestionDropdown`), so the
 * fields, values, grouping, icons, and ranking match the search bar exactly —
 * but stays fully controlled off a `value`/`onChange` pair instead of the
 * traces-view's global filter store, so editing here never touches the live
 * traces view. The syntax-docs drawer the dropdown footer opens is mounted
 * locally so that affordance works here too.
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
  const [selectedIndex, setSelectedIndex] = useState(0);

  const state = useMemo(
    () => getSuggestionState(value, cursor),
    [value, cursor],
  );

  const ui = useMemo(
    () =>
      open
        ? buildSuggestionUI({ state, previousSelected: selectedIndex })
        : CLOSED_SUGGESTION,
    [open, state, selectedIndex],
  );

  // Keep the highlighted row in range as the candidate list changes.
  useEffect(() => {
    setSelectedIndex((h) => (h >= ui.items.length ? 0 : h));
  }, [ui.items.length]);

  const showDropdown = open && ui.state.open && ui.items.length > 0;

  const syncCursor = () => {
    const el = ref.current;
    if (el) setCursor(el.selectionStart ?? 0);
  };

  const accept = (row: SuggestionRow) => {
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

  const acceptByValue = (rowValue: string) => {
    const row = ui.items.find((r) => r.value === rowValue);
    if (row) accept(row);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(navigateSuggestion({ ui, direction: "down" }).selectedIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(navigateSuggestion({ ui, direction: "up" }).selectedIndex);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const row = highlightedRow(ui);
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
        <SuggestionDropdown ui={ui} onSelect={acceptByValue} />
      ) : null}
      <SyntaxHelpDrawerHost />
    </Box>
  );
}
