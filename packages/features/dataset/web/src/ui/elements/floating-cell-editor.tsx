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
import {
  type AttachmentColumnType,
  isAttachmentColumnType,
} from "../../model/dataset-attachment-file.ts";
import { useDatasetTable } from "../../model/dataset-table-context.tsx";
import {
  formatJsonCellValue,
  JSON_LIKE_TYPES,
  validateCellValue,
} from "../../model/editable-cell-value.ts";
import { DatasetAttachmentPanel } from "./dataset-attachment-panel.tsx";

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
  /** An image or file cell opens on the upload panel; "url" is the text field
   *  the reader reaches through "or enter a URL", and every other type's
   *  editor. */
  const [mode, setMode] = useState<"attachment" | "url">("url");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const cancelingRef = useRef(false);
  const intendedPositionRef = useRef<{ top: number; left: number } | null>(null);
  const offsetCorrectedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    cancelingRef.current = false;
    setValidationError(false);
    setMode(isAttachmentColumnType(dataType) ? "attachment" : "url");

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
  }, [anchorRef, isEditing]);

  // The URL field takes focus whenever it is what the editor shows, which is on
  // open for most columns and on "or enter a URL" for an image or file one.
  useEffect(() => {
    if (!isEditing || mode !== "url") {
      return;
    }

    const focusing = setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
    return () => clearTimeout(focusing);
  }, [isEditing, mode]);

  useLayoutEffect(() => {
    const intended = intendedPositionRef.current;
    if (!isEditing || !intended || offsetCorrectedRef.current) {
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    // The measurement is only meaningful once the intended offsets are on the
    // element. Reading it while the style is still empty measures the editor
    // in the flow of its portal container, and correcting from that pushes it
    // off the viewport for good.
    const appliedLeft = style.left;
    const appliedTop = style.top;
    if (typeof appliedLeft !== "number" || typeof appliedTop !== "number") {
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
      left: appliedLeft - horizontalMiss,
      top: appliedTop - verticalMiss,
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

  /** Takes the value an upload produced, with no validation to do. */
  const saveUploaded = useCallback(
    (uploaded: string) => {
      setCellValue(datasetId, row, columnId, uploaded);
      setValidationError(false);
      setEditingCell(void 0);
    },
    [columnId, datasetId, row, setCellValue, setEditingCell],
  );

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

  // The URL field closes itself on blur. The upload panel has no field to lose
  // focus, so a click anywhere else closes it instead. Without that it floats
  // over the table until the reader finds Escape.
  useEffect(() => {
    if (!isEditing || mode !== "attachment") {
      return;
    }

    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && editorRef.current?.contains(target)) {
        return;
      }
      cancel();
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [cancel, isEditing, mode]);

  if (!isEditing) {
    return null;
  }

  const errorMessage =
    dataType === "boolean" ? "Invalid value. Use: true, false, 1, or 0" : "Invalid number";
  const attachmentType: AttachmentColumnType | undefined = isAttachmentColumnType(dataType)
    ? dataType
    : void 0;
  const showsPanel = attachmentType !== void 0 && mode === "attachment";

  return (
    <Portal container={editorPortalRef ?? void 0}>
      <Box
        ref={editorRef}
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
        {showsPanel && attachmentType ? (
          <DatasetAttachmentPanel
            dataType={attachmentType}
            value={value}
            minHeight={textareaHeight}
            onUploaded={saveUploaded}
            onEnterUrl={() => setMode("url")}
          />
        ) : (
          <>
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
            {attachmentType ? (
              <Box paddingX={2} paddingBottom={2}>
                <Button
                  size="xs"
                  variant="plain"
                  color="fg.muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setMode("attachment")}
                >
                  {attachmentType === "image" ? "or upload an image" : "or upload a file"}
                </Button>
              </Box>
            ) : null}
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
          </>
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
            : showsPanel
              ? "Escape to cancel"
              : "Enter to save • Escape to cancel • Shift+Enter for newline"}
        </Box>
      </Box>
    </Portal>
  );
}
