import { Box, Portal, Textarea } from "@chakra-ui/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";

type EditableCellProps = {
  value: string;
  row: number;
  columnId: string;
};

/**
 * Editable cell component for dataset values.
 *
 * Note: Selection outline is handled by the parent table on the <td> element.
 * This component only handles the edit mode textarea.
 */
export function EditableCell({ value, row, columnId }: EditableCellProps) {
  const { setCellValue, setEditingCell, ui, setSelectedCell } =
    useEvaluationsV3Store((state) => ({
      setCellValue: state.setCellValue,
      setEditingCell: state.setEditingCell,
      ui: state.ui,
      setSelectedCell: state.setSelectedCell,
    }));

  const isEditing =
    ui.editingCell?.row === row && ui.editingCell?.columnId === columnId;

  const [editValue, setEditValue] = useState(value);
  const [editorStyle, setEditorStyle] = useState<React.CSSProperties>({});
  const cellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset edit value when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditValue(value);
    }
  }, [isEditing, value]);

  // Position editor and focus when editing starts
  useLayoutEffect(() => {
    if (isEditing && cellRef.current) {
      // Get the parent td element for positioning
      const td = cellRef.current.closest("td");
      if (td) {
        const rect = td.getBoundingClientRect();
        setEditorStyle({
          position: "fixed",
          top: rect.top - 8,
          left: rect.left - 8,
          width: Math.max(rect.width, 250),
          minHeight: rect.height,
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
    setCellValue(row, columnId, editValue);
    setEditingCell(undefined);
  }, [row, columnId, editValue, setCellValue, setEditingCell]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
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
    [handleSave, handleCancel]
  );

  const handleBlur = useCallback(() => {
    // Small delay to allow click events to register first
    setTimeout(() => {
      handleSave();
    }, 100);
  }, [handleSave]);

  return (
    <>
      {/* Cell display - click/dblclick handled by parent td */}
      <Box
        ref={cellRef}
        data-testid={`cell-${row}-${columnId}`}
        minHeight="20px"
        fontSize="13px"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        opacity={isEditing ? 0 : 1}
      >
        {value}
      </Box>

      {/* Expanded editor (positioned over cell via portal) */}
      {isEditing && (
        <Portal>
          <Box
            style={editorStyle}
            bg="white"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-blue-500), 0 4px 12px rgba(0,0,0,0.15)"
            overflow="hidden"
          >
            <Textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              minHeight="80px"
              resize="vertical"
              border="none"
              borderRadius="0"
              fontSize="13px"
              padding={2}
              _focus={{ outline: "none", boxShadow: "none" }}
            />
            <Box
              paddingX={2}
              paddingY={1}
              fontSize="10px"
              color="gray.500"
              borderTop="1px solid"
              borderColor="gray.100"
              bg="gray.50"
            >
              Enter to save • Escape to cancel • Shift+Enter for newline
            </Box>
          </Box>
        </Portal>
      )}
    </>
  );
}
