import { useEffect } from "react";
import { useDensityStore } from "../../stores/densityStore";
import { useDrawerStore } from "../../stores/drawerStore";
import { useFindStore } from "../../stores/findStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useUIStore } from "../../stores/uiStore";

const isTextInput = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
};

/** `[` toggles the filter sidebar, unless the user is typing into an input. */
export const useSidebarShortcut = (): void => {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "[" || isTextInput(e.target)) return;
      e.preventDefault();
      toggleSidebar();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);
};

/**
 * Cmd/Ctrl+F: 1st press opens our in-page find over loaded trace data;
 * 2nd press (while open) closes our overlay and lets the browser's native
 * find take over — no preventDefault on the second press.
 *
 * Registered at capture phase so we beat any TipTap / editor handler that
 * might preventDefault first, and `key.toLowerCase()` because Caps Lock
 * produces "F" without shiftKey.
 */
export const useFindShortcut = (): void => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== "f" || e.shiftKey || e.altKey) {
        return;
      }

      // Read latest state imperatively so we never operate on stale isOpen
      // captured by an effect closure.
      const { isOpen, open, close } = useFindStore.getState();
      if (isOpen) {
        close();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      open();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);
};

/**
 * `?` toggles the page-level keyboard shortcut help. When the trace drawer is
 * open, the drawer's own `?` handler owns this key — we bail so the user
 * always gets the menu closest to whatever they're focused on.
 */
export const useShortcutsHelpShortcut = (): void => {
  const toggle = useUIStore((s) => s.toggleShortcutsHelp);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "?" || isTextInput(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Drawer owns `?` while open — its handler will fire first.
      if (useDrawerStore.getState().isOpen) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);
};

/**
 * Escape clears the bulk selection when one is active. We claim the event
 * (stopPropagation + preventDefault) so the drawer's Escape handler doesn't
 * also fire and close it — clearing selection should be the smaller undo.
 *
 * When no selection is active the handler bails early and other Escape
 * listeners (drawer close, modal dismiss) handle the key as usual.
 */
export const useClearSelectionShortcut = (): void => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isTextInput(e.target)) return;
      const { mode, traceIds, clear } = useSelectionStore.getState();
      const hasSelection = mode === "all-matching" || traceIds.size > 0;
      if (!hasSelection) return;
      e.stopPropagation();
      e.preventDefault();
      clear();
    };
    // Capture phase so we win against bubble-phase Escape handlers (e.g.
    // the drawer's window-level keydown listener).
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);
};

/** `D` flips between compact and comfortable density. */
export const useDensityToggleShortcut = (): void => {
  const setDensity = useDensityStore((s) => s.setDensity);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (isTextInput(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const current = useDensityStore.getState().density;
      setDensity(current === "compact" ? "comfortable" : "compact");
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setDensity]);
};
