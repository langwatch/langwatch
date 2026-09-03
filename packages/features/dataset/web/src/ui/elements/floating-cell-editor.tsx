import { Box, Button, HStack, Portal, Textarea } from "@chakra-ui/react";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useDatasetTable } from "../../model/dataset-table-context";
import {
  formatJsonCellValue,
  JSON_LIKE_TYPES,
  validateCellValue,
} from "../../model/editable-cell-value";

type FloatingCellEditorProps = {
  value: string;
  row: number;
  columnId: string;
  datasetId: string;
  dataType?: DatasetColumnType;
  anchorRef: RefObject<HTMLDivElement | null>;
  isEditing: boolean;
};

function editorPosition(anchor: HTMLDivElement): {
  style: CSSProperties;
  textareaHeight: number;
  intendedPosition: { top: number; left: number };
} | null {
  const cell = anchor.closest("td");
  if (!cell) {
    return null;
  }

  const rect = cell.getBoundingClientRect();
  const padding = 16;
  const footerHeight = 28;
  const width = Math.max(rect.width + padding, 250);
  const left = Math.max(8, Math.min(rect.left - 8, window.innerWidth - width - 8));
  const top = rect.top - 8;

  return {
    textareaHeight: Math.max(80, rect.height + padding - footerHeight),
    intendedPosition: { top, left },
    style: {
      position: "fixed",
      top,
      left,
      width,
      minHeight: rect.height + padding,
      zIndex: 1000,
    },
  };
}

export function FloatingCellEditor({
  value,
  row,
  columnId,
  datasetId,
  dataType,
  anchorRef,
  isEditing,
}: FloatingCellEditorProps) {
  const { setCellValue, setEditingCell, editorPortalRef } = useDatasetTable();
  const [editValue, setEditValue] = useState(value);
  const [style, setStyle] = useState<CSSProperties>({});
  const [textareaHeight, setTextareaHeight] = useState<number | undefined>(void 0);
  const [validationError, setValidationError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelingRef = useRef(false);
  const intendedPositionRef = useRef<{ top: number; left: number } | null>(null);
  const offsetCorrectedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    cancelingRef.current = false;
    setValidationError(false);

    const isJson = dataType !== void 0 && JSON_LIKE_TYPES.includes(dataType);
    setEditValue(isJson ? formatJsonCellValue(value).formatted : value);
  }, [dataType, isEditing, value]);

  useLayoutEffect(() => {
    if (!isEditing || !anchorRef.current) {
      return;
    }

    const position = editorPosition(anchorRef.current);
    if (!position) {
      return;
    }

    intendedPositionRef.current = position.intendedPosition;
    offsetCorrectedRef.current = false;
    setTextareaHeight(position.textareaHeight);
    setStyle(position.style);

    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
  }, [anchorRef, isEditing]);

  useLayoutEffect(() => {
    const intended = intendedPositionRef.current;
    if (!isEditing || !intended || offsetCorrectedRef.current) {
      return;
    }

    const editor = textareaRef.current?.closest<HTMLElement>("[data-floating-cell-editor]");
    if (!editor) {
      return;
    }

    const rect = editor.getBoundingClientRect();
    const horizontalMiss = rect.left - intended.left;
    const verticalMiss = rect.top - intended.top;
    const needsCorrection = Math.abs(horizontalMiss) > 1 || Math.abs(verticalMiss) > 1;

    if (!needsCorrection) {
      return;
    }

    offsetCorrectedRef.current = true;
    setStyle((previous) => ({
      ...previous,
      left: (typeof previous.left === "number" ? previous.left : 0) - horizontalMiss,
      top: (typeof previous.top === "number" ? previous.top : 0) - verticalMiss,
    }));
  }, [isEditing, style]);

  const save = useCallback(() => {
    const result = validateCellValue(dataType, editValue);
    if (!result.valid) {
      setValidationError(true);
      return;
    }

    setCellValue(datasetId, row, columnId, result.normalized);
    setValidationError(false);
    setEditingCell(void 0);
  }, [columnId, dataType, datasetId, editValue, row, setCellValue, setEditingCell]);

  const cancel = useCallback(() => {
    cancelingRef.current = true;
    setEditValue(value);
    setValidationError(false);
    setEditingCell(void 0);
  }, [setEditingCell, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const saves = event.key === "Tab" || (event.key === "Enter" && !event.shiftKey);
      if (!saves) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      save();
    },
    [save],
  );

  const handleBlur = useCallback(() => {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      return;
    }

    save();
  }, [save]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const cancelOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancel();
    };

    window.addEventListener("keydown", cancelOnEscape, { capture: true });
    return () => window.removeEventListener("keydown", cancelOnEscape, { capture: true });
  }, [cancel, isEditing]);

  if (!isEditing) {
    return null;
  }

  const errorMessage =
    dataType === "boolean" ? "Invalid value. Use: true, false, 1, or 0" : "Invalid number";

  return (
    <Portal container={editorPortalRef ?? void 0}>
      <Box
        data-floating-cell-editor
        style={style}
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
          onChange={(event) => {
            setEditValue(event.target.value);
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
          <HStack position="absolute" bottom="32px" left={2} gap={1}>
            <Button
              size="xs"
              variant={editValue.toLowerCase() === "true" ? "solid" : "outline"}
              colorPalette="green"
              onClick={() => {
                setCellValue(datasetId, row, columnId, "true");
                setEditingCell(void 0);
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              true
            </Button>
            <Button
              size="xs"
              variant={editValue.toLowerCase() === "false" ? "solid" : "outline"}
              colorPalette="red"
              onClick={() => {
                setCellValue(datasetId, row, columnId, "false");
                setEditingCell(void 0);
              }}
              onMouseDown={(event) => event.preventDefault()}
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
          {validationError
            ? errorMessage
            : "Enter to save • Escape to cancel • Shift+Enter for newline"}
        </Box>
      </Box>
    </Portal>
  );
}
