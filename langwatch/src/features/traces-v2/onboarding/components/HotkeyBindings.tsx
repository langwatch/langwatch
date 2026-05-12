import { useEffect } from "react";

interface HotkeyBindingsProps {
  drawerOpen: boolean;
  integrateKey: string;
  skipKey: string;
  onIntegrate: () => void;
  onSkip: () => void;
}

/**
 * Single global keydown listener for the empty-state journey. Two
 * shortcuts: `integrateKey` opens the IntegrateDrawer, `skipKey`
 * dismisses the card. Gated on `!drawerOpen` so the drawer's own
 * S/M/P/I tab letters can claim the keyboard once the user is in the
 * integrate flow. Renders nothing — it's an event-binding component.
 */
export function HotkeyBindings({
  drawerOpen,
  integrateKey,
  skipKey,
  onIntegrate,
  onSkip,
}: HotkeyBindingsProps): null {
  useEffect(() => {
    if (drawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === skipKey.toLowerCase()) {
        e.preventDefault();
        onSkip();
        return;
      }
      if (key === integrateKey.toLowerCase()) {
        e.preventDefault();
        onIntegrate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawerOpen, integrateKey, skipKey, onIntegrate, onSkip]);
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return true;
  return t.isContentEditable;
}
