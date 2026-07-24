import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaretPosition } from "rich-textarea";
import {
  TEMPLATE_LOGIC_CONSTRUCTS,
  type TemplateLogicConstruct,
} from "../templateLogicConstructs";
import { getCaretCoordinates, setTextareaValueUndoable } from "../utils";

type UseTemplateLogicMenuProps = {
  localValue: string;
  setValueImmediate: (value: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Shared caret position ref (owned by parent, shared across menus) */
  caretPositionRef: React.RefObject<CaretPosition | null>;
  /** Shared last user cursor position ref (owned by parent, shared across menus) */
  lastUserCursorPosRef: React.RefObject<number>;
};

export const useTemplateLogicMenu = ({
  localValue,
  setValueImmediate,
  containerRef,
  caretPositionRef,
  lastUserCursorPosRef,
}: UseTemplateLogicMenuProps) => {
  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [menuQuery, setMenuQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  // When true, menu was opened via button (shows search input, inserts full construct)
  const [buttonMenuMode, setButtonMenuMode] = useState(false);

  // Ref to the add logic button for positioning
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Filter constructs by query (case-insensitive startsWith)
  const filteredConstructs = useMemo(() => {
    if (!menuQuery) return TEMPLATE_LOGIC_CONSTRUCTS;
    const lowerQuery = menuQuery.toLowerCase();
    return TEMPLATE_LOGIC_CONSTRUCTS.filter((c) =>
      c.keyword.startsWith(lowerQuery),
    );
  }, [menuQuery]);

  const optionCount = filteredConstructs.length;

  // Reset highlighted index when query changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [menuQuery]);

  // Open the menu
  const openMenu = useCallback(
    (start: number, query: string) => {
      const coords = getCaretCoordinates({ caretPositionRef, containerRef });
      setMenuPosition(coords);
      setMenuQuery(query);
      setTriggerStart(start);
      setHighlightedIndex(0);
      setMenuOpen(true);
    },
    [caretPositionRef, containerRef],
  );

  // Close the menu
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setTriggerStart(null);
    setMenuQuery("");
    setHighlightedIndex(0);
    setButtonMenuMode(false);
  }, []);

  // Insert a construct at the trigger position (undo-able via Ctrl+Z)
  const insertConstruct = useCallback(
    (construct: TemplateLogicConstruct) => {
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      // Calculate the start of the {% trigger text to replace
      // triggerStart is the position after {%, so {% starts at triggerStart - 2
      const replaceStart = buttonMenuMode ? triggerStart : triggerStart - 2;
      const replaceEnd = cursorPos;

      const before = localValue.substring(0, replaceStart);
      const after = localValue.substring(replaceEnd);

      // Parse the insertion template - "|" marks cursor position
      const template = construct.insertionTemplate;
      const pipeIndex = template.indexOf("|");

      let insertText: string;
      let newCursorPos: number;

      if (pipeIndex >= 0) {
        // Remove the pipe and calculate cursor position
        insertText = template.substring(0, pipeIndex) + template.substring(pipeIndex + 1);
        newCursorPos = before.length + pipeIndex;
      } else {
        insertText = template;
        newCursorPos = before.length + template.length;
      }

      const newValue = `${before}${insertText}${after}`;

      // Use undo-able replacement so Ctrl+Z works
      if (nativeTextarea) {
        setTextareaValueUndoable(nativeTextarea, newValue, newCursorPos);
      }
      setValueImmediate(newValue);
      closeMenu();
    },
    [
      localValue,
      setValueImmediate,
      triggerStart,
      buttonMenuMode,
      closeMenu,
      containerRef,
    ],
  );

  // Select the currently highlighted option
  const selectHighlightedOption = useCallback(() => {
    const construct = filteredConstructs[highlightedIndex];
    if (!construct) return;
    insertConstruct(construct);
  }, [filteredConstructs, highlightedIndex, insertConstruct]);

  // Handle "Add logic" button click
  const handleAddLogicClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      // Toggle behavior
      if (menuOpen && buttonMenuMode) {
        closeMenu();
        return;
      }

      const button = addButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 4, left: rect.left });

      const cursorPos =
        lastUserCursorPosRef.current >= 0
          ? lastUserCursorPosRef.current
          : localValue.length;
      setTriggerStart(cursorPos);

      setMenuQuery("");
      setHighlightedIndex(0);
      setButtonMenuMode(true);
      setMenuOpen(true);
    },
    [localValue, menuOpen, buttonMenuMode, closeMenu, lastUserCursorPosRef],
  );

  return {
    // State
    menuOpen,
    menuPosition,
    menuQuery,
    setMenuQuery,
    highlightedIndex,
    setHighlightedIndex,
    isKeyboardNav,
    setIsKeyboardNav,
    buttonMenuMode,
    optionCount,
    filteredConstructs,
    addButtonRef,
    // Handlers
    openMenu,
    closeMenu,
    insertConstruct,
    selectHighlightedOption,
    handleAddLogicClick,
  };
};
