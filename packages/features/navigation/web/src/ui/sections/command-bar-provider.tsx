import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActivityTracker } from "../../behavior/use-activity-tracker";
import { registerCommandBarControl } from "../../behavior/command-bar-control";
import { CommandBarContext } from "../../behavior/command-bar-context";
import { getIsMac } from "../../model/command-platform";
import { useNavigationHost } from "../../model/navigation-host";
import { CommandBar } from "./command-bar";

interface CommandBarProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for the command bar.
 * Handles global Cmd/Ctrl+K keyboard shortcut and manages open/close state.
 */
export function CommandBarProvider({ children }: CommandBarProviderProps) {
  const host = useNavigationHost();
  const signedIn = !!host.currentUser();
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

  // A page that already shows the palette in place registers itself here. The
  // home does, which is why Cmd+K there lands in the field the reader is
  // already looking at instead of covering it with an identical one.
  const inlinePaletteRef = useRef<(() => void) | null>(null);
  const registerInlinePalette = useCallback((focus: () => void) => {
    inlinePaletteRef.current = focus;
    return () => {
      if (inlinePaletteRef.current === focus) inlinePaletteRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
      return;
    }
    if (inlinePaletteRef.current) {
      inlinePaletteRef.current();
      return;
    }
    open();
  }, [isOpen, open, close]);

  // Global keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is not logged in
      if (!signedIn) return;

      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      const isMac = getIsMac();
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
  }, [signedIn, isOpen, toggle, close]);

  // Publish the palette to the host's `commandBar()` answer, which is built
  // above this provider and so cannot read its context. See
  // `behavior/command-bar-control`.
  useEffect(() => registerCommandBarControl({ open, close, toggle }), [open, close, toggle]);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
      registerInlinePalette,
    }),
    [isOpen, open, close, toggle, query, registerInlinePalette],
  );

  const pathname = host.pathname();

  return (
    <CommandBarContext.Provider value={value}>
      {children}
      {/* Only render command bar if user is logged in AND not in /admin or /onboarding pages */}
      {signedIn && !pathname.match(/^\/(admin|onboarding)(\/|$)/) && <CommandBar />}
    </CommandBarContext.Provider>
  );
}
