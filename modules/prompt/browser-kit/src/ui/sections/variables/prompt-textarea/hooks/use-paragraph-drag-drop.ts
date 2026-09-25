import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";

import { BORDERLESS_LINE_HEIGHT, setTextareaValueUndoable } from "../prompt-textarea.utils.ts";

type UseParagraphDragDropProps = {
  localValue: string;
  onChange: (value: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  borderless: boolean;
};

type Paragraph = {
  text: string;
  startIndex: number;
  endIndex: number;
};

type LinePosition = { top: number; height: number; text?: string };

/** The text split on newlines, with each line's offsets; a trailing newline adds no empty line. */
function splitParagraphs(value: string): Paragraph[] {
  const lines: Paragraph[] = [];
  let lineStart = 0;
  let newline = value.indexOf("\n");
  while (newline !== -1) {
    lines.push({ text: value.slice(lineStart, newline), startIndex: lineStart, endIndex: newline });
    lineStart = newline + 1;
    newline = value.indexOf("\n", lineStart);
  }
  if (lineStart < value.length) {
    lines.push({ text: value.slice(lineStart), startIndex: lineStart, endIndex: value.length });
  }
  return lines;
}

/** One fixed-height row per line, in order. */
function linePositions(paragraphs: Paragraph[]): LinePosition[] {
  return paragraphs.map((para, idx) => ({
    top: idx * BORDERLESS_LINE_HEIGHT,
    height: BORDERLESS_LINE_HEIGHT,
    text: para.text,
  }));
}

/** The text with one line moved, and where the moved line now starts. */
function moveParagraph({
  paragraphs,
  from,
  to,
}: {
  paragraphs: Paragraph[];
  from: number;
  to: number;
}) {
  const reordered = [...paragraphs];
  const [removed] = reordered.splice(from, 1);
  if (removed) reordered.splice(to, 0, removed);
  return {
    newText: reordered.map((p) => p.text).join("\n"),
    movedLineStart: reordered.slice(0, to).reduce((acc, p) => acc + p.text.length + 1, 0),
  };
}

/** The line under a vertical offset, or null when the offset is on no line. */
function lineAt(positions: LinePosition[], relativeY: number): number | null {
  const index = positions.findIndex(
    (pos) => relativeY >= pos.top && relativeY < pos.top + pos.height,
  );
  return index === -1 ? null : index;
}

/** The first line whose midpoint is below the offset, else after the last line. */
function dropIndexAt(positions: LinePosition[], relativeY: number): number {
  const index = positions.findIndex((pos) => relativeY < pos.top + pos.height / 2);
  return index === -1 ? positions.length : index;
}

/**
 * Handles paragraph-level drag and drop for reordering text lines.
 * Only active in borderless mode.
 */
export const useParagraphDragDrop = ({
  localValue,
  onChange,
  containerRef,
  borderless,
}: UseParagraphDragDropProps) => {
  const [hoveredParagraph, setHoveredParagraph] = useState<number | null>(null);
  const [gripHoveredParagraph, setGripHoveredParagraph] = useState<number | null>(null);
  const [draggedParagraph, setDraggedParagraph] = useState<number | null>(null);
  const [dropTargetParagraph, setDropTargetParagraph] = useState<number | null>(null);

  // Store paragraph positions in a ref to avoid re-renders during typing
  const paragraphPositionsRef = useRef<LinePosition[]>([]);

  // Clear cached positions when text changes so they get recalculated
  useEffect(() => {
    paragraphPositionsRef.current = [];
  }, [localValue]);

  // Parse text into paragraphs
  const parseParagraphs = useCallback(() => splitParagraphs(localValue), [localValue]);

  // Calculate paragraph positions (lazy calculation)
  const calculateParagraphPositions = useCallback(
    () => (containerRef.current && borderless ? linePositions(parseParagraphs()) : []),
    [borderless, parseParagraphs, containerRef],
  );

  // Update positions only when needed
  const updateParagraphPositions = useCallback(() => {
    paragraphPositionsRef.current = calculateParagraphPositions();
  }, [calculateParagraphPositions]);

  // Handle paragraph drag start
  const handleParagraphDragStart = useCallback((e: DragEvent, paragraphIndex: number) => {
    setDraggedParagraph(paragraphIndex);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(paragraphIndex));
  }, []);

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

      const { newText, movedLineStart } = moveParagraph({
        paragraphs: parseParagraphs(),
        from: draggedParagraph,
        to: targetIndex,
      });
      // Use undo-able replacement so Ctrl+Z works, then sync React state
      const textarea = containerRef.current?.querySelector("textarea");
      if (textarea) setTextareaValueUndoable(textarea, newText, movedLineStart);
      onChange(newText);

      setDraggedParagraph(null);
      setDropTargetParagraph(null);
    },
    [draggedParagraph, parseParagraphs, onChange, containerRef],
  );

  // Handle drag end (cleanup)
  const handleParagraphDragEnd = useCallback(() => {
    setDraggedParagraph(null);
    setDropTargetParagraph(null);
  }, []);

  // Handle mouse move to detect which line is being hovered
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!borderless) return;

      updateParagraphPositions();

      const positions = paragraphPositionsRef.current;
      if (positions.length <= 1) return;

      const container = containerRef.current;
      if (!container) return;

      const relativeY = e.clientY - container.getBoundingClientRect().top;
      setHoveredParagraph(lineAt(positions, relativeY));
    },
    [borderless, updateParagraphPositions, containerRef],
  );

  // Calculate drop target index based on mouse Y position during drag
  const handleDragOverContainer = useCallback(
    (e: React.DragEvent) => {
      if (draggedParagraph === null || !borderless) return;
      e.preventDefault();

      const positions = paragraphPositionsRef.current;
      const container = containerRef.current;
      if (!container) return;

      const relativeY = e.clientY - container.getBoundingClientRect().top;
      setDropTargetParagraph(dropIndexAt(positions, relativeY));
    },
    [draggedParagraph, borderless, containerRef],
  );

  // Reset hover states on mouse leave
  const handleMouseLeave = useCallback(() => {
    setHoveredParagraph(null);
    setGripHoveredParagraph(null);
  }, []);

  // Get visible positions (only when hovered and needed for UI)
  const getVisibleParagraphPositions = useCallback(
    (isHovered: boolean) => {
      const showsGrips = (isHovered || draggedParagraph !== null) && borderless;
      if (!showsGrips) return [];
      // Calculate positions if not yet populated
      if (paragraphPositionsRef.current.length === 0) {
        paragraphPositionsRef.current = calculateParagraphPositions();
      }
      return paragraphPositionsRef.current;
    },
    [borderless, draggedParagraph, calculateParagraphPositions],
  );

  return {
    // State
    hoveredParagraph,
    gripHoveredParagraph,
    draggedParagraph,
    dropTargetParagraph,
    // Setters
    setGripHoveredParagraph,
    // Handlers
    handleParagraphDragStart,
    handleParagraphDragOver,
    handleParagraphDrop,
    handleParagraphDragEnd,
    handleMouseMove,
    handleDragOverContainer,
    handleMouseLeave,
    // Getters
    getVisibleParagraphPositions,
  };
};
