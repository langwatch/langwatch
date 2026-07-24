import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "~/utils/auth-client";
import { CommandBar } from "./CommandBar";
import { CommandBarContext } from "./CommandBarContext";
import { useActivityTracker } from "./useActivityTracker";
import { getIsMac } from "./utils/platform";
import { useRouter } from "~/utils/compat/next-navigation";
import { usePathname } from "~/utils/compat/next-navigation";

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
      if (!session) return;

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
  }, [session, isOpen, toggle, close]);

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
    [isOpen, open, close, toggle, query, registerInlinePalette]
  );

  const pathname = usePathname();

  return (
    <CommandBarContext.Provider value={value}>
      {children}
      {/* Only render command bar if user is logged in AND not in /admin or /onboarding pages */}
      {session && !pathname?.match(/^\/(admin|onboarding)(\/|$)/) && <CommandBar />}
    </CommandBarContext.Provider>
  );
}
