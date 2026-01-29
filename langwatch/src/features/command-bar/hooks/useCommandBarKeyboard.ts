import { useCallback } from "react";
import type { ListItem } from "../getIconInfo";

/**
 * Hook that handles keyboard navigation and shortcuts for the command bar.
 */
export function useCommandBarKeyboard(
  allItems: ListItem[],
  selectedIndex: number,
  setSelectedIndex: (index: number | ((prev: number) => number)) => void,
  handleSelect: (item: ListItem, newTab?: boolean) => void,
  handleCopyLink: () => void,
  isMac: boolean
) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i >= allItems.length - 1 ? 0 : i + 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i <= 0 ? allItems.length - 1 : i - 1));
          break;
        case "Enter":
          e.preventDefault();
          if (allItems[selectedIndex]) {
            handleSelect(allItems[selectedIndex], modKey);
          }
          break;
        case "l":
        case "L":
          if (modKey) {
            e.preventDefault();
            handleCopyLink();
          }
          break;
      }
    },
    [allItems, selectedIndex, setSelectedIndex, handleSelect, handleCopyLink, isMac]
  );
}
