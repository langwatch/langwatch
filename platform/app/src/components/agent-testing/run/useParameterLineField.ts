/**
 * The list under a parameter field: what it offers for the token under the
 * cursor, which row is highlighted, and how a key or a click takes one.
 *
 * The field renders; this holds the state, so the rules that open, move and
 * close the list can be read on their own.
 *
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeclaredParameter } from "~/components/suites/useRunSuite";
import {
  highlightedRow,
  navigateSuggestion,
  type SuggestionUIState,
} from "~/features/traces-v2/components/SearchBar/suggestionUI";
import { useReportOpenList } from "../shared/OpenListContext";
import {
  acceptParameterField,
  type ParameterFieldMode,
  type ParameterSuggestionRow,
  parameterFieldState,
  parameterSuggestions,
} from "./parameter-suggestions";

/** How long a blur waits before the list closes, so a click on a row lands. */
const CLOSE_AFTER_BLUR_MS = 150;

/** Whether the list is open, with a blur that waits for a click on a row. */
function useListOpenState() {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const open = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setIsOpen(true);
  };

  const closeAfterBlur = () => {
    closeTimer.current = setTimeout(
      () => setIsOpen(false),
      CLOSE_AFTER_BLUR_MS,
    );
  };

  return { isOpen, setIsOpen, open, closeAfterBlur };
}

/** Puts the cursor back into the field after a row is taken. */
function restoreCursor({
  inputRef,
  at,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  at: number;
}) {
  requestAnimationFrame(() => {
    const element = inputRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(at, at);
  });
}

/** What a key does while the list is open; nothing when it is closed. */
function handleListKey({
  event,
  ui,
  isListOpen,
  onAccept,
  onClose,
  onNavigate,
}: {
  event: React.KeyboardEvent<HTMLInputElement>;
  ui: SuggestionUIState<ParameterSuggestionRow>;
  isListOpen: boolean;
  onAccept: (row: ParameterSuggestionRow) => void;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  if (!isListOpen) return;
  const action = KEY_ACTIONS[event.key];
  if (!action) return;
  if (action === "accept") {
    const row = highlightedRow(ui);
    if (!row) return;
    event.preventDefault();
    onAccept(row);
    return;
  }
  event.preventDefault();
  if (action === "close") {
    event.stopPropagation();
    onClose();
    return;
  }
  onNavigate(navigateSuggestion({ ui, direction: action }).selectedIndex);
}

export function useParameterLineField({
  value,
  onChange,
  definitions,
  mode,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  definitions: readonly DeclaredParameter[];
  mode: ParameterFieldMode;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [cursor, setCursor] = useState(0);
  const { isOpen, setIsOpen, open, closeAfterBlur } = useListOpenState();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const state = useMemo(
    () => parameterFieldState({ mode, text: value, cursor }),
    [mode, value, cursor],
  );
  const items = useMemo(
    () => parameterSuggestions({ state, definitions }),
    [state, definitions],
  );
  const ui: SuggestionUIState<ParameterSuggestionRow> = useMemo(
    () => ({
      state,
      items,
      selectedIndex: Math.min(selectedIndex, Math.max(items.length - 1, 0)),
    }),
    [state, items, selectedIndex],
  );

  const isListOpen = isOpen && state.open && items.length > 0;
  useReportOpenList(isListOpen);

  // The list changes under the highlight as the text does; keep it in range.
  useEffect(() => {
    setSelectedIndex((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  const syncCursor = () => {
    const element = inputRef.current;
    if (element) setCursor(element.selectionStart ?? 0);
  };

  const edit = (text: string, at: number) => {
    onChange(text);
    setCursor(at);
    open();
  };

  const accept = (row: ParameterSuggestionRow) => {
    if (!state.open) return;
    const next = acceptParameterField({
      mode,
      text: value,
      cursor,
      state,
      row,
    });
    onChange(next.text);
    setCursor(next.cursor);
    setSelectedIndex(0);
    setIsOpen(next.reopens);
    restoreCursor({ inputRef, at: next.cursor });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) =>
    handleListKey({
      event,
      ui,
      isListOpen,
      onAccept: accept,
      onClose: () => setIsOpen(false),
      onNavigate: setSelectedIndex,
    });

  return {
    ui,
    items,
    isListOpen,
    syncCursor,
    open,
    closeAfterBlur,
    edit,
    accept,
    onKeyDown,
  };
}

const KEY_ACTIONS: Record<string, "up" | "down" | "accept" | "close"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "accept",
  Tab: "accept",
  Escape: "close",
};
