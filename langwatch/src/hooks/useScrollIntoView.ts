import { useEffect } from "react";

/**
 * Hook that scrolls the selected item into view.
 */
export function useScrollIntoView(
  selectedIndex: number,
  resultsRef: React.RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!resultsRef.current) return;
    const selectedElement = resultsRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex, resultsRef]);
}
