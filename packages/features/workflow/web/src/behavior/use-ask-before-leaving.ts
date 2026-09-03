import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "./use-workflow-store";

export const useAskBeforeLeaving = () => {
  const { evaluationStatus, hasPendingChanges } = useWorkflowStore(
    useShallow((state) => {
      return {
        evaluationStatus: state.state.evaluation?.status,
        hasPendingChanges: state.hasPendingChanges,
      };
    }),
  );

  useEffect(() => {
    const message =
      evaluationStatus === "running" || evaluationStatus === "waiting"
        ? "An evaluation is running, are you sure you want to leave?"
        : undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const message_ = message
        ? message
        : hasPendingChanges()
          ? "Changes were not autosaved yet, are you sure you want to leave?"
          : undefined;
      if (message_) {
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
      // No warning to show: the handler returns nothing and the browser
      // navigates. Stated rather than fallen through, for `noImplicitReturns`.
      return undefined;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [evaluationStatus, hasPendingChanges]);
};
