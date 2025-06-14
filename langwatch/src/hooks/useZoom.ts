import { useEffect, useRef, useState } from "react";

export const useZoom = () => {
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomIn = () => {
    setScale(Math.min(scale + 0.1, 1.0));
  };
  const zoomOut = () => {
    setScale(Math.max(scale - 0.1, 0.1));
  };

  // Handle wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY || e.deltaX;
        const newScale = Math.min(Math.max(scale - delta / 50, 0.1), 1.0);
        setScale(newScale);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scale]);

  return {
    scale,
    containerRef,
    zoomIn,
    zoomOut,
  };
};
