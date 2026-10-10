import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { Box } from "@langwatch/design-system/primitives";
import { isTextLikelyOverflowing } from "@langwatch/design-system/text-overflow";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDatasetTable } from "../../../model/dataset/dataset-table-context.tsx";
import {
  formatJsonCellValue,
  JSON_LIKE_TYPES,
  truncateCellValue,
} from "../../../model/dataset/editable-cell-value.ts";

const MAX_DISPLAY_CHARACTERS = 5000;
const COMPACT_MAX_HEIGHT = 160 - 17;
const EXPANDED_DEFAULT_MAX_HEIGHT = 600;

type DatasetCellDisplayProps = {
  value: string;
  row: number;
  columnId: string;
  datasetId: string;
  dataType?: DatasetColumnType;
  cellRef: RefObject<HTMLDivElement | null>;
  isEditing: boolean;
};

export function DatasetCellDisplay({
  value,
  row,
  columnId,
  datasetId,
  dataType,
  cellRef,
  isEditing,
}: DatasetCellDisplayProps) {
  const {
    rowHeightMode,
    expandedCells,
    toggleCellExpanded,
    renderImage,
    renderAttachment,
    setCellValue,
    setEditingCell,
  } = useDatasetTable();
  const [isHovered, setIsHovered] = useState(false);
  const cellKey = `${row}-${columnId}`;
  const isExpanded = expandedCells.has(cellKey);
  const { contentRef, customHeight, startResize, toggleExpanded } = useCellResize({
    row,
    columnId,
    isExpanded,
    toggleCellExpanded,
  });

  const displayValue = useMemo(() => {
    const isJsonType = dataType !== void 0 && JSON_LIKE_TYPES.includes(dataType);
    const formatted = isJsonType ? formatJsonCellValue(value) : { formatted: value, isJson: false };
    const truncated = truncateCellValue(formatted.formatted, MAX_DISPLAY_CHARACTERS);

    return {
      ...truncated,
      isJson: isJsonType && formatted.isJson,
    };
  }, [dataType, value]);

  const isOverflowing =
    rowHeightMode === "compact" && !isExpanded && isTextLikelyOverflowing(displayValue.text);
  const isCompact = rowHeightMode === "compact" && !isExpanded;
  const showClamped = isCompact && isOverflowing;
  const expandedMaxHeight = `${customHeight ?? EXPANDED_DEFAULT_MAX_HEIGHT}px`;
  const expandedHeight = isExpanded ? expandedMaxHeight : void 0;
  const cellMaxHeight = isCompact ? `${COMPACT_MAX_HEIGHT}px` : expandedHeight;
  const expandedOverflow = isExpanded ? "auto" : void 0;
  const cellOverflow = isCompact ? "hidden" : expandedOverflow;
  const attachmentColumnType = dataType === "image" || dataType === "file" ? dataType : null;
  const attachment =
    attachmentColumnType && renderAttachment
      ? renderAttachment({
          value,
          columnType: attachmentColumnType,
          datasetId,
          fallbackText: displayValue.text,
          fallbackTruncated: displayValue.truncated,
          onChange: (next) => setCellValue({ datasetId, row, columnId, value: next }),
          onOpenEditor: () => setEditingCell({ row, columnId }),
        })
      : null;
  const image = attachment ?? (dataType === "image" && value ? renderImage(value) : null);

  return (
    <Box
      ref={cellRef}
      data-testid={`cell-${row}-${columnId}`}
      height="100%"
      minHeight="20px"
      fontSize={displayValue.isJson ? "12px" : "13px"}
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      opacity={isEditing ? 0 : 1}
      fontFamily={displayValue.isJson ? "mono" : void 0}
      position="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Box ref={contentRef} height="100%" maxHeight={cellMaxHeight} overflow={cellOverflow}>
        {image ?? (
          <>
            {displayValue.text}
            {displayValue.truncated && (
              <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
                (truncated)
              </Box>
            )}
          </>
        )}
      </Box>

      {showClamped && <CellFadeOverlay onClick={toggleExpanded} />}

      {rowHeightMode === "compact" && (isExpanded || (isHovered && isOverflowing)) && (
        <CellResizeHandle onMouseDown={startResize} onClick={toggleExpanded} />
      )}
    </Box>
  );
}

/**
 * Drag-to-resize for an expanded cell: dragging a compact cell open expands it, and dragging it
 * back to the minimum collapses it. A click right after a drag is not a toggle.
 */
function useCellResize({
  row,
  columnId,
  isExpanded,
  toggleCellExpanded,
}: {
  row: number;
  columnId: string;
  isExpanded: boolean;
  toggleCellExpanded: (row: number, columnId: string) => void;
}): {
  contentRef: RefObject<HTMLDivElement | null>;
  customHeight: number | null;
  startResize: (event: ReactMouseEvent) => void;
  toggleExpanded: (event: ReactMouseEvent) => void;
} {
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentHeightRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);
  const startedCompactRef = useRef(false);
  const expandedDuringDragRef = useRef(false);

  useEffect(() => {
    if (!isExpanded) {
      setCustomHeight(null);
    }
  }, [isExpanded]);

  const toggleExpanded = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation();
      if (!draggingRef.current) {
        toggleCellExpanded(row, columnId);
      }
    },
    [columnId, row, toggleCellExpanded],
  );

  const startResize = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation();
      event.preventDefault();

      draggingRef.current = false;
      dragStartYRef.current = event.clientY;
      startedCompactRef.current = !isExpanded;
      expandedDuringDragRef.current = false;
      dragStartHeightRef.current = isExpanded
        ? (customHeight ?? contentRef.current?.scrollHeight ?? COMPACT_MAX_HEIGHT)
        : COMPACT_MAX_HEIGHT;

      const resize = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - dragStartYRef.current;
        if (Math.abs(delta) > 3) {
          draggingRef.current = true;
        }

        if (!draggingRef.current) {
          return;
        }

        const height = Math.max(COMPACT_MAX_HEIGHT, dragStartHeightRef.current + delta);
        currentHeightRef.current = height;
        setCustomHeight(height);

        if (startedCompactRef.current && !expandedDuringDragRef.current) {
          expandedDuringDragRef.current = true;
          toggleCellExpanded(row, columnId);
        }
      };

      const stopResize = () => {
        document.removeEventListener("mousemove", resize);
        document.removeEventListener("mouseup", stopResize);

        const collapsedToMinimum =
          draggingRef.current &&
          currentHeightRef.current !== null &&
          currentHeightRef.current <= COMPACT_MAX_HEIGHT;

        if (collapsedToMinimum) {
          if (expandedDuringDragRef.current || !startedCompactRef.current) {
            toggleCellExpanded(row, columnId);
          }

          setCustomHeight(null);
          currentHeightRef.current = null;
        }

        setTimeout(() => {
          draggingRef.current = false;
        }, 50);
      };

      document.addEventListener("mousemove", resize);
      document.addEventListener("mouseup", stopResize);
    },
    [columnId, customHeight, isExpanded, row, toggleCellExpanded],
  );

  return { contentRef, customHeight, startResize, toggleExpanded };
}

function CellFadeOverlay({ onClick }: { onClick: (event: ReactMouseEvent) => void }) {
  return (
    <Box
      position="absolute"
      bottom="-8px"
      left="-12px"
      right="-12px"
      height="40px"
      cursor="pointer"
      onClick={onClick}
      className="cell-fade-overlay"
      css={{
        background: "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-panel))",
        "tr:hover &": {
          background: "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-subtle))",
        },
        "tr[data-selected='true'] &": {
          background: "linear-gradient(to bottom, transparent, var(--chakra-colors-blue-subtle))",
        },
      }}
    />
  );
}

function CellResizeHandle({
  onMouseDown,
  onClick,
}: {
  onMouseDown: (event: ReactMouseEvent) => void;
  onClick: (event: ReactMouseEvent) => void;
}) {
  return (
    <Box
      position="absolute"
      bottom="-8px"
      left="-10px"
      right="-10px"
      height="20px"
      cursor="ns-resize"
      onMouseDown={onMouseDown}
      onClick={onClick}
      display="flex"
      alignItems="center"
      justifyContent="center"
      opacity={0.5}
      transition="opacity 0.15s"
      _hover={{ opacity: 1 }}
      css={{ background: "var(--cell-bg, var(--chakra-colors-bg-panel))" }}
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
  );
}
