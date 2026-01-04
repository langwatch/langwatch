import { Box, type BoxProps, Button, Text } from "@chakra-ui/react";
import { Braces, GripVertical } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import {
  RichTextarea,
  type RichTextareaHandle,
  type CaretPosition,
} from "rich-textarea";
import { useDebounceCallback } from "usehooks-ts";
import {
  VariableInsertMenu,
  getMenuOptionCount,
  type SelectedField,
} from "./VariableInsertMenu";
import type { AvailableSource, FieldType } from "./VariableMappingInput";
import type { Variable } from "./VariablesSection";
import { useLayoutMode } from "~/prompts/prompt-playground/components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";

// ============================================================================
// Types
// ============================================================================

export type PromptTextAreaOnAddMention = {
  value: string;
  display: string;
  startPos: number;
  endPos: number;
};

type PromptTextAreaWithVariablesProps = {
  /** The prompt text value */
  value: string;
  /** Callback when text changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Available sources for variable insertion */
  availableSources?: AvailableSource[];
  /** Current variables defined in the prompt */
  variables?: Variable[];
  /** Callback when a new variable should be created */
  onCreateVariable?: (variable: Variable) => void;
  /** Callback when a variable mapping should be set */
  onSetVariableMapping?: (
    identifier: string,
    sourceId: string,
    field: string,
  ) => void;
  /** Whether the textarea is disabled */
  disabled?: boolean;
  /** Whether to show the "Add variable" button */
  showAddContextButton?: boolean;
  /** Minimum height */
  minHeight?: string;
  /** Maximum height */
  maxHeight?: string;
  /** Whether the field has an error (shows red border) */
  hasError?: boolean;
  /**
   * Legacy callback for optimization studio edge connections.
   * Called when a user selects a field from another node (otherNodesFields).
   * Returns the new handle name that was created (may differ from field if handle already exists).
   */
  onAddEdge?: (
    nodeId: string,
    field: string,
    content: PromptTextAreaOnAddMention,
  ) => string | void;
  /**
   * Legacy: fields from other nodes in optimization studio.
   * Each key is a nodeId, value is array of field names.
   */
  otherNodesFields?: Record<string, string[]>;
  /** Borderless mode for cleaner integration (e.g., in Messages mode) */
  borderless?: boolean;
} & Omit<BoxProps, "onChange">;

// ============================================================================
// Variable Chip Styling
// ============================================================================

const VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;

const parseVariablesFromText = (text: string): string[] => {
  const matches = text.match(VARIABLE_REGEX);
  if (!matches) return [];
  return matches.map((m) => m.slice(2, -2)); // Remove {{ and }}
};

// Find unclosed {{ before cursor position
const findUnclosedBraces = (
  text: string,
  cursorPos: number,
): { start: number; query: string } | null => {
  // Look backwards from cursor for {{
  const textBeforeCursor = text.substring(0, cursorPos);

  // Find the last {{ that doesn't have a matching }}
  let lastOpenBrace = -1;
  let i = textBeforeCursor.length - 1;

  while (i >= 1) {
    if (textBeforeCursor[i - 1] === "{" && textBeforeCursor[i] === "{") {
      // Found {{, check if there's a }} after it before cursor
      const afterBraces = textBeforeCursor.substring(i + 1);
      if (!afterBraces.includes("}}")) {
        lastOpenBrace = i + 1; // Position after {{
        break;
      }
    }
    i--;
  }

  if (lastOpenBrace === -1) return null;

  let query = textBeforeCursor.substring(lastOpenBrace);

  // Remove any trailing } characters (user may have typed partial closing braces)
  query = query.replace(/\}+$/, "");

  // Don't trigger if query has spaces (likely not a variable)
  if (query.includes(" ") || query.includes("\n")) return null;

  // Don't trigger if query contains } in the middle (malformed)
  if (query.includes("}")) return null;

  return { start: lastOpenBrace, query };
};

// ============================================================================
// Main Component
// ============================================================================

export const PromptTextAreaWithVariables = ({
  value,
  onChange,
  placeholder = "Enter your prompt...",
  availableSources: externalSources = [],
  variables = [],
  onCreateVariable,
  onSetVariableMapping,
  disabled = false,
  showAddContextButton = true,
  minHeight = "120px",
  maxHeight: maxHeightProp = "300px",
  hasError = false,
  onAddEdge,
  otherNodesFields = {},
  borderless = false,
  ...boxProps
}: PromptTextAreaWithVariablesProps) => {
  // In horizontal layout mode, allow unlimited height (container scrolls)
  const layoutMode = useLayoutMode();
  const maxHeight = layoutMode === "horizontal" ? undefined : maxHeightProp;
  // Merge variables, otherNodesFields into availableSources
  const availableSources = useMemo(() => {
    const sources: AvailableSource[] = [];

    // Add existing variables as a "Variables" source so users can select them
    if (variables.length > 0) {
      sources.push({
        id: "__variables__",
        name: "Variables",
        type: "signature", // Use signature type for variables
        fields: variables.map((v) => ({ name: v.identifier, type: v.type })),
      });
    }

    // Track which node IDs we've added from externalSources
    const addedNodeIds = new Set<string>();

    // Use externalSources for proper node names and types
    // Filter fields based on otherNodesFields if available
    for (const source of externalSources) {
      const availableFields = otherNodesFields[source.id];
      if (availableFields !== undefined) {
        // Filter to only show unconnected fields
        const filteredFields = source.fields.filter((f) =>
          availableFields.includes(f.name),
        );
        if (filteredFields.length > 0) {
          sources.push({
            ...source,
            fields: filteredFields,
          });
          addedNodeIds.add(source.id);
        }
      } else {
        // No filtering info, show all fields
        sources.push(source);
        addedNodeIds.add(source.id);
      }
    }

    // Add any nodes from otherNodesFields not in externalSources (fallback)
    for (const [nodeId, fields] of Object.entries(otherNodesFields)) {
      if (!addedNodeIds.has(nodeId) && fields.length > 0) {
        sources.push({
          id: nodeId,
          name: nodeId,
          type: "signature", // Fallback type
          fields: fields.map((f) => ({ name: f, type: "str" })),
        });
      }
    }

    return sources;
  }, [externalSources, otherNodesFields, variables]);

  const textareaRef = useRef<RichTextareaHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local value state for immediate UI updates (debounced sync to parent)
  const [localValue, setLocalValue] = useState(value);
  const debouncedOnChange = useDebounceCallback(onChange, 500);

  // Sync local value when prop changes from outside (e.g., form reset)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Helper for programmatic changes (variable insertion) - updates immediately without debounce
  const setValueImmediate = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      onChange(newValue);
    },
    [onChange],
  );

  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [menuQuery, setMenuQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  // When true, menu was opened via button (shows search input, inserts full {{var}})
  const [buttonMenuMode, setButtonMenuMode] = useState(false);

  // Hover state for "Add variable" button
  const [isHovered, setIsHovered] = useState(false);

  // Paragraph drag and drop state
  const [hoveredParagraph, setHoveredParagraph] = useState<number | null>(null);
  const [gripHoveredParagraph, setGripHoveredParagraph] = useState<
    number | null
  >(null);
  const [draggedParagraph, setDraggedParagraph] = useState<number | null>(null);
  const [dropTargetParagraph, setDropTargetParagraph] = useState<number | null>(
    null,
  );

  // Ref to the add variable button for positioning
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Track latest caret position from RichTextarea
  const caretPositionRef = useRef<CaretPosition | null>(null);

  // Track last user-set cursor position for "Add variable" button insertion
  // -1 means user hasn't placed cursor yet (should insert at end)
  const lastUserCursorPosRef = useRef(-1);

  // Get existing variable identifiers
  const existingVariableIds = useMemo(
    () => new Set(variables.map((v) => v.identifier)),
    [variables],
  );

  // Variables used in text but not defined
  const usedVariables = useMemo(() => parseVariablesFromText(localValue), [localValue]);

  const invalidVariables = useMemo(
    () => usedVariables.filter((v) => !existingVariableIds.has(v)),
    [usedVariables, existingVariableIds],
  );

  // Compute flattened options for keyboard selection (must match menu's logic)
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

  // Handle selection change from RichTextarea
  const handleSelectionChange = useCallback((pos: CaretPosition) => {
    caretPositionRef.current = pos;
    // Track user cursor position for "Add variable" button via native textarea
    if (pos.focused) {
      const nativeTextarea = containerRef.current?.querySelector("textarea");
      if (nativeTextarea?.selectionStart !== undefined) {
        lastUserCursorPosRef.current = nativeTextarea.selectionStart;
      }
    }
  }, []);

  // Calculate caret position for menu
  const getCaretCoordinates = useCallback(() => {
    const pos = caretPositionRef.current;
    if (pos?.focused) {
      return {
        top: pos.top + pos.height + 4,
        left: pos.left,
      };
    }

    // Fallback: use container position
    const containerRect = containerRef.current?.getBoundingClientRect();
    return {
      top: (containerRect?.top ?? 0) + 30,
      left: (containerRect?.left ?? 0) + 10,
    };
  }, []);

  // Open the menu
  const openMenu = useCallback(
    (start: number, query: string) => {
      const coords = getCaretCoordinates();
      setMenuPosition(coords);
      setMenuQuery(query);
      setTriggerStart(start);
      setHighlightedIndex(0);
      setMenuOpen(true);
    },
    [getCaretCoordinates],
  );

  // Close the menu
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setTriggerStart(null);
    setMenuQuery("");
    setHighlightedIndex(0);
    setButtonMenuMode(false);
  }, []);

  // Memoized function to select the currently highlighted option
  const selectHighlightedOption = useCallback(() => {
    const option = flattenedOptions[highlightedIndex];
    if (!option) return;

    if (option.type === "field") {
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      // Check if this is a field from another node (for onAddEdge callback)
      const isOtherNodeField = Object.prototype.hasOwnProperty.call(
        otherNodesFields,
        option.source.id,
      );

      if (isOtherNodeField && onAddEdge) {
        const newHandle = onAddEdge(option.source.id, option.field.name, {
          value: localValue,
          display: `${option.source.id}.${option.field.name}`,
          startPos: triggerStart - 2,
          endPos: cursorPos,
        });

        // If onAddEdge returns the new handle, update the text
        if (newHandle) {
          const before = localValue.substring(0, triggerStart - 2);
          const after = localValue.substring(cursorPos);
          const newValue = `${before}{{${newHandle}}}${after}`;
          setValueImmediate(newValue);

          // Set cursor position after the inserted variable
          setTimeout(() => {
            const newCursorPos = before.length + newHandle.length + 4;
            nativeTextarea?.focus();
            nativeTextarea?.setSelectionRange(newCursorPos, newCursorPos);
          }, 0);
        }

        closeMenu();
        return;
      }

      // Replace the {{ and any query with {{field_name}}
      const before = localValue.substring(0, triggerStart - 2);
      const after = localValue.substring(cursorPos);
      const newValue = `${before}{{${option.field.name}}}${after}`;

      setValueImmediate(newValue);

      // Create variable if it doesn't exist
      if (!existingVariableIds.has(option.field.name) && onCreateVariable) {
        onCreateVariable({
          identifier: option.field.name,
          type: option.field.type,
        });

        if (onSetVariableMapping) {
          onSetVariableMapping(
            option.field.name,
            option.source.id,
            option.field.name,
          );
        }
      }

      closeMenu();

      setTimeout(() => {
        nativeTextarea?.focus();
        const newCursorPos = before.length + option.field.name.length + 4;
        nativeTextarea?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    } else if (option.type === "create" && onCreateVariable) {
      // Create new variable
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      const normalizedName = option.name.replace(/ /g, "_").toLowerCase();

      const before = localValue.substring(0, triggerStart - 2);
      const after = localValue.substring(cursorPos);
      const newValue = `${before}{{${normalizedName}}}${after}`;

      setValueImmediate(newValue);

      onCreateVariable({
        identifier: normalizedName,
        type: "str",
      });

      closeMenu();

      setTimeout(() => {
        nativeTextarea?.focus();
        const newCursorPos = before.length + normalizedName.length + 4;
        nativeTextarea?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  }, [
    flattenedOptions,
    highlightedIndex,
    localValue,
    setValueImmediate,
    triggerStart,
    closeMenu,
    existingVariableIds,
    onCreateVariable,
    onSetVariableMapping,
    otherNodesFields,
    onAddEdge,
  ]);

  // Handle keyboard input
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!menuOpen) {
        if (e.key === "Escape") return;
        return;
      }

      // Menu is open - handle navigation
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setIsKeyboardNav(true);
          setHighlightedIndex((prev) => Math.min(prev + 1, optionCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setIsKeyboardNav(true);
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          selectHighlightedOption();
          break;
        case "Escape":
          e.preventDefault();
          closeMenu();
          break;
      }
    },
    [menuOpen, optionCount, closeMenu, selectHighlightedOption],
  );

  // Handle text change - update local state immediately, debounce parent callback
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      // Update local state immediately for responsive typing
      setLocalValue(newValue);
      // Debounce the parent onChange to prevent excessive re-renders
      debouncedOnChange(newValue);

      // Check for unclosed {{ before cursor
      const unclosed = findUnclosedBraces(newValue, cursorPos);

      if (unclosed) {
        // Open or update menu
        if (!menuOpen) {
          // Delay slightly to get accurate caret position
          setTimeout(() => {
            openMenu(unclosed.start, unclosed.query);
          }, 0);
        } else {
          setMenuQuery(unclosed.query);
          setTriggerStart(unclosed.start);
        }
      } else if (menuOpen) {
        // No unclosed braces, close menu
        closeMenu();
      }
    },
    [debouncedOnChange, menuOpen, openMenu, closeMenu],
  );

  // Handle field selection from menu
  const handleSelectField = useCallback(
    (field: SelectedField) => {
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      // Check if this is a field from another node (for onAddEdge callback)
      const isOtherNodeField = Object.prototype.hasOwnProperty.call(
        otherNodesFields,
        field.sourceId,
      );

      if (isOtherNodeField && onAddEdge) {
        // Call onAddEdge for optimization studio compatibility
        const newHandle = onAddEdge(field.sourceId, field.fieldName, {
          value: localValue,
          display: `${field.sourceId}.${field.fieldName}`,
          startPos: buttonMenuMode ? triggerStart : triggerStart - 2,
          endPos: cursorPos,
        });

        // If onAddEdge returns the new handle, update the text
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

          setValueImmediate(newValue);

          setTimeout(() => {
            nativeTextarea?.focus();
            nativeTextarea?.setSelectionRange(newCursorPos, newCursorPos);
          }, 0);
        }

        closeMenu();
        return;
      }

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        // Button mode: Insert full {{field_name}} at cursor position
        const before = localValue.substring(0, triggerStart);
        const after = localValue.substring(triggerStart);
        newValue = `${before}{{${field.fieldName}}}${after}`;
        newCursorPos = before.length + field.fieldName.length + 4;
      } else {
        // Typing mode: Replace the {{ and any query with {{field_name}}
        const before = localValue.substring(0, triggerStart - 2); // Before {{
        const after = localValue.substring(cursorPos);
        newValue = `${before}{{${field.fieldName}}}${after}`;
        newCursorPos = before.length + field.fieldName.length + 4;
      }

      setValueImmediate(newValue);

      // Create variable if it doesn't exist
      if (!existingVariableIds.has(field.fieldName) && onCreateVariable) {
        onCreateVariable({
          identifier: field.fieldName,
          type: field.fieldType,
        });

        // Set mapping if callback provided
        if (onSetVariableMapping) {
          onSetVariableMapping(
            field.fieldName,
            field.sourceId,
            field.fieldName,
          );
        }
      }

      closeMenu();

      // Refocus textarea and set cursor position
      setTimeout(() => {
        nativeTextarea?.focus();
        nativeTextarea?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [
      localValue,
      setValueImmediate,
      triggerStart,
      buttonMenuMode,
      existingVariableIds,
      onCreateVariable,
      onSetVariableMapping,
      otherNodesFields,
      onAddEdge,
      closeMenu,
    ],
  );

  // Handle creating a new variable from menu
  const handleCreateVariable = useCallback(
    (name: string) => {
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? localValue.length;

      // Normalize the name
      const normalizedName = name.replace(/ /g, "_").toLowerCase();

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        // Button mode: Insert full {{name}} at cursor position
        const before = localValue.substring(0, triggerStart);
        const after = localValue.substring(triggerStart);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      } else {
        // Typing mode: Replace the {{ and any query with {{name}}
        const before = localValue.substring(0, triggerStart - 2);
        const after = localValue.substring(cursorPos);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      }

      setValueImmediate(newValue);

      // Create the variable
      if (onCreateVariable) {
        onCreateVariable({
          identifier: normalizedName,
          type: "str", // Default type
        });
      }

      closeMenu();

      // Refocus textarea
      setTimeout(() => {
        nativeTextarea?.focus();
        nativeTextarea?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [
      localValue,
      setValueImmediate,
      triggerStart,
      buttonMenuMode,
      onCreateVariable,
      closeMenu,
    ],
  );

  // Handle "Add variable" button click - toggles menu under button with search input
  const handleAddVariableClick = useCallback(
    (e: React.MouseEvent) => {
      // Prevent the click from triggering the click-outside handler
      e.stopPropagation();

      // If menu is already open in button mode, close it (toggle behavior)
      if (menuOpen && buttonMenuMode) {
        closeMenu();
        return;
      }

      const button = addButtonRef.current;
      if (!button) return;

      // Position menu under the button
      const rect = button.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });

      // Store cursor position for later insertion
      // Use tracked position if user has clicked in textarea, otherwise insert at end
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

  // Render function for rich-textarea - highlights variables as styled spans
  const renderText = useCallback(
    (text: string) => {
      if (!text) return null;

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;

      const regex = new RegExp(VARIABLE_REGEX);
      while ((match = regex.exec(text)) !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }

        // Add the variable with teal color and medium weight
        const varName = match[1] ?? "";
        const isInvalid = varName ? !existingVariableIds.has(varName) : true;

        parts.push(
          <span
            key={`var-${match.index}`}
            style={{
              color: isInvalid
                ? "var(--chakra-colors-red-500)"
                : "var(--chakra-colors-blue-500)", // teal-600
              fontWeight: 600,
            }}
          >
            {match[0]}
          </span>,
        );

        lastIndex = regex.lastIndex;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }

      return parts;
    },
    [existingVariableIds],
  );

  // Track if user has manually resized the textarea
  const [userResizedHeight, setUserResizedHeight] = useState<number | null>(
    null,
  );
  const isUserResizingRef = useRef(false);
  const pendingHeightRef = useRef<number | null>(null);
  const minHeightPx = parseInt(minHeight ?? "120", 10);

  // Detect manual resize - only commit height on mouseup to avoid re-renders during drag
  useEffect(() => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (!textarea) return;

    // Track mouse state to know if user is actively resizing
    const handleMouseDown = (e: MouseEvent) => {
      // Check if mouse is near the resize handle (bottom-right corner)
      const rect = textarea.getBoundingClientRect();
      const isNearResizeHandle =
        e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20;
      if (isNearResizeHandle) {
        isUserResizingRef.current = true;
        pendingHeightRef.current = null;
      }
    };

    const handleMouseUp = () => {
      // Commit the final height when user releases mouse
      if (isUserResizingRef.current && pendingHeightRef.current !== null) {
        const finalHeight = pendingHeightRef.current;
        // If resized close to minimum, reset to auto-height mode
        if (finalHeight <= minHeightPx + 10) {
          setUserResizedHeight(null);
        } else {
          setUserResizedHeight(finalHeight);
        }
      }
      isUserResizingRef.current = false;
      pendingHeightRef.current = null;
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // Only track height changes during active resize (don't update state yet)
      if (isUserResizingRef.current) {
        pendingHeightRef.current = entry.contentRect.height;
      }
    });

    textarea.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    observer.observe(textarea);

    return () => {
      textarea.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [minHeightPx]);

  // Determine if we should use autoHeight
  const useAutoHeight = userResizedHeight === null;

  // Parse text into paragraphs - only when hovering to avoid performance issues
  const parseParagraphs = useCallback(() => {
    const lines: Array<{ text: string; startIndex: number; endIndex: number }> =
      [];
    let currentIndex = 0;

    const parts = localValue.split(/(\n)/);
    let lineText = "";
    let lineStart = 0;

    for (const part of parts) {
      if (part === "\n") {
        lines.push({
          text: lineText,
          startIndex: lineStart,
          endIndex: currentIndex,
        });
        currentIndex += 1;
        lineText = "";
        lineStart = currentIndex;
      } else {
        lineText += part;
        currentIndex += part.length;
      }
    }

    if (lineText || lineStart < localValue.length) {
      lines.push({
        text: lineText,
        startIndex: lineStart,
        endIndex: currentIndex,
      });
    }

    return lines;
  }, [localValue]);

  // Calculate paragraph positions only when hovering (lazy calculation)
  // Uses fixed 28px line height matching the borderless mode styling
  const BORDERLESS_LINE_HEIGHT = 28;
  const calculateParagraphPositions = useCallback(() => {
    if (!containerRef.current || !borderless) return [];

    const paragraphs = parseParagraphs();
    return paragraphs.map((para, idx) => ({
      top: idx * BORDERLESS_LINE_HEIGHT,
      height: BORDERLESS_LINE_HEIGHT,
      text: para.text,
    }));
  }, [borderless, parseParagraphs]);

  // Handle paragraph drag start
  const handleParagraphDragStart = useCallback(
    (e: DragEvent, paragraphIndex: number) => {
      setDraggedParagraph(paragraphIndex);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(paragraphIndex));
    },
    [],
  );

  // Handle paragraph drag over
  const handleParagraphDragOver = useCallback(
    (e: DragEvent, paragraphIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggedParagraph !== null && draggedParagraph !== paragraphIndex) {
        setDropTargetParagraph(paragraphIndex);
      }
    },
    [draggedParagraph],
  );

  // Handle paragraph drop
  const handleParagraphDrop = useCallback(
    (e: DragEvent, targetIndex: number) => {
      e.preventDefault();

      if (draggedParagraph === null || draggedParagraph === targetIndex) {
        setDraggedParagraph(null);
        setDropTargetParagraph(null);
        return;
      }

      // Parse paragraphs fresh for the drop
      const currentParagraphs = parseParagraphs();
      const newParagraphs = [...currentParagraphs];
      const [removed] = newParagraphs.splice(draggedParagraph, 1);
      if (removed) {
        newParagraphs.splice(targetIndex, 0, removed);
      }

      const newText = newParagraphs.map((p) => p.text).join("\n");
      onChange(newText);

      setDraggedParagraph(null);
      setDropTargetParagraph(null);
    },
    [draggedParagraph, parseParagraphs, onChange],
  );

  // Handle drag end (cleanup)
  const handleParagraphDragEnd = useCallback(() => {
    setDraggedParagraph(null);
    setDropTargetParagraph(null);
  }, []);

  // Store paragraph positions in a ref to avoid re-renders during typing
  const paragraphPositionsRef = useRef<Array<{ top: number; height: number }>>([]);

  // Update positions only when needed (not on every render)
  const updateParagraphPositions = useCallback(() => {
    if (!borderless) {
      paragraphPositionsRef.current = [];
      return;
    }
    paragraphPositionsRef.current = calculateParagraphPositions();
  }, [borderless, calculateParagraphPositions]);

  // Handle mouse move to detect which line is being hovered
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!borderless) return;

      // Lazily update positions on mouse move
      updateParagraphPositions();

      const positions = paragraphPositionsRef.current;
      if (positions.length <= 1) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      // Find which line the mouse is over
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        if (pos && relativeY >= pos.top && relativeY < pos.top + pos.height) {
          setHoveredParagraph(i);
          return;
        }
      }
      setHoveredParagraph(null);
    },
    [borderless, updateParagraphPositions],
  );

  // Calculate drop target index based on mouse Y position during drag
  const handleDragOverContainer = useCallback(
    (e: React.DragEvent) => {
      if (draggedParagraph === null || !borderless) return;
      e.preventDefault();

      const positions = paragraphPositionsRef.current;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      // Find the closest drop position
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        if (pos && relativeY < pos.top + pos.height / 2) {
          setDropTargetParagraph(i);
          return;
        }
      }
      // If past all lines, drop at the end
      setDropTargetParagraph(positions.length);
    },
    [draggedParagraph, borderless],
  );

  // Get positions for rendering (only when hovered and needed for UI)
  const visibleParagraphPositions =
    (isHovered || draggedParagraph !== null) && borderless
      ? paragraphPositionsRef.current
      : [];

  return (
    <>
      <Box
        ref={containerRef}
        position="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setHoveredParagraph(null);
          setGripHoveredParagraph(null);
        }}
        onMouseMove={handleMouseMove}
        onDragOver={handleDragOverContainer}
        onDrop={(e) => {
          if (dropTargetParagraph !== null) {
            handleParagraphDrop(e as unknown as DragEvent, dropTargetParagraph);
          }
        }}
        minHeight={borderless ? undefined : "120px"}
        height={borderless ? "100%" : undefined}
        {...boxProps}
      >
        {/* Line highlights - rendered before textarea so they appear behind text */}
        {borderless && visibleParagraphPositions.length > 1 && (
          <>
            {/* Line highlight on hover (full width) - only when hovering grip */}
            {gripHoveredParagraph !== null &&
              draggedParagraph === null &&
              visibleParagraphPositions[gripHoveredParagraph] && (
                <Box
                  position="absolute"
                  top={`${
                    visibleParagraphPositions[gripHoveredParagraph]?.top ?? 0
                  }px`}
                  left={0}
                  right={0}
                  height={`${
                    visibleParagraphPositions[gripHoveredParagraph]?.height ?? 0
                  }px`}
                  background="gray.100"
                  pointerEvents="none"
                  borderRadius="md"
                />
              )}

            {/* Dragged line highlight (reduced opacity) */}
            {draggedParagraph !== null &&
              visibleParagraphPositions[draggedParagraph] && (
                <Box
                  position="absolute"
                  top={`${
                    visibleParagraphPositions[draggedParagraph]?.top ?? 0
                  }px`}
                  left={0}
                  right={0}
                  height={`${
                    visibleParagraphPositions[draggedParagraph]?.height ?? 0
                  }px`}
                  background="blue.50"
                  opacity={0.5}
                  pointerEvents="none"
                  borderRadius="md"
                />
              )}
          </>
        )}

        <RichTextarea
          ref={textareaRef}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelectionChange={handleSelectionChange}
          placeholder={placeholder}
          disabled={disabled}
          autoHeight={useAutoHeight}
          style={{
            width: "100%",
            minHeight: borderless ? "100%" : minHeight,
            maxHeight: borderless ? undefined : maxHeight,
            height: borderless ? "100%" : userResizedHeight ? `${userResizedHeight}px` : undefined,
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            // Borderless mode: 14px font with 28px line height for clean paragraph alignment
            fontSize: borderless ? "14px" : "13px",
            lineHeight: borderless ? "28px" : "1.5",
            // In borderless mode, add left padding for grip handles
            padding: borderless ? "0 0 0 24px" : "8px 10px",
            border: borderless
              ? "none"
              : `1px solid ${
                  hasError
                    ? "var(--chakra-colors-red-500)"
                    : "var(--chakra-colors-gray-200)"
                }`,
            borderRadius: borderless ? "0" : "12px",
            outline: "none",
            resize: borderless ? "none" : "vertical",
            overflow: "auto",
            // Transparent background in borderless mode so line highlights show through
            background: borderless ? "transparent" : undefined,
          }}
          onFocus={(e) => {
            // Only apply focus styles in bordered mode
            if (borderless) return;
            e.currentTarget.style.borderColor = hasError
              ? "var(--chakra-colors-red-500)"
              : "var(--chakra-colors-blue-500)";
            e.currentTarget.style.borderWidth = "2px";
            e.currentTarget.style.padding = "7px 9px";
          }}
          onBlur={(e) => {
            // Only apply blur styles in bordered mode
            if (borderless) return;
            e.currentTarget.style.borderColor = hasError
              ? "var(--chakra-colors-red-500)"
              : "var(--chakra-colors-gray-200)";
            e.currentTarget.style.borderWidth = "1px";
            e.currentTarget.style.padding = "8px 10px";
          }}
        >
          {renderText}
        </RichTextarea>

        {/* Paragraph drag handles and visual feedback overlay - only in borderless mode */}
        {visibleParagraphPositions.length > 1 && (
          <>
            {/* Grip handles */}
            <Box
              position="absolute"
              top={0}
              left={0}
              width="24px"
              height="100%"
              pointerEvents="none"
            >
              {visibleParagraphPositions.map((pos, idx) => (
                <Box
                  key={`grip-${idx}`}
                  position="absolute"
                  top={`${pos.top}px`}
                  left={0}
                  height={`${pos.height}px`}
                  width="24px"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  pointerEvents="auto"
                  cursor={draggedParagraph === idx ? "grabbing" : "grab"}
                  opacity={
                    hoveredParagraph === idx || draggedParagraph === idx ? 1 : 0
                  }
                  transition="opacity 0.1s"
                  draggable
                  onMouseEnter={() => setGripHoveredParagraph(idx)}
                  onMouseLeave={() => setGripHoveredParagraph(null)}
                  onDragStart={(e) =>
                    handleParagraphDragStart(e as unknown as DragEvent, idx)
                  }
                  onDragEnd={handleParagraphDragEnd}
                  borderRadius="md"
                  _hover={{
                    background: "gray.100",
                  }}
                >
                  <Box color="gray.400">
                    <GripVertical size={14} />
                  </Box>
                </Box>
              ))}
            </Box>

            {/* Drop indicator line */}
            {draggedParagraph !== null &&
              dropTargetParagraph !== null &&
              dropTargetParagraph !== draggedParagraph && (
                <Box
                  position="absolute"
                  top={`${
                    dropTargetParagraph < visibleParagraphPositions.length
                      ? (visibleParagraphPositions[dropTargetParagraph]?.top ??
                          0) - 1
                      : (visibleParagraphPositions[
                          visibleParagraphPositions.length - 1
                        ]?.top ?? 0) +
                        (visibleParagraphPositions[
                          visibleParagraphPositions.length - 1
                        ]?.height ?? 0) -
                        1
                  }px`}
                  left={0}
                  right={0}
                  height="2px"
                  background="blue.500"
                  pointerEvents="none"
                  zIndex={10}
                  borderRadius="full"
                />
              )}
          </>
        )}

        {/* Add variable button */}
        {showAddContextButton && isHovered && !disabled && (
          <Button
            ref={addButtonRef}
            position="absolute"
            bottom={2.5}
            right={2}
            size="xs"
            variant="ghost"
            colorPalette="gray"
            onClick={handleAddVariableClick}
            onMouseDown={(e) => e.stopPropagation()} // Prevent click-outside from firing
            opacity={0.7}
            _hover={{ opacity: 1, background: "gray.100" }}
          >
            <Text fontSize="xs" marginRight={1} fontWeight="500">
              Add variable
            </Text>
            <Braces size={14} />
          </Button>
        )}

        {/* Variable Insert Menu */}
        <VariableInsertMenu
          isOpen={menuOpen}
          position={menuPosition}
          availableSources={availableSources}
          query={menuQuery}
          onQueryChange={buttonMenuMode ? setMenuQuery : undefined}
          highlightedIndex={highlightedIndex}
          onHighlightChange={setHighlightedIndex}
          isKeyboardNav={isKeyboardNav}
          onKeyboardNavChange={setIsKeyboardNav}
          onSelect={handleSelectField}
          onCreateVariable={onCreateVariable ? handleCreateVariable : undefined}
          onClose={closeMenu}
        />
      </Box>

      {/* Invalid variables warning */}
      {invalidVariables.length > 0 && (
        <Text
          fontSize="xs"
          color="red.800"
          backgroundColor="red.50"
          borderRadius="lg"
          padding={1}
          marginBottom={1}
          paddingLeft={2}
          position="absolute"
          transform="translateY(-100%)"
          marginTop={-2}
          marginLeft={1}
          width="calc(100% - 8px)"
        >
          Undefined variables: {invalidVariables.join(", ")}
        </Text>
      )}
    </>
  );
};
