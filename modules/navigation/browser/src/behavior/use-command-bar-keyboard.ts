import { useCallback } from "react";

import type { ListItem } from "../model/command-icon-info.ts";

/**
 * Hook that handles keyboard navigation and shortcuts for the command bar.
 */
export function useCommandBarKeyboard({
  allItems,
  selectedIndex,
  setSelectedIndex,
  handleSelect,
  handleCopyLink,
  isMac,
  onAskLangy,
}: {
  allItems: ListItem[];
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  handleSelect: (item: ListItem, newTab?: boolean) => void;
  handleCopyLink: () => void;
  isMac: boolean;
  /**
   * Hand what is typed to Langy, on Tab — omitted for a reader who cannot
   * start a Langy turn, so the key falls through to moving focus: a
   * shortcut that silently does nothing is worse than none at all.
   */
  onAskLangy?: () => void;
}) {
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
    [allItems, selectedIndex, setSelectedIndex, handleSelect, handleCopyLink, isMac, onAskLangy],
  );
}
