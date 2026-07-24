import { Button } from "@chakra-ui/react";
import { useEffect } from "react";
import { RotateCcw, RotateCw } from "react-feather";
import { useLoadWorkflow } from "../hooks/useLoadWorkflow";
import { _useWorkflowStore } from "../hooks/useWorkflowStore";

export function UndoRedo() {
  const { undo, redo, pastStates, futureStates, clear, pause, resume } =
    _useWorkflowStore.temporal.getState();

  const { workflow } = useLoadWorkflow();

  useEffect(() => {
    const handleUndoRedoKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.userAgent.includes("Mac");

      if (
        (event.metaKey && event.shiftKey && event.key === "z") ||
        (event.ctrlKey && event.key === "y")
      ) {
        redo();
      } else if (
        (isMac && event.metaKey && !event.shiftKey && event.key === "z") ||
        (!isMac && event.ctrlKey && event.key === "z")
      ) {
        undo();
      }
    };

    window.addEventListener("keydown", handleUndoRedoKeyDown);
    return () => {
      window.removeEventListener("keydown", handleUndoRedoKeyDown);
    };
  }, [undo, redo]);

  // Fix for initial state
  useEffect(() => {
    if (workflow.isFetched) {
      setTimeout(() => {
        resume();
        clear();
      }, 1000);
    } else {
      pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.isFetched]);

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
