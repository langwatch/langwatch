import { useEffect } from "react";
import { useFindStore } from "../../stores/findStore";
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
 */
export const useFindShortcut = (): void => {
  const isOpen = useFindStore((s) => s.isOpen);
  const open = useFindStore((s) => s.open);
  const close = useFindStore((s) => s.close);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== "f" || e.shiftKey || e.altKey) return;

      if (isOpen) {
        close();
        return;
      }

      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close]);
};
