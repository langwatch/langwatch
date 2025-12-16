/**
 * Dataset Section
 *
 * Spreadsheet section for dataset columns with inline editing.
 */

import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { ColumnHeader, SpreadsheetCell, SuperHeader } from "./EvaluationSpreadsheet";
import { LuPlus, LuSettings, LuDatabase } from "react-icons/lu";
import { useState, useRef, useEffect } from "react";
import { Tooltip } from "../../../../components/ui/tooltip";
import { Menu } from "../../../../components/ui/menu";
import { createEmptyRow } from "../../types";

export function DatasetSection({
  rowCount,
  onScroll,
}: {
  rowCount: number;
  onScroll?: (scrollTop: number) => void;
}) {
  const {
    dataset,
    addDatasetColumn,
    setCellValue,
    addDatasetRow,
    expandedCell,
    setExpandedCell,
    setActiveModal,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      dataset: s.dataset,
      addDatasetColumn: s.addDatasetColumn,
      setCellValue: s.setCellValue,
      addDatasetRow: s.addDatasetRow,
      expandedCell: s.expandedCell,
      setExpandedCell: s.setExpandedCell,
      setActiveModal: s.setActiveModal,
    }))
  );

  const columns = dataset.columns;
  const rows = dataset.type === "inline" ? dataset.rows : [];

  // Calculate total width
  const columnWidth = 180;
  const addColumnWidth = 40; // Smaller width for add button
  const totalWidth = columns.length * columnWidth + addColumnWidth;

  const handleAddColumn = () => {
    const newId = `column_${Date.now()}`;
    addDatasetColumn({
      id: newId,
      name: `new_column`,
      type: "string",
    });
  };

  return (
    <VStack
      gap={0}
      minWidth={`${totalWidth}px`}
      borderRight="2px solid"
      borderColor="gray.300"
      flexShrink={0}
    >
      {/* Super Header */}
      <SuperHeader title="Dataset" colorScheme="blue" minWidth={`${totalWidth}px`}>
        <HStack gap={1}>
          <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
              <IconButton
                aria-label="Dataset options"
                variant="ghost"
                size="xs"
                colorPalette="blue"
              >
                <LuDatabase size={14} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="choose" onClick={() => setActiveModal({ type: "choose-dataset" })}>
                Choose existing dataset
              </Menu.Item>
              {dataset.type === "inline" && (
                <Menu.Item value="save" onClick={() => setActiveModal({ type: "save-dataset" })}>
                  Save as dataset
                </Menu.Item>
              )}
              <Menu.Item value="columns" onClick={() => setActiveModal({ type: "dataset-columns" })}>
                Edit columns
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </HStack>
      </SuperHeader>

      {/* Column Headers - Top row with empty space to align with agents */}
      <HStack gap={0} width="full">
        {columns.map((column) => (
          <Box
            key={column.id}
            height="36px"
            minWidth={`${columnWidth}px`}
            background="blue.50"
            borderBottom="1px solid"
            borderColor="blue.200"
          />
        ))}
        {/* Add Column Button - empty row */}
        <Box
          height="36px"
          minWidth={`${addColumnWidth}px`}
          background="gray.50"
          borderBottom="1px solid"
          borderColor="gray.200"
        />
      </HStack>
      {/* Column Headers - Bottom row with column names */}
      <HStack gap={0} width="full">
        {columns.map((column) => (
          <ColumnHeader
            key={column.id}
            title={column.name}
            width={`${columnWidth}px`}
          />
        ))}
        {/* Add Column Button */}
        <Box
          height="36px"
          minWidth={`${addColumnWidth}px`}
          background="gray.50"
          borderBottom="2px solid"
          borderColor="gray.300"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Tooltip content="Add column">
            <IconButton
              aria-label="Add column"
              variant="ghost"
              size="xs"
              onClick={handleAddColumn}
            >
              <LuPlus size={12} />
            </IconButton>
          </Tooltip>
        </Box>
      </HStack>

      {/* Data Rows */}
      {Array.from({ length: rowCount }).map((_, rowIndex) => {
        const row = rows[rowIndex];
        const rowId = row?.id ?? `temp_${rowIndex}`;

        return (
          <HStack key={rowId} gap={0} width="full">
            {columns.map((column) => {
              const isEditing =
                expandedCell?.section === "dataset" &&
                expandedCell?.columnId === column.id &&
                expandedCell?.rowIndex === rowIndex;

              const value = row?.values[column.id] ?? null;

              if (isEditing) {
                return (
                  <EditableCell
                    key={column.id}
                    value={value}
                    rowId={rowId}
                    columnId={column.id}
                    rowIndex={rowIndex}
                    width={columnWidth}
                    onSave={(newValue) => {
                      // If this is a new row, add it first
                      if (!row) {
                        addDatasetRow();
                      }
                      setCellValue(rowId, column.id, newValue);
                      setExpandedCell(null);
                    }}
                    onCancel={() => setExpandedCell(null)}
                  />
                );
              }

              return (
                <SpreadsheetCell
                  key={column.id}
                  value={value}
                  rowIndex={rowIndex}
                  columnId={column.id}
                  section="dataset"
                  isEditable={dataset.type === "inline"}
                  width={`${columnWidth}px`}
                  onDoubleClick={() => {
                    if (dataset.type === "inline") {
                      setExpandedCell({
                        section: "dataset",
                        columnId: column.id,
                        rowIndex,
                      });
                    }
                  }}
                />
              );
            })}
            {/* Empty cell for add column area */}
            <Box
              height="40px"
              minWidth={`${addColumnWidth}px`}
              background={rowIndex % 2 === 0 ? "white" : "gray.50"}
              borderBottom="1px solid"
              borderColor="gray.100"
            />
          </HStack>
        );
      })}
    </VStack>
  );
}

/**
 * Editable Cell Component
 *
 * Shows an expanded textarea for editing cell content.
 */
function EditableCell({
  value,
  rowId,
  columnId,
  rowIndex,
  width,
  onSave,
  onCancel,
}: {
  value: string | number | boolean | null;
  rowId: string;
  columnId: string;
  rowIndex: number;
  width: number;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [editValue, setEditValue] = useState(
    value === null || value === undefined ? "" : String(value)
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSave(editValue);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onSave(editValue);
    }
  };

  return (
    <Box
      position="relative"
      width={`${width}px`}
      minWidth={`${width}px`}
      height="40px"
      zIndex={10}
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        width={`${Math.max(width, 300)}px`}
        minHeight="120px"
        background="white"
        border="2px solid"
        borderColor="blue.400"
        borderRadius="md"
        boxShadow="lg"
        padding={2}
        zIndex={100}
      >
        <Textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onSave(editValue)}
          size="sm"
          minHeight="80px"
          resize="vertical"
          border="none"
          _focus={{ border: "none", boxShadow: "none" }}
        />
        <HStack justify="flex-end" marginTop={2}>
          <Text fontSize="xs" color="gray.400">
            Press Enter to save, Esc to cancel
          </Text>
        </HStack>
      </Box>
    </Box>
  );
}

