import { useEffect, useRef, useState } from "react";

type UseTextareaResizeProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  minHeightPx: number;
};

/**
 * Detects manual textarea resizing by the user.
 * Tracks if user has resized beyond minimum to disable auto-height.
 */
export const useTextareaResize = ({
  containerRef,
  minHeightPx,
}: UseTextareaResizeProps) => {
  const [userResizedHeight, setUserResizedHeight] = useState<number | null>(null);
  const isUserResizingRef = useRef(false);
  const pendingHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (!textarea) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Check if mouse is near the resize handle (bottom-right corner)
      const rect = textarea.getBoundingClientRect();
      const isNearResizeHandle =
        e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20;
      if (isNearResizeHandle) {
        isUserResizingRef.current = true;
        pendingHeightRef.current = null;
      }
    };

    const handleMouseUp = () => {
      if (isUserResizingRef.current && pendingHeightRef.current !== null) {
        const finalHeight = pendingHeightRef.current;
        // If resized close to minimum, reset to auto-height mode
        if (finalHeight <= minHeightPx + 10) {
          setUserResizedHeight(null);
        } else {
          setUserResizedHeight(finalHeight);
        }
      }
      isUserResizingRef.current = false;
      pendingHeightRef.current = null;
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // Only track height changes during active resize
      if (isUserResizingRef.current) {
        pendingHeightRef.current = entry.contentRect.height;
      }
    });

    textarea.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    observer.observe(textarea);

    return () => {
      textarea.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [containerRef, minHeightPx]);

  const useAutoHeight = userResizedHeight === null;

  return {
    userResizedHeight,
    useAutoHeight,
  };
};

