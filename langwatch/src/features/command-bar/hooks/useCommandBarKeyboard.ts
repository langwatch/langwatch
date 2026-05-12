import { useCallback } from "react";
import type { ListItem } from "../getIconInfo";

interface AskLangyKeyboardOpts {
  askLangyMode: boolean;
  setAskLangyMode: (on: boolean) => void;
  onAskLangy: () => void;
  hasQuery: boolean;
}

/**
 * Hook that handles keyboard navigation and shortcuts for the command bar.
 *
 * In addition to standard arrow/Enter/Cmd+L behavior, this hook implements
 * a Chrome-omnibox-style "Tab → Ask Langy" flow: pressing Tab with a
 * non-empty query flips the input into Ask Langy mode; Enter in that mode
 * submits the query into Langy.
 */
export function useCommandBarKeyboard(
  allItems: ListItem[],
  selectedIndex: number,
  setSelectedIndex: (index: number | ((prev: number) => number)) => void,
  handleSelect: (item: ListItem, newTab?: boolean) => void,
  handleCopyLink: () => void,
  isMac: boolean,
  ask: AskLangyKeyboardOpts,
) {
  const { askLangyMode, setAskLangyMode, onAskLangy, hasQuery } = ask;

  return useCallback(
    (e: React.KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

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
        case "Tab":
          if (!e.shiftKey && !askLangyMode && hasQuery) {
            e.preventDefault();
            setAskLangyMode(true);
          }
          break;
        case "Backspace":
          if (askLangyMode && !hasQuery) {
            e.preventDefault();
            setAskLangyMode(false);
          }
          break;
        case "Enter":
          e.preventDefault();
          if (askLangyMode) {
            onAskLangy();
            break;
          }
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
      askLangyMode,
      setAskLangyMode,
      onAskLangy,
      hasQuery,
    ],
  );
}
