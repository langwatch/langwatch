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
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const syncCursor = () => {
    const element = inputRef.current;
    if (element) setCursor(element.selectionStart ?? 0);
  };

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
    requestAnimationFrame(() => {
      const element = inputRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.cursor, next.cursor);
    });
  };

  /** What a key does while the list is open; nothing when it is closed. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isListOpen) return;
    const action = KEY_ACTIONS[event.key];
    if (!action) return;
    if (action === "accept") {
      const row = highlightedRow(ui);
      if (!row) return;
      event.preventDefault();
      accept(row);
      return;
    }
    event.preventDefault();
    if (action === "close") {
      event.stopPropagation();
      setIsOpen(false);
      return;
    }
    setSelectedIndex(
      navigateSuggestion({ ui, direction: action }).selectedIndex,
    );
  };

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
