import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaretPosition } from "rich-textarea";

import type { SelectedField } from "../../variable-insert-menu.tsx";
import type { AvailableSource, FieldType } from "../../variable-mapping-input.tsx";
import type { Variable } from "../../variables-section.tsx";
import type { PromptTextAreaOnAddMention } from "../prompt-textarea.types.ts";
import { getCaretCoordinates, setTextareaValueUndoable } from "../prompt-textarea.utils.ts";

type UseVariableMenuProps = {
  localValue: string;
  setValueImmediate: (value: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  existingVariableIds: Set<string>;
  availableSources: AvailableSource[];
  onCreateVariable?: (variable: Variable) => void;
  onSetVariableMapping?: (identifier: string, sourceId: string, field: string) => void;
  otherNodesFields: Record<string, string[]>;
  onAddEdge?: (
    nodeId: string,
    field: string,
    content: PromptTextAreaOnAddMention,
  ) => string | undefined;
  /** Shared caret position ref (owned by parent, shared across menus) */
  caretPositionRef: React.RefObject<CaretPosition | null>;
  /** Shared last user cursor position ref (owned by parent, shared across menus) */
  lastUserCursorPosRef: React.RefObject<number>;
};

type MenuOption =
  | { type: "field"; source: AvailableSource; field: { name: string; type: FieldType } }
  | { type: "create"; name: string };

/** Fields matching the query first, then a create option when no field name matches exactly. */
function buildMenuOptions({
  availableSources,
  menuQuery,
  canCreate,
}: {
  availableSources: AvailableSource[];
  menuQuery: string;
  canCreate: boolean;
}): MenuOption[] {
  const normalizedQuery = menuQuery.trim().replace(/ /g, "_").toLowerCase();
  const fieldOptions = availableSources.flatMap((source) =>
    source.fields
      .filter((field) => field.name.toLowerCase().includes(menuQuery.toLowerCase()))
      .map((field): MenuOption => ({ type: "field", source, field })),
  );
  const hasExactMatch = fieldOptions.some(
    (option) => option.type === "field" && option.field.name.toLowerCase() === normalizedQuery,
  );
  if (!normalizedQuery || hasExactMatch || !canCreate) return fieldOptions;
  return [...fieldOptions, { type: "create", name: normalizedQuery }];
}

/**
 * The value with `{{name}}` inserted: at the trigger in button mode, else replacing the typed
 * `{{` and query up to the cursor; the cursor lands after the closing braces.
 */
function insertTemplateVariable({
  value,
  triggerStart,
  cursorPos,
  buttonMenuMode,
  name,
}: {
  value: string;
  triggerStart: number;
  cursorPos: number;
  buttonMenuMode: boolean;
  name: string;
}): { newValue: string; newCursorPos: number } {
  const before = value.substring(0, buttonMenuMode ? triggerStart : triggerStart - 2);
  const after = value.substring(buttonMenuMode ? triggerStart : cursorPos);
  return {
    newValue: `${before}{{${name}}}${after}`,
    newCursorPos: before.length + name.length + 4,
  };
}

function readTextareaCursor(
  containerRef: React.RefObject<HTMLDivElement | null>,
  value: string,
): { nativeTextarea: HTMLTextAreaElement | null | undefined; cursorPos: number } {
  const nativeTextarea = containerRef.current?.querySelector("textarea");
  return { nativeTextarea, cursorPos: nativeTextarea?.selectionStart ?? value.length };
}

/** Inserts `{{name}}` through an undo-able replacement so Ctrl+Z works, then commits the value. */
function writeTemplateVariable({
  nativeTextarea,
  setValueImmediate,
  ...insertion
}: Parameters<typeof insertTemplateVariable>[0] & {
  nativeTextarea: HTMLTextAreaElement | null | undefined;
  setValueImmediate: (value: string) => void;
}): void {
  const { newValue, newCursorPos } = insertTemplateVariable(insertion);
  if (nativeTextarea) setTextareaValueUndoable(nativeTextarea, newValue, newCursorPos);
  setValueImmediate(newValue);
}

/**
 * Inserts a field: another node's field goes in through the edge it adds (its handle names the
 * variable), a local field is inserted by name and created, with its mapping, when it is new.
 */
function insertFieldVariable({
  field: { fieldName, fieldType, sourceId, isOtherNodeField },
  target,
  existingVariableIds,
  onAddEdge,
  onCreateVariable,
  onSetVariableMapping,
}: {
  field: { fieldName: string; fieldType: FieldType; sourceId: string; isOtherNodeField: boolean };
  target: Omit<Parameters<typeof writeTemplateVariable>[0], "name">;
} & Pick<
  UseVariableMenuProps,
  "existingVariableIds" | "onAddEdge" | "onCreateVariable" | "onSetVariableMapping"
>): void {
  if (isOtherNodeField && onAddEdge) {
    const newHandle = onAddEdge(sourceId, fieldName, {
      value: target.value,
      display: `${sourceId}.${fieldName}`,
      startPos: target.buttonMenuMode ? target.triggerStart : target.triggerStart - 2,
      endPos: target.cursorPos,
    });
    if (newHandle) writeTemplateVariable({ ...target, name: newHandle });
    return;
  }
  writeTemplateVariable({ ...target, name: fieldName });
  if (existingVariableIds.has(fieldName) || !onCreateVariable) return;
  onCreateVariable({ identifier: fieldName, type: fieldType });
  onSetVariableMapping?.(fieldName, sourceId, fieldName);
}

/** The button inserts at the cursor the user last placed, else at the end of the text. */
function buttonTriggerStart(lastUserCursorPos: number, value: string): number {
  return lastUserCursorPos >= 0 ? lastUserCursorPos : value.length;
}

export const useVariableMenu = ({
  localValue,
  setValueImmediate,
  containerRef,
  existingVariableIds,
  availableSources,
  onCreateVariable,
  onSetVariableMapping,
  otherNodesFields,
  onAddEdge,
  caretPositionRef,
  lastUserCursorPosRef,
}: UseVariableMenuProps) => {
  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [menuQuery, setMenuQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  // When true, menu was opened via button (shows search input, inserts full {{var}})
  const [buttonMenuMode, setButtonMenuMode] = useState(false);

  // Ref to the add variable button for positioning
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Compute flattened options for keyboard selection
  const flattenedOptions = useMemo(
    () => buildMenuOptions({ availableSources, menuQuery, canCreate: !!onCreateVariable }),
    [availableSources, menuQuery, onCreateVariable],
  );

  const optionCount = flattenedOptions.length;

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

  // Insert variable at current position (undo-able via Ctrl+Z)
  const insertVariable = useCallback(
    ({
      fieldName,
      fieldType,
      sourceId,
      isOtherNodeField,
    }: {
      fieldName: string;
      fieldType: FieldType;
      sourceId: string;
      isOtherNodeField: boolean;
    }) => {
      if (triggerStart === null) return;

      insertFieldVariable({
        field: { fieldName, fieldType, sourceId, isOtherNodeField },
        target: {
          ...readTextareaCursor(containerRef, localValue),
          setValueImmediate,
          value: localValue,
          triggerStart,
          buttonMenuMode,
        },
        existingVariableIds,
        onAddEdge,
        onCreateVariable,
        onSetVariableMapping,
      });
      closeMenu();
    },
    [
      localValue,
      setValueImmediate,
      triggerStart,
      buttonMenuMode,
      existingVariableIds,
      onCreateVariable,
      onSetVariableMapping,
      onAddEdge,
      closeMenu,
      containerRef,
    ],
  );

  // Handle field selection from menu
  const handleSelectField = useCallback(
    (field: SelectedField) => {
      insertVariable({
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        sourceId: field.sourceId,
        isOtherNodeField: Object.prototype.hasOwnProperty.call(otherNodesFields, field.sourceId),
      });
    },
    [insertVariable, otherNodesFields],
  );

  // Handle creating a new variable from menu (undo-able via Ctrl+Z)
  const handleCreateVariable = useCallback(
    (name: string) => {
      if (triggerStart === null || !onCreateVariable) return;
      const normalizedName = name.replace(/ /g, "_").toLowerCase();
      writeTemplateVariable({
        ...readTextareaCursor(containerRef, localValue),
        setValueImmediate,
        value: localValue,
        triggerStart,
        buttonMenuMode,
        name: normalizedName,
      });
      onCreateVariable({ identifier: normalizedName, type: "str" });
      closeMenu();
    },
    [
      localValue,
      setValueImmediate,
      triggerStart,
      buttonMenuMode,
      onCreateVariable,
      closeMenu,
      containerRef,
    ],
  );

  // Select the currently highlighted option
  const selectHighlightedOption = useCallback(() => {
    const option = flattenedOptions[highlightedIndex];
    if (!option) return;
    if (option.type === "create") {
      handleCreateVariable(option.name);
      return;
    }
    handleSelectField({
      sourceId: option.source.id,
      sourceName: option.source.name,
      sourceType: option.source.type,
      fieldName: option.field.name,
      fieldType: option.field.type,
    });
  }, [flattenedOptions, highlightedIndex, handleCreateVariable, handleSelectField]);

  // Handle "Add variable" button click
  const handleAddVariableClick = useCallback(
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

      setTriggerStart(buttonTriggerStart(lastUserCursorPosRef.current, localValue));

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
    addButtonRef,
    // Handlers
    openMenu,
    closeMenu,
    selectHighlightedOption,
    handleSelectField,
    handleCreateVariable,
    handleAddVariableClick,
  };
};
