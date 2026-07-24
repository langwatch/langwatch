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
  isMac: boolean,
  /**
   * Hand what is typed to Langy, on Tab.
   *
   * Omitted for a reader who cannot start a Langy turn, and the key then falls
   * through to its normal job of moving focus: a shortcut that silently does
   * nothing is worse than one that was never offered.
   */
  onAskLangy?: () => void
) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      // Ahead of the switch: Tab carries no modifier of its own, and Shift+Tab
      // has to stay the way back out of the field.
      if (e.key === "Tab" && !e.shiftKey && onAskLangy) {
        e.preventDefault();
        onAskLangy();
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (allItems.length === 0) break;
          setSelectedIndex((i) => (i >= allItems.length - 1 ? 0 : i + 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          if (allItems.length === 0) break;
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
    [
      allItems,
      selectedIndex,
      setSelectedIndex,
      handleSelect,
      handleCopyLink,
      isMac,
      onAskLangy,
    ]
  );
}
