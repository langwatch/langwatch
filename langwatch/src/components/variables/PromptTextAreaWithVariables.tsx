import { Box, type BoxProps, Button, Text } from "@chakra-ui/react";
import { Braces } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  RichTextarea,
  type RichTextareaHandle,
  type CaretPosition,
} from "rich-textarea";
import {
  VariableInsertMenu,
  getMenuOptionCount,
  type SelectedField,
} from "./VariableInsertMenu";
import type { AvailableSource, FieldType } from "./VariableMappingInput";
import type { Variable } from "./VariablesSection";

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
   */
  onAddEdge?: (
    nodeId: string,
    field: string,
    content: PromptTextAreaOnAddMention,
  ) => void;
  /**
   * Legacy: fields from other nodes in optimization studio.
   * Each key is a nodeId, value is array of field names.
   */
  otherNodesFields?: Record<string, string[]>;
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
  maxHeight = "300px",
  hasError = false,
  onAddEdge,
  otherNodesFields = {},
  ...boxProps
}: PromptTextAreaWithVariablesProps) => {
  // Merge variables, otherNodesFields into availableSources
  const availableSources = useMemo(() => {
    const sources = [...externalSources];

    // Add existing variables as a "Variables" source so users can select them
    if (variables.length > 0) {
      sources.unshift({
        id: "__variables__",
        name: "Variables",
        type: "signature", // Use signature type for variables
        fields: variables.map((v) => ({ name: v.identifier, type: v.type })),
      });
    }

    // Convert otherNodesFields to AvailableSource format
    for (const [nodeId, fields] of Object.entries(otherNodesFields)) {
      if (fields.length > 0) {
        sources.push({
          id: nodeId,
          name: nodeId,
          type: "signature", // Assume these are from other nodes in workflow
          fields: fields.map((f) => ({ name: f, type: "str" })),
        });
      }
    }
    return sources;
  }, [externalSources, otherNodesFields, variables]);

  const textareaRef = useRef<RichTextareaHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const usedVariables = useMemo(() => parseVariablesFromText(value), [value]);

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
      const cursorPos = nativeTextarea?.selectionStart ?? value.length;

      // Check if this is a field from another node (for onAddEdge callback)
      const isOtherNodeField = Object.prototype.hasOwnProperty.call(
        otherNodesFields,
        option.source.id,
      );

      if (isOtherNodeField && onAddEdge) {
        onAddEdge(option.source.id, option.field.name, {
          value,
          display: `${option.source.id}.${option.field.name}`,
          startPos: triggerStart - 2,
          endPos: cursorPos,
        });
        closeMenu();
        return;
      }

      // Replace the {{ and any query with {{field_name}}
      const before = value.substring(0, triggerStart - 2);
      const after = value.substring(cursorPos);
      const newValue = `${before}{{${option.field.name}}}${after}`;

      onChange(newValue);

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
      const cursorPos = nativeTextarea?.selectionStart ?? value.length;

      const normalizedName = option.name.replace(/ /g, "_").toLowerCase();

      const before = value.substring(0, triggerStart - 2);
      const after = value.substring(cursorPos);
      const newValue = `${before}{{${normalizedName}}}${after}`;

      onChange(newValue);

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
    triggerStart,
    value,
    onChange,
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

  // Handle text change
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;
      onChange(newValue);

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
    [onChange, menuOpen, openMenu, closeMenu],
  );

  // Handle field selection from menu
  const handleSelectField = useCallback(
    (field: SelectedField) => {
      if (triggerStart === null) return;

      const nativeTextarea = containerRef.current?.querySelector("textarea");
      const cursorPos = nativeTextarea?.selectionStart ?? value.length;

      // Check if this is a field from another node (for onAddEdge callback)
      const isOtherNodeField = Object.prototype.hasOwnProperty.call(
        otherNodesFields,
        field.sourceId,
      );

      if (isOtherNodeField && onAddEdge) {
        // Call onAddEdge for optimization studio compatibility
        onAddEdge(field.sourceId, field.fieldName, {
          value,
          display: `${field.sourceId}.${field.fieldName}`,
          startPos: buttonMenuMode ? triggerStart : triggerStart - 2,
          endPos: cursorPos,
        });

        closeMenu();
        return;
      }

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        // Button mode: Insert full {{field_name}} at cursor position
        const before = value.substring(0, triggerStart);
        const after = value.substring(triggerStart);
        newValue = `${before}{{${field.fieldName}}}${after}`;
        newCursorPos = before.length + field.fieldName.length + 4;
      } else {
        // Typing mode: Replace the {{ and any query with {{field_name}}
        const before = value.substring(0, triggerStart - 2); // Before {{
        const after = value.substring(cursorPos);
        newValue = `${before}{{${field.fieldName}}}${after}`;
        newCursorPos = before.length + field.fieldName.length + 4;
      }

      onChange(newValue);

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
      value,
      onChange,
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
      const cursorPos = nativeTextarea?.selectionStart ?? value.length;

      // Normalize the name
      const normalizedName = name.replace(/ /g, "_").toLowerCase();

      let newValue: string;
      let newCursorPos: number;

      if (buttonMenuMode) {
        // Button mode: Insert full {{name}} at cursor position
        const before = value.substring(0, triggerStart);
        const after = value.substring(triggerStart);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      } else {
        // Typing mode: Replace the {{ and any query with {{name}}
        const before = value.substring(0, triggerStart - 2);
        const after = value.substring(cursorPos);
        newValue = `${before}{{${normalizedName}}}${after}`;
        newCursorPos = before.length + normalizedName.length + 4;
      }

      onChange(newValue);

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
      value,
      onChange,
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
          : value.length;
      setTriggerStart(cursorPos);

      setMenuQuery("");
      setHighlightedIndex(0);
      setButtonMenuMode(true);
      setMenuOpen(true);
    },
    [value, menuOpen, buttonMenuMode, closeMenu],
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

        // Add the variable chip
        const varName = match[1] ?? "";
        const isInvalid = varName ? !existingVariableIds.has(varName) : true;

        // Use box-shadow for visual border effect without changing dimensions
        // This keeps cursor position accurate
        parts.push(
          <span
            key={`var-${match.index}`}
            style={{
              backgroundColor: isInvalid
                ? "var(--chakra-colors-red-50)"
                : "var(--chakra-colors-blue-50)",
              borderRadius: "4px",
              boxShadow: `0 0 0 1px ${
                isInvalid
                  ? "var(--chakra-colors-red-200)"
                  : "var(--chakra-colors-blue-200)"
              }`,
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

  return (
    <>
      <Box
        ref={containerRef}
        position="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        minHeight="120px"
        {...boxProps}
      >
        <RichTextarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelectionChange={handleSelectionChange}
          placeholder={placeholder}
          disabled={disabled}
          autoHeight
          style={{
            width: "100%",
            minHeight,
            maxHeight,
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: "13px",
            lineHeight: "1.5",
            padding: "8px 10px",
            border: `1px solid ${
              hasError
                ? "var(--chakra-colors-red-500)"
                : "var(--chakra-colors-gray-200)"
            }`,
            borderRadius: "12px",
            outline: "none",
            resize: "vertical",
            overflow: "auto",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = hasError
              ? "var(--chakra-colors-red-500)"
              : "var(--chakra-colors-blue-500)";
            e.currentTarget.style.borderWidth = "2px";
            e.currentTarget.style.padding = "7px 9px";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = hasError
              ? "var(--chakra-colors-red-500)"
              : "var(--chakra-colors-gray-200)";
            e.currentTarget.style.borderWidth = "1px";
            e.currentTarget.style.padding = "8px 10px";
          }}
        >
          {renderText}
        </RichTextarea>

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
        <Text fontSize="xs" color="red.500" marginTop={1}>
          Undefined variables: {invalidVariables.join(", ")}
        </Text>
      )}
    </>
  );
};
