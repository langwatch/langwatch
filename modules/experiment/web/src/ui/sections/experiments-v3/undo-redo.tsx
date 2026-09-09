import { HStack, IconButton } from "@chakra-ui/react";
import { Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  performRedo,
  performUndo,
  useEvaluationsV3Store,
} from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";

/** Which history step a keystroke asks for, or null when it asks for none. */
function historyShortcutOf(event: KeyboardEvent): "undo" | "redo" | null {
  // Check if we're in an input/textarea - don't intercept there
  const target = event.target as HTMLElement;
  const isTextEntry =
    target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  if (isTextEntry) return null;

  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? event.metaKey : event.ctrlKey;
  if (!modKey) return null;

  if (event.key === "z") return event.shiftKey ? "redo" : "undo";
  // Ctrl+Y for redo on Windows/Linux
  if (event.key === "y" && !isMac) return "redo";

  return null;
}

/**
 * UndoRedo component with keyboard shortcuts.
 * Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo.
 */
export function UndoRedo() {
  const temporal = useEvaluationsV3Store.temporal;

  // Subscribe to temporal state for reactivity using useSyncExternalStore
  const pastStatesLength = useSyncExternalStore(
    temporal.subscribe,
    () => temporal.getState().pastStates.length,
    () => 0,
  );
  const futureStatesLength = useSyncExternalStore(
    temporal.subscribe,
    () => temporal.getState().futureStates.length,
    () => 0,
  );

  const canUndo = pastStatesLength > 0;
  const canRedo = futureStatesLength > 0;

  const handleUndo = useCallback(() => {
    performUndo();
  }, []);

  const handleRedo = useCallback(() => {
    performRedo();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const step = historyShortcutOf(e);
      if (!step) return;

      e.preventDefault();
      if (step === "undo") handleUndo();
      if (step === "redo") handleRedo();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  return (
    <HStack gap={1}>
      <IconButton
        aria-label="Undo"
        title="Undo (Cmd+Z)"
        variant="ghost"
        size="sm"
        onClick={handleUndo}
        disabled={!canUndo}
        color={canUndo ? "fg.muted" : "fg.subtle"}
        _hover={canUndo ? { bg: "bg.subtle" } : {}}
      >
        <Undo2 size={18} />
      </IconButton>
      <IconButton
        aria-label="Redo"
        title="Redo (Cmd+Shift+Z)"
        variant="ghost"
        size="sm"
        onClick={handleRedo}
        disabled={!canRedo}
        color={canRedo ? "fg.muted" : "fg.subtle"}
        _hover={canRedo ? { bg: "bg.subtle" } : {}}
      >
        <Redo2 size={18} />
      </IconButton>
    </HStack>
  );
}
