import {
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BORDERLESS_LINE_HEIGHT, setTextareaValueUndoable } from "../utils";

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
  const [gripHoveredParagraph, setGripHoveredParagraph] = useState<
    number | null
  >(null);
  const [draggedParagraph, setDraggedParagraph] = useState<number | null>(null);
  const [dropTargetParagraph, setDropTargetParagraph] = useState<number | null>(
    null,
  );

  // Store paragraph positions in a ref to avoid re-renders during typing
  const paragraphPositionsRef = useRef<
    Array<{ top: number; height: number; text?: string }>
  >([]);

  // Clear cached positions when text changes so they get recalculated
  useEffect(() => {
    paragraphPositionsRef.current = [];
  }, [localValue]);

  // Parse text into paragraphs
  const parseParagraphs = useCallback((): Paragraph[] => {
    const lines: Paragraph[] = [];
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

  // Calculate paragraph positions (lazy calculation)
  const calculateParagraphPositions = useCallback(() => {
    if (!containerRef.current || !borderless) return [];

    const paragraphs = parseParagraphs();
    return paragraphs.map((para, idx) => ({
      top: idx * BORDERLESS_LINE_HEIGHT,
      height: BORDERLESS_LINE_HEIGHT,
      text: para.text,
    }));
  }, [borderless, parseParagraphs, containerRef]);

  // Update positions only when needed
  const updateParagraphPositions = useCallback(() => {
    if (!borderless) {
      paragraphPositionsRef.current = [];
      return;
    }
    paragraphPositionsRef.current = calculateParagraphPositions();
  }, [borderless, calculateParagraphPositions]);

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

      const currentParagraphs = parseParagraphs();
      const newParagraphs = [...currentParagraphs];
      const [removed] = newParagraphs.splice(draggedParagraph, 1);
      if (removed) {
        newParagraphs.splice(targetIndex, 0, removed);
      }

      const newText = newParagraphs.map((p) => p.text).join("\n");

      // Use undo-able replacement so Ctrl+Z works
      const textarea = containerRef.current?.querySelector("textarea");
      if (textarea) {
        // Calculate cursor position at the start of the moved line
        const movedLineStart = newParagraphs
          .slice(0, targetIndex)
          .reduce((acc, p) => acc + p.text.length + 1, 0);

        setTextareaValueUndoable(textarea, newText, movedLineStart);
        // Still call onChange to sync React state
        onChange(newText);
      } else {
        onChange(newText);
      }

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

      const rect = container.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        if (pos && relativeY >= pos.top && relativeY < pos.top + pos.height) {
          setHoveredParagraph(i);
          return;
        }
      }
      setHoveredParagraph(null);
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

      const rect = container.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        if (pos && relativeY < pos.top + pos.height / 2) {
          setDropTargetParagraph(i);
          return;
        }
      }
      setDropTargetParagraph(positions.length);
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
      if ((isHovered || draggedParagraph !== null) && borderless) {
        // Calculate positions if not yet populated
        if (paragraphPositionsRef.current.length === 0) {
          paragraphPositionsRef.current = calculateParagraphPositions();
        }
        return paragraphPositionsRef.current;
      }
      return [];
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
