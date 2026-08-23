import { useCallback, useEffect, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";
import { useDraggableTabsBrowserStore } from "../../../prompt-playground-store/DraggableTabsBrowserStore";

/**
 * The variable values a prompt tab runs with.
 *
 * They live per tab and survive a refresh, but typing into a variable field
 * must not re-render the whole pane on every keystroke, so the current values
 * are local state and the store is written behind a debounce.
 */
export function useTabVariableValues(tabId: string): {
  values: Record<string, string>;
  onValueChange: (identifier: string, value: string) => void;
} {
  const { storedVariableValues, updateTabData } = useDraggableTabsBrowserStore(
    (state) => {
      const tabData = state.getByTabId(tabId);
      return {
        storedVariableValues: tabData?.variableValues ?? {},
        updateTabData: state.updateTabData,
      };
    },
  );

  const [values, setValues] =
    useState<Record<string, string>>(storedVariableValues);

  const persist = useDebounceCallback((next: Record<string, string>) => {
    updateTabData({
      tabId,
      updater: (data) => ({ ...data, variableValues: next }),
    });
  }, 300);

  // Flush any pending write before unmount. useDebounceCallback cancels on
  // unmount, so without this a value typed just before switching prompt tabs
  // — which unmounts this tab — would be lost.
  useEffect(() => {
    return () => {
      persist.flush();
    };
  }, [persist]);

  const onValueChange = useCallback(
    (identifier: string, value: string) => {
      setValues((prev) => {
        const updated = { ...prev, [identifier]: value };
        persist(updated);
        return updated;
      });
    },
    [persist],
  );

  return { values, onValueChange };
}
