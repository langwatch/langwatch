import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "./useWorkflowStore";
import { useEffect } from "react";

export const useAskBeforeLeaving = () => {
  const { evaluationStatus } = useWorkflowStore(
    useShallow((state) => {
      return {
        evaluationStatus: state.state.evaluation?.status,
      };
    })
  );

  useEffect(() => {
    let message = "";
    if (evaluationStatus === "running" || evaluationStatus === "waiting") {
      message = "An evaluation is running, are you sure you want to leave?";
    }
    if (!message) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [evaluationStatus]);
};
