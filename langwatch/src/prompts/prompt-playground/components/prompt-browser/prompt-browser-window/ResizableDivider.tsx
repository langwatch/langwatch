import { Box, Center } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuGripHorizontal } from "react-icons/lu";

export type ResizableDividerProps = {
  /** Whether the top panel is expanded */
  isExpanded: boolean;
  /** Callback when position changes (absolute Y from container top) */
  onPositionChange: (clientY: number) => void;
  /** Callback when dragging ends */
  onDragEnd: () => void;
  /** Callback to toggle expand/collapse */
  onToggle: () => void;
};

/**
 * ResizableDivider
 * A draggable divider that allows resizing between two panels.
 * Features:
 * - Drag to resize (entire bar including button)
 * - Click center button to toggle between expanded/collapsed
 * - Visual grip indicator
 */
export function ResizableDivider({
  isExpanded,
  onPositionChange,
  onDragEnd,
  onToggle,
}: ResizableDividerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startYRef = useRef(0);
  const hasDraggedRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startYRef.current = e.clientY;
    hasDraggedRef.current = false;
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Mark as dragged if moved more than 3px
      if (Math.abs(e.clientY - startYRef.current) > 3) {
        hasDraggedRef.current = true;
      }
      onPositionChange(e.clientY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Only toggle if it was a click (no significant drag)
      if (!hasDraggedRef.current) {
        onToggle();
      } else {
        onDragEnd();
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onPositionChange, onDragEnd, onToggle]);

  return (
    <Box
      data-testid="resizable-divider"
      position="relative"
      height="16px"
      width="full"
      cursor="row-resize"
      userSelect="none"
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      zIndex={10}
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      marginTop={-2.5}
      _before={{
        content: '""',
        position: "absolute",
        top: "50%",
        left: 0,
        right: 0,
        height: "1px",
        bg: "border.muted",
        transform: "translateY(-50%)",
      }}
    >
      {/* Center grip/toggle indicator - sits on the horizontal line */}
      <Center
        position="relative"
        bg="bg.panel"
        borderRadius="full"
        border="1px solid"
        borderColor={isDragging || isHovered ? "border.emphasized" : "border"}
        width="28px"
        height="14px"
        cursor="row-resize"
        transition="border-color 0.15s, background 0.15s"
        _hover={{
          borderColor: "border.emphasized",
          bg: "bg.muted",
        }}
        zIndex={11}
        pointerEvents="none"
      >
        {isDragging || isHovered ? (
          isExpanded ? (
            <LuChevronUp size={12} color="var(--chakra-colors-fg-muted)" />
          ) : (
            <LuChevronDown size={12} color="var(--chakra-colors-fg-muted)" />
          )
        ) : (
          <LuGripHorizontal size={12} color="var(--chakra-colors-fg-subtle)" />
        )}
      </Center>
    </Box>
  );
}
