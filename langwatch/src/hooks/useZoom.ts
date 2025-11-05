import { useCallback, useEffect, useRef, useState } from "react";

export const useZoom = () => {
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale); // ← Track scale without re-rendering

  // Keep ref in sync
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.1, 1.0));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.1, 0.1));
  }, []);

  // Handle wheel zoom - NO scale dependency!
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY || e.deltaX;
        setScale((currentScale) =>
          Math.min(Math.max(currentScale - delta / 50, 0.1), 1.0),
        );
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []); // ← Empty deps, use setScale functional update

  return {
    scale,
    containerRef,
    zoomIn,
    zoomOut,
  };
};
