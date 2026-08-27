import { Button } from "@chakra-ui/react";
import { useEffect } from "react";
import { RotateCcw, RotateCw } from "react-feather";

import { _useWorkflowStore } from "./hooks/use-workflow-store";

/** Browser-only workflow history controls. The app owns when the workflow query is loaded. */
export function WorkflowUndoRedo({ isWorkflowLoaded }: { isWorkflowLoaded: boolean }) {
  const { undo, redo, pastStates, futureStates, clear, pause, resume } =
    _useWorkflowStore.temporal.getState();

  useEffect(() => {
    const handleUndoRedoKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.userAgent.includes("Mac");
      const shouldRedo =
        (event.metaKey && event.shiftKey && event.key === "z") ||
        (event.ctrlKey && event.key === "y");
      const shouldUndo =
        (isMac && event.metaKey && !event.shiftKey && event.key === "z") ||
        (!isMac && event.ctrlKey && event.key === "z");

      if (shouldRedo) {
        redo();
      } else if (shouldUndo) {
        undo();
      }
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
      <Button
        color="fg.muted"
        size="xs"
        variant="ghost"
        onClick={() => undo()}
        disabled={pastStates.length === 0}
      >
        <RotateCcw width="16px" />
      </Button>
      <Button
        color="fg.muted"
        size="xs"
        variant="ghost"
        onClick={() => redo()}
        disabled={futureStates.length === 0}
      >
        <RotateCw width="16px" />
      </Button>
    </>
  );
}
