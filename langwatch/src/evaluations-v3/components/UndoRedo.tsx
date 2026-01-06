import { HStack, IconButton } from "@chakra-ui/react";
import { Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  performRedo,
  performUndo,
  useEvaluationsV3Store,
} from "../hooks/useEvaluationsV3Store";

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
      // Check if we're in an input/textarea - don't intercept there
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (modKey && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (modKey && e.key === "y" && !isMac) {
        // Ctrl+Y for redo on Windows/Linux
        e.preventDefault();
        handleRedo();
      }
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
        color={canUndo ? "gray.600" : "gray.300"}
        _hover={canUndo ? { bg: "gray.100" } : {}}
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
        color={canRedo ? "gray.600" : "gray.300"}
        _hover={canRedo ? { bg: "gray.100" } : {}}
      >
        <Redo2 size={18} />
      </IconButton>
    </HStack>
  );
}
