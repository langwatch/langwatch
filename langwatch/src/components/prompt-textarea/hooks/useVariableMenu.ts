import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaretPosition } from "rich-textarea";
import type { SelectedField } from "../../variables/VariableInsertMenu";
import type {
  AvailableSource,
  FieldType,
} from "../../variables/VariableMappingInput";
import type { Variable } from "../../variables/VariablesSection";
import type { PromptTextAreaOnAddMention } from "../types";
import { getCaretCoordinates, setTextareaValueUndoable } from "../utils";

type UseVariableMenuProps = {
  localValue: string;
  setValueImmediate: (value: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  existingVariableIds: Set<string>;
  availableSources: AvailableSource[];
  onCreateVariable?: (variable: Variable) => void;
  onSetVariableMapping?: (
    identifier: string,
    sourceId: string,
    field: string,
  ) => void;
  otherNodesFields: Record<string, string[]>;
  onAddEdge?: (
    nodeId: string,
    field: string,
    content: PromptTextAreaOnAddMention,
  ) => string | void;
  /** Shared caret position ref (owned by parent, shared across menus) */
  caretPositionRef: React.RefObject<CaretPosition | null>;
  /** Shared last user cursor position ref (owned by parent, shared across menus) */
  lastUserCursorPosRef: React.RefObject<number>;
};

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
  const flattenedOptions = useMemo(() => {
    const normalizedQuery = menuQuery.trim().replace(/ /g, "_").toLowerCase();

    // Filter sources by query
    const filteredSources = availableSources
      .map((source) => ({
        ...source,
        fields: source.fields.filter((field) =>
          field.name.toLowerCase().includes(menuQuery.toLowerCase()),
        ),
      }))
      .filter((source) => source.fields.length > 0);

    // Check for exact match
    const hasExactMatch = filteredSources.some((source) =>
      source.fields.some(
        (field) => field.name.toLowerCase() === normalizedQuery,
      ),
    );

    const options: Array<
      | {
          type: "field";
          source: AvailableSource;
          field: { name: string; type: FieldType };
        }
      | { type: "create"; name: string }
    > = [];

    // Add fields FIRST
    filteredSources.forEach((source) => {
      source.fields.forEach((field) => {
        options.push({ type: "field", source, field });
      });
    });

    // Add create option LAST (if applicable)
    const canCreate = normalizedQuery && !hasExactMatch && onCreateVariable;
    if (canCreate) {
      options.push({ type: "create", name: normalizedQuery });
    }

    return options;
  }, [availableSources, menuQuery, onCreateVariable]);

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
    (
      fieldName: string,
      fieldType: FieldType,
      sourceId: string,
      isOtherNodeField: boolean,
    ) => {
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      if (isOtherNodeField && onAddEdge) {
        const newHandle = onAddEdge(sourceId, fieldName, {
          value: localValue,
          display: `${sourceId}.${fieldName}`,
          startPos: buttonMenuMode ? triggerStart : triggerStart - 2,
          endPos: cursorPos,
        });

        if (newHandle) {
          let newValue: string;
          let newCursorPos: number;

          if (buttonMenuMode) {
            const before = localValue.substring(0, triggerStart);
            const after = localValue.substring(triggerStart);
            newValue = `${before}{{${newHandle}}}${after}`;
            newCursorPos = before.length + newHandle.length + 4;
          } else {
            const before = localValue.substring(0, triggerStart - 2);
            const after = localValue.substring(cursorPos);
            newValue = `${before}{{${newHandle}}}${after}`;
            newCursorPos = before.length + newHandle.length + 4;
          }

          // Use undo-able replacement so Ctrl+Z works
          if (nativeTextarea) {
            setTextareaValueUndoable(nativeTextarea, newValue, newCursorPos);
          }
          setValueImmediate(newValue);
        }

        closeMenu();
        return;
      }

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        const before = localValue.substring(0, triggerStart);
        const after = localValue.substring(triggerStart);
        newValue = `${before}{{${fieldName}}}${after}`;
        newCursorPos = before.length + fieldName.length + 4;
      } else {
        const before = localValue.substring(0, triggerStart - 2);
        const after = localValue.substring(cursorPos);
        newValue = `${before}{{${fieldName}}}${after}`;
        newCursorPos = before.length + fieldName.length + 4;
      }

      // Use undo-able replacement so Ctrl+Z works
      if (nativeTextarea) {
        setTextareaValueUndoable(nativeTextarea, newValue, newCursorPos);
      }
      setValueImmediate(newValue);

      // Create variable if it doesn't exist
      if (!existingVariableIds.has(fieldName) && onCreateVariable) {
        onCreateVariable({ identifier: fieldName, type: fieldType });

        if (onSetVariableMapping) {
          onSetVariableMapping(fieldName, sourceId, fieldName);
        }
      }

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

  // Select the currently highlighted option
  const selectHighlightedOption = useCallback(() => {
    const option = flattenedOptions[highlightedIndex];
    if (!option) return;

    if (option.type === "field") {
      const isOtherNodeField = Object.prototype.hasOwnProperty.call(
        otherNodesFields,
        option.source.id,
      );
      insertVariable(
        option.field.name,
        option.field.type,
        option.source.id,
        isOtherNodeField,
      );
    } else if (option.type === "create" && onCreateVariable) {
      const normalizedName = option.name.replace(/ /g, "_").toLowerCase();
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        const before = localValue.substring(0, triggerStart);
        const after = localValue.substring(triggerStart);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      } else {
        const before = localValue.substring(0, triggerStart - 2);
        const after = localValue.substring(cursorPos);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      }

      // Use undo-able replacement so Ctrl+Z works
      if (nativeTextarea) {
        setTextareaValueUndoable(nativeTextarea, newValue, newCursorPos);
      }
      setValueImmediate(newValue);
      onCreateVariable({ identifier: normalizedName, type: "str" });
      closeMenu();
    }
  }, [
    flattenedOptions,
    highlightedIndex,
    insertVariable,
    otherNodesFields,
    onCreateVariable,
    localValue,
    setValueImmediate,
    triggerStart,
    buttonMenuMode,
    closeMenu,
    containerRef,
  ]);

  // Handle field selection from menu
  const handleSelectField = useCallback(
    (field: SelectedField) => {
      const isOtherNodeField = Object.prototype.hasOwnProperty.call(
        otherNodesFields,
        field.sourceId,
      );
      insertVariable(
        field.fieldName,
        field.fieldType,
        field.sourceId,
        isOtherNodeField,
      );
    },
    [insertVariable, otherNodesFields],
  );

  // Handle creating a new variable from menu (undo-able via Ctrl+Z)
  const handleCreateVariable = useCallback(
    (name: string) => {
      if (triggerStart === null || !onCreateVariable) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;
      const normalizedName = name.replace(/ /g, "_").toLowerCase();

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        const before = localValue.substring(0, triggerStart);
        const after = localValue.substring(triggerStart);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      } else {
        const before = localValue.substring(0, triggerStart - 2);
        const after = localValue.substring(cursorPos);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      }

      // Use undo-able replacement so Ctrl+Z works
      if (nativeTextarea) {
        setTextareaValueUndoable(nativeTextarea, newValue, newCursorPos);
      }
      setValueImmediate(newValue);
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
    [localValue, menuOpen, buttonMenuMode, closeMenu],
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
