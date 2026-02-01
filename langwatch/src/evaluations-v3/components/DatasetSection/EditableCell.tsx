import { Box, Button, HStack, Portal, Textarea } from "@chakra-ui/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DatasetColumnType } from "~/server/datasets/types";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { isTextLikelyOverflowing } from "~/utils/textOverflowHeuristic";

// Max characters to display before truncating (for rendering performance)
const MAX_DISPLAY_CHARS = 5000;

// Max height in pixels for compact mode before showing fade
const COMPACT_MAX_HEIGHT = 160 - 17;

// Default max height in pixels for expanded cells (before drag customization)
const EXPANDED_DEFAULT_MAX_HEIGHT = 600;

// Column types that should be formatted as JSON
const JSON_LIKE_TYPES: DatasetColumnType[] = [
  "json",
  "list",
  "chat_messages",
  "spans",
  "rag_contexts",
  "annotations",
  "evaluations",
];

/**
 * Validate and normalize a boolean value.
 * Accepts: 0, 1, true, false (case insensitive)
 * Returns: { valid: true, normalized: "true"|"false" } or { valid: false }
 */
const validateBoolean = (
  value: string,
): { valid: true; normalized: string } | { valid: false } => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed === "true" || trimmed === "1") {
    return { valid: true, normalized: trimmed === "" ? "" : "true" };
  }
  if (trimmed === "false" || trimmed === "0") {
    return { valid: true, normalized: "false" };
  }
  return { valid: false };
};

/**
 * Validate a number value.
 * Accepts: integers, floats, and locale-specific decimal separators (comma or period).
 * Returns: { valid: true, normalized: string } or { valid: false }
 */
const validateNumber = (
  value: string,
): { valid: true; normalized: string } | { valid: false } => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { valid: true, normalized: "" };
  }

  // Normalize the string: replace comma with period for decimal separator
  // This handles both "1,5" (European) and "1.5" (US) formats
  let normalized = trimmed;
  if (trimmed.includes(",") && !trimmed.includes(".")) {
    // Single comma without period - treat comma as decimal separator
    normalized = trimmed.replace(",", ".");
  }

  // Validate that the entire string is a valid number
  // Using a regex to ensure we're not accepting partial parses like "1abc"
  const numberRegex = /^-?\d+(\.\d+)?$/;
  if (!numberRegex.test(normalized)) {
    return { valid: false };
  }

  const parsed = parseFloat(normalized);
  if (!isNaN(parsed) && isFinite(parsed)) {
    return { valid: true, normalized: String(parsed) };
  }

  return { valid: false };
};

/**
 * Try to parse and format a value as JSON.
 * Returns the formatted JSON string if successful, or the original value if not.
 */
const tryFormatAsJson = (
  value: string,
): { formatted: string; isJson: boolean } => {
  if (!value || typeof value !== "string") {
    return { formatted: value, isJson: false };
  }

  const trimmed = value.trim();
  // Quick check: only try to parse if it looks like JSON (starts with { or [)
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { formatted: value, isJson: false };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { formatted: value, isJson: false };
  }
};

/**
 * Truncate a string to a maximum length with an ellipsis indicator.
 */
const truncateValue = (
  value: string,
  maxLength: number,
): { text: string; truncated: boolean } => {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxLength) + "…", truncated: true };
};

type EditableCellProps = {
  value: string;
  row: number;
  columnId: string;
  datasetId: string;
  dataType?: DatasetColumnType;
};

/**
 * Editable cell component for dataset values.
 *
 * Note: Selection outline is handled by the parent table on the <td> element.
 * This component only handles the edit mode textarea.
 */
export function EditableCell({
  value,
  row,
  columnId,
  datasetId,
  dataType,
}: EditableCellProps) {
  const { setCellValue, setEditingCell, ui, toggleCellExpanded } =
    useEvaluationsV3Store((state) => ({
      setCellValue: state.setCellValue,
      setEditingCell: state.setEditingCell,
      ui: state.ui,
      toggleCellExpanded: state.toggleCellExpanded,
    }));

  const rowHeightMode = ui.rowHeightMode;
  const cellKey = `${row}-${columnId}`;
  const isCellExpanded = ui.expandedCells.has(cellKey);

  const isEditing =
    ui.editingCell?.row === row && ui.editingCell?.columnId === columnId;

  const [editValue, setEditValue] = useState(value);
  const [editorStyle, setEditorStyle] = useState<React.CSSProperties>({});
  const [validationError, setValidationError] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset edit value and validation state when entering edit mode, formatting JSON if applicable
  useEffect(() => {
    if (isEditing) {
      setValidationError(false);
      // For JSON-like types, format the value for easier editing
      const isJsonType = dataType && JSON_LIKE_TYPES.includes(dataType);
      if (isJsonType) {
        const { formatted } = tryFormatAsJson(value);
        setEditValue(formatted);
      } else {
        setEditValue(value);
      }
    }
  }, [isEditing, value, dataType]);

  // Track the calculated textarea height
  const [textareaHeight, setTextareaHeight] = useState<number | undefined>(
    undefined,
  );

  // Position editor and focus when editing starts
  useLayoutEffect(() => {
    if (isEditing && cellRef.current) {
      // Get the parent td element for positioning
      const td = cellRef.current.closest("td");
      if (td) {
        const rect = td.getBoundingClientRect();
        // Account for padding (2 * 8px = 16px from the -8 offset on each side)
        // and the footer hint bar height (~28px)
        const footerHeight = 28;
        const padding = 16;
        // Make textarea at least 80px, but expand to fit cell content
        const calculatedHeight = Math.max(
          80,
          rect.height + padding - footerHeight,
        );
        setTextareaHeight(calculatedHeight);
        setEditorStyle({
          position: "fixed",
          top: rect.top - 8,
          left: rect.left - 8,
          width: Math.max(rect.width + padding, 250),
          minHeight: rect.height + padding,
          zIndex: 1000,
        });
      }

      // Focus after positioning
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select();
        }
      }, 0);
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    // Validate boolean columns
    if (dataType === "boolean") {
      const result = validateBoolean(editValue);
      if (!result.valid) {
        setValidationError(true);
        return;
      }
      setCellValue(datasetId, row, columnId, result.normalized);
      setValidationError(false);
      setEditingCell(undefined);
      return;
    }

    // Validate number columns
    if (dataType === "number") {
      const result = validateNumber(editValue);
      if (!result.valid) {
        setValidationError(true);
        return;
      }
      setCellValue(datasetId, row, columnId, result.normalized);
      setValidationError(false);
      setEditingCell(undefined);
      return;
    }

    // Other types: save as-is
    setCellValue(datasetId, row, columnId, editValue);
    setEditingCell(undefined);
  }, [datasetId, row, columnId, editValue, dataType, setCellValue, setEditingCell]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setValidationError(false);
    setEditingCell(undefined);
  }, [value, setEditingCell]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation(); // Prevent global handler from re-opening edit mode
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // Prevent global handler from clearing selection
        handleCancel();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
        // TODO: Move to next cell
      }
    },
    [handleSave, handleCancel],
  );

  const handleBlur = useCallback(() => {
    // Small delay to allow click events to register first
    // On blur, cancel without saving (user must press Enter to save)
    setTimeout(() => {
      handleCancel();
    }, 100);
  }, [handleCancel]);

  // Format and truncate display value
  const displayValue = useMemo(() => {
    const isJsonType = dataType && JSON_LIKE_TYPES.includes(dataType);

    // For JSON-like types, try to format as JSON
    const { formatted, isJson } = isJsonType
      ? tryFormatAsJson(value)
      : { formatted: value, isJson: false };

    // Apply truncation
    const { text, truncated } = truncateValue(formatted, MAX_DISPLAY_CHARS);

    return {
      text,
      isJson: isJsonType && isJson,
      truncated,
    };
  }, [value, dataType]);

  // Use a heuristic to determine if content likely overflows
  // This avoids useLayoutEffect + scrollHeight measurement which causes issues
  // with virtualization and column resizing (measurement doesn't update on resize)
  const contentRef = useRef<HTMLDivElement>(null);

  // Track hover state for showing resize bar on compact cells
  const [isHovered, setIsHovered] = useState(false);

  // Track custom height when dragging the resize bar
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const currentHeightRef = useRef<number | null>(null); // Track current height during drag
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  // Heuristic for overflow: uses character count with newlines weighted as full lines
  const isOverflowing =
    rowHeightMode === "compact" &&
    !isCellExpanded &&
    isTextLikelyOverflowing(displayValue.text);

  // Reset custom height when cell is collapsed
  useEffect(() => {
    if (!isCellExpanded) {
      setCustomHeight(null);
    }
  }, [isCellExpanded]);

  // Determine if we should show clamped view
  const showClamped =
    rowHeightMode === "compact" && !isCellExpanded && isOverflowing;

  // Calculate the effective max height for expanded cells
  // Use custom height if set (from dragging), otherwise use default expanded height
  const expandedMaxHeight =
    customHeight !== null
      ? `${customHeight}px`
      : `${EXPANDED_DEFAULT_MAX_HEIGHT}px`;

  const handleExpandClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Don't trigger cell selection
      // Only collapse if not dragging
      if (!isDraggingRef.current) {
        toggleCellExpanded(row, columnId);
      }
    },
    [toggleCellExpanded, row, columnId],
  );

  // Track if we started dragging from compact state and if we've expanded during drag
  const startedFromCompactRef = useRef(false);
  const expandedDuringDragRef = useRef(false);

  // Drag handlers for the resize bar
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      isDraggingRef.current = false; // Will be set to true on first move
      dragStartYRef.current = e.clientY;
      startedFromCompactRef.current = !isCellExpanded;
      expandedDuringDragRef.current = false;

      // Set the starting height based on current state
      if (!isCellExpanded) {
        dragStartHeightRef.current = COMPACT_MAX_HEIGHT;
      } else if (contentRef.current) {
        dragStartHeightRef.current =
          customHeight ?? contentRef.current.scrollHeight;
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - dragStartYRef.current;

        // Only consider it a drag if moved more than 3px
        if (Math.abs(deltaY) > 3) {
          isDraggingRef.current = true;
        }

        if (isDraggingRef.current) {
          const newHeight = Math.max(
            COMPACT_MAX_HEIGHT,
            dragStartHeightRef.current + deltaY,
          );
          currentHeightRef.current = newHeight;
          setCustomHeight(newHeight);

          // If we started from compact and haven't expanded yet, expand the cell
          if (startedFromCompactRef.current && !expandedDuringDragRef.current) {
            expandedDuringDragRef.current = true;
            toggleCellExpanded(row, columnId);
          }
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        // If dragged to minimum height, collapse the cell
        if (
          isDraggingRef.current &&
          currentHeightRef.current !== null &&
          currentHeightRef.current <= COMPACT_MAX_HEIGHT
        ) {
          // Collapse if we expanded during drag, or if we were already expanded
          if (expandedDuringDragRef.current || !startedFromCompactRef.current) {
            toggleCellExpanded(row, columnId);
          }
          setCustomHeight(null);
          currentHeightRef.current = null;
        }

        // Small delay to allow click handler to check isDraggingRef
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 50);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isCellExpanded, toggleCellExpanded, row, columnId, customHeight],
  );

  return (
    <>
      {/* Cell display - click/dblclick handled by parent td */}
      <Box
        ref={cellRef}
        data-testid={`cell-${row}-${columnId}`}
        height="100%"
        minHeight="20px"
        fontSize={displayValue.isJson ? "12px" : "13px"}
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        opacity={isEditing ? 0 : 1}
        fontFamily={displayValue.isJson ? "mono" : undefined}
        position="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Content container with optional max-height */}
        <Box
          ref={contentRef}
          height="100%"
          maxHeight={
            showClamped || (rowHeightMode === "compact" && !isCellExpanded)
              ? `${COMPACT_MAX_HEIGHT}px`
              : isCellExpanded
                ? expandedMaxHeight
                : undefined
          }
          overflow={
            showClamped || (rowHeightMode === "compact" && !isCellExpanded)
              ? "hidden"
              : isCellExpanded
                ? "auto"
                : undefined
          }
        >
          {displayValue.text}
          {displayValue.truncated && (
            <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
              (truncated)
            </Box>
          )}
        </Box>

        {/* Fade overlay for clamped content - extends to cell edges */}
        {showClamped && (
          <Box
            position="absolute"
            bottom={"-8px"}
            left={"-12px"}
            right={"-12px"}
            height="40px"
            cursor="pointer"
            onClick={handleExpandClick}
            className="cell-fade-overlay"
            css={{
              background:
                "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-panel))",
              "tr:hover &": {
                background:
                  "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-subtle))",
              },
              // Selected row takes priority over hover
              "tr[data-selected='true'] &": {
                background:
                  "linear-gradient(to bottom, transparent, var(--chakra-colors-blue-subtle))",
              },
            }}
          />
        )}

        {/* Resize/collapse bar - shows on expanded cells OR on hover for compact cells with overflow */}
        {rowHeightMode === "compact" &&
          (isCellExpanded || (isHovered && isOverflowing)) && (
            <Box
              position="absolute"
              bottom={"-8px"}
              left={"-10px"}
              right={"-10px"}
              height="20px"
              cursor="ns-resize"
              onMouseDown={handleDragStart}
              onClick={handleExpandClick}
              display="flex"
              alignItems="center"
              justifyContent="center"
              opacity={0.5}
              transition="opacity 0.15s"
              _hover={{ opacity: 1 }}
              css={{
                background: "var(--cell-bg, var(--chakra-colors-bg-panel))",
              }}
            >
              <Box
                width="40px"
                height="4px"
                borderRadius="full"
                bg="gray.emphasized"
                _hover={{ bg: "gray.emphasized" }}
                transition="background 0.15s"
              />
            </Box>
          )}
      </Box>

      {/* Expanded editor (positioned over cell via portal) */}
      {isEditing && (
        <Portal>
          <Box
            style={editorStyle}
            bg="bg.panel"
            borderRadius="md"
            boxShadow={
              validationError
                ? "0 0 0 2px var(--chakra-colors-red-solid), 0 4px 12px rgba(0,0,0,0.15)"
                : "0 0 0 2px var(--chakra-colors-blue-solid), 0 4px 12px rgba(0,0,0,0.15)"
            }
            overflow="hidden"
            position="relative"
          >
            <Textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                setValidationError(false);
              }}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              minHeight={textareaHeight ? `${textareaHeight}px` : "80px"}
              resize="vertical"
              border="none"
              borderRadius="0"
              fontSize="13px"
              padding={2}
              _focus={{ outline: "none", boxShadow: "none" }}
            />
            {dataType === "boolean" && (
              <HStack
                position="absolute"
                bottom="32px"
                left={2}
                gap={1}
              >
                <Button
                  size="xs"
                  variant={editValue.toLowerCase() === "true" ? "solid" : "outline"}
                  colorPalette="green"
                  onClick={() => {
                    setCellValue(datasetId, row, columnId, "true");
                    setEditingCell(undefined);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  true
                </Button>
                <Button
                  size="xs"
                  variant={editValue.toLowerCase() === "false" ? "solid" : "outline"}
                  colorPalette="red"
                  onClick={() => {
                    setCellValue(datasetId, row, columnId, "false");
                    setEditingCell(undefined);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  false
                </Button>
              </HStack>
            )}
            <Box
              paddingX={2}
              paddingY={1}
              fontSize="10px"
              color={validationError ? "red.fg" : "fg.muted"}
              borderTop="1px solid"
              borderColor={validationError ? "red.muted" : "border.muted"}
              bg={validationError ? "red.subtle" : "bg.subtle"}
            >
              {validationError ? (
                dataType === "boolean" ? (
                  "Invalid value. Use: true, false, 1, or 0"
                ) : (
                  "Invalid number"
                )
              ) : (
                "Enter to save • Escape to cancel • Shift+Enter for newline"
              )}
            </Box>
          </Box>
        </Portal>
      )}
    </>
  );
}
