import { IconButton } from "@langwatch/design-system/primitives";
import { RotateCcw, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { _useWorkflowStore } from "../../behavior/use-workflow-store.ts";

/** Which history step a keystroke asks for, or null when it asks for none. */
function historyShortcutOf(event: KeyboardEvent): "undo" | "redo" | null {
  const isMac = navigator.userAgent.includes("Mac");
  const shouldRedo =
    (event.metaKey && event.shiftKey && event.key === "z") || (event.ctrlKey && event.key === "y");
  if (shouldRedo) return "redo";

  const shouldUndo =
    (isMac && event.metaKey && !event.shiftKey && event.key === "z") ||
    (!isMac && event.ctrlKey && event.key === "z");
  if (shouldUndo) return "undo";

  return null;
}

/** Browser-only workflow history controls. The app owns when the workflow query is loaded. */
export function WorkflowUndoRedo({ isWorkflowLoaded }: { isWorkflowLoaded: boolean }) {
  const { undo, redo, pastStates, futureStates, clear, pause, resume } =
    _useWorkflowStore.temporal.getState();

  useEffect(() => {
    const handleUndoRedoKeyDown = (event: KeyboardEvent) => {
      const step = historyShortcutOf(event);
      if (step === "redo") redo();
      if (step === "undo") undo();
    };

    window.addEventListener("keydown", handleUndoRedoKeyDown);
    return () => window.removeEventListener("keydown", handleUndoRedoKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    let resumeTimeout: ReturnType<typeof setTimeout> | undefined;

    if (isWorkflowLoaded) {
      resumeTimeout = setTimeout(() => {
        resume();
        clear();
      }, 1000);
    } else {
      pause();
    }

    return () => {
      if (resumeTimeout) {
        clearTimeout(resumeTimeout);
      }
    };
  }, [clear, isWorkflowLoaded, pause, resume]);

  return (
    <>
      <IconButton
        color="fg.muted"
        size="xs"
        variant="ghost"
        aria-label="Undo"
        onClick={() => undo()}
        disabled={pastStates.length === 0}
      >
        <RotateCcw size={16} />
      </IconButton>
      <IconButton
        color="fg.muted"
        size="xs"
        variant="ghost"
        aria-label="Redo"
        onClick={() => redo()}
        disabled={futureStates.length === 0}
      >
        <RotateCw size={16} />
      </IconButton>
    </>
  );
}
