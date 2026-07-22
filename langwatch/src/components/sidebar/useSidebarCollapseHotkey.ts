import { useEffect } from "react";

import {
  getIsMac,
} from "~/features/command-bar/utils/platform";

/** Display form of the sidebar toggle shortcut for tooltips. */
export const getSidebarToggleShortcut = () => (getIsMac() ? "⌘B" : "Ctrl+B");

/**
 * Global ⌘B / Ctrl+B toggles the sidebar collapse preference — the same
 * choice the logo control makes, reachable without the pointer.
 *
 * Registered once by DashboardLayout (never inside useSidebarCollapsed,
 * which mounts in several components and would double-toggle). Typing
 * surfaces keep their own ⌘B (bold, etc.): the handler stands down for
 * inputs, textareas, and contenteditable targets.
 *
 * Spec: specs/navigation/sidebar-collapse-preference.feature
 */
export function useSidebarCollapseHotkey({
  enabled,
  isCollapsed,
  setCollapsed,
}: {
  enabled: boolean;
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = getIsMac() ? e.metaKey : e.ctrlKey;
      if (!modKey || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "b") return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      setCollapsed(!isCollapsed);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, isCollapsed, setCollapsed]);
}
