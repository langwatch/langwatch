import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { CommandBar } from "./CommandBar";
import { CommandBarContext } from "./CommandBarContext";
import { useActivityTracker } from "./useActivityTracker";

interface CommandBarProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for the command bar.
 * Handles global Cmd/Ctrl+K keyboard shortcut and manages open/close state.
 */
export function CommandBarProvider({ children }: CommandBarProviderProps) {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Track user navigation to entity pages
  useActivityTracker();

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery(""); // Reset query when opening
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Global keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is not logged in
      if (!session) return;

      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key === "k") {
        e.preventDefault();
        toggle();
      }

      // Also close on Escape
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session, isOpen, toggle, close]);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
    }),
    [isOpen, open, close, toggle, query]
  );

  return (
    <CommandBarContext.Provider value={value}>
      {children}
      {/* Only render command bar if user is logged in */}
      {session && <CommandBar />}
    </CommandBarContext.Provider>
  );
}
