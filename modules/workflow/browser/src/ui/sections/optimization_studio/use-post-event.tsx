import {
  describeError,
  showErrorToast,
  isHandledByGlobalHandler,
} from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { createLogger } from "@langwatch/observability/browser";
import { nowInstant } from "@langwatch/time";
import type {
  BaseComponent,
  StudioClientEvent,
  StudioServerEvent,
} from "@langwatch/workflow-contract";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useOrganizationTeamProject } from "../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { type WorkflowStore } from "../../../behavior/workflow-store.ts";
import { fetchSSE } from "../../../model/sse/fetch-sse.ts";
import {
  type CodedExecutionFailure,
  explainExecutionStateError,
  reportableExecutionFailure,
} from "./execution-state-error.ts";

const logger = createLogger("langwatch:wizard:usePostEvent");
let pythonDisconnectedTimeout: NodeJS.Timeout | null = null;

/** The engine's code for "somebody pressed stop", not a failure. */
const STOP_ERROR_TYPE = "context_canceled";

/**
 * Whether a failed state is really a cancellation, checked by code first
 * since prose alone would toast a red error for pressing Stop.
 */
function isDeliberateStop(failure: CodedExecutionFailure | undefined): boolean {
  if (failure?.error_type === STOP_ERROR_TYPE) return true;
  const raw = failure?.error?.toLowerCase() ?? "";
  return raw.includes("stopped") || raw.includes("interrupted");
}

export const PostEventProvider = ({ children }: { children: React.ReactNode }) => {
  const { project } = useOrganizationTeamProject();
  const { setSocketStatus, socketStatus } = useWorkflowStore(
    useShallow((state) => ({
      setSocketStatus: state.setSocketStatus,
      socketStatus: state.socketStatus,
    })),
  );
  const { postEvent } = usePostEvent();

  useEffect(() => {
    if (!project) return;

    const pythonReconnect = () => {
      pythonDisconnectedTimeout = setTimeout(() => {
        setSocketStatus("connecting-python");
      }, 10_000);
    };

    const isAlive = () => {
      postEvent({ type: "is_alive", payload: {} });
      if (socketStatus === "connected" && !pythonDisconnectedTimeout) {
        pythonReconnect();
      }
    };

    const interval = setInterval(isAlive, socketStatus === "connecting-python" ? 5_000 : 30_000);

    // Make the first call
    if (socketStatus === "disconnected") {
      isAlive();
      setSocketStatus("connecting-python");
    }

    return () => {
      clearInterval(interval);
    };
  }, [postEvent, project, setSocketStatus, socketStatus]);

  return <>{children}</>;
};

export const usePostEvent = () => {
  const { project } = useOrganizationTeamProject();
  const workflowStore = useWorkflowStore();
  const { socketStatus, setEvaluationState, setComponentExecutionState } = useWorkflowStore(
    useShallow((state) => ({
      socketStatus: state.socketStatus,
      setEvaluationState: state.setEvaluationState,
      setComponentExecutionState: state.setComponentExecutionState,
    })),
  );

  const handleServerMessage = useHandleServerMessage({
    workflowStore,
    alertOnComponent: () => void 0,
  });

  const [isLoading, setIsLoading] = useState(false);

  const postEvent = useCallback(
    (event: StudioClientEvent) => {
      if (!project) return;

      setIsLoading(true);

      const onError = (error: Error) => {
        // showErrorToast suppresses the duplicate toast on its own, but the
        // state writes below must be skipped too: a license-limit rejection
        // opens the upgrade modal, and flipping the studio into an error
        // state behind it is not what the user is looking at.
        if (isHandledByGlobalHandler(error)) return;

        showErrorToast({
          error,
          fallbackTitle: "Couldn't run this workflow",
        });

        // Update evaluation state if relevant
        if (event.type === "execute_evaluation") {
          setEvaluationState({
            status: "error",
            run_id: undefined,
            error: describeError({
              error,
              fallbackTitle: "Couldn't run this workflow",
            }),
            timestamps: { finished_at: nowInstant().epochMilliseconds },
          });
        }

        if (event.type === "execute_component") {
          setComponentExecutionState(event.payload.node_id, {
            status: "error",
            error: describeError({
              error,
              fallbackTitle: "Couldn't run this workflow",
            }),
            timestamps: { finished_at: nowInstant().epochMilliseconds },
          });
        }
      };

      fetchSSE<StudioServerEvent>({
        endpoint: "/api/workflows/post_event",
        payload: { projectId: project.id, event },
        timeout: 20000,

        // Process each event
        onEvent: (serverEvent) => {
          // Log the event
          logger.debug({ serverEvent, event }, "received message");

          // Handle the event with the workflow store
          handleServerMessage(serverEvent);

          // Handle evaluation errors
          if (serverEvent.type === "error" && event.type === "execute_evaluation") {
            setEvaluationState({
              status: "error",
              run_id: undefined,
              error: serverEvent.payload.message,
              timestamps: { finished_at: nowInstant().epochMilliseconds },
            });
          }
        },

        // Stop processing on error
        shouldStopProcessing: (serverEvent) => {
          return serverEvent.type === "error";
        },

        // Handle stream errors
        onError,
      })
        .finally(() => {
          setIsLoading(false);
        })
        .catch(onError);
    },
    [handleServerMessage, project, setEvaluationState, setComponentExecutionState],
  );

  return { postEvent, isLoading, socketStatus };
};

type AlertOnComponent = ({
  componentId,
  execution_state,
}: {
  componentId: string;
  execution_state: BaseComponent["execution_state"];
}) => void;

export const useHandleServerMessage = ({
  workflowStore,
  alertOnComponent,
}: {
  workflowStore: WorkflowStore;
  alertOnComponent: AlertOnComponent;
}) =>
  useCallback(
    (message: StudioServerEvent) =>
      applyServerMessage({ message, workflowStore, alertOnComponent }),
    [workflowStore, alertOnComponent],
  );

/**
 * Reports a failed run (ADR-045); a deliberate STOP keeps the local
 * `info` explainer instead of "we've been notified".
 */
function alertOnError({
  failure,
  fallbackTitle,
}: {
  failure: CodedExecutionFailure | undefined;
  fallbackTitle?: string;
}) {
  const explanation = explainExecutionStateError({ state: failure, fallbackTitle });
  const wasStopped = isDeliberateStop(failure);

  // Keyed by what the toast SAYS, so a repeating failure updates one toast;
  // a registered code keys on the code so it never collapses onto another.
  const dedupeId = `studio-${wasStopped ? "stopped" : "error"}-${
    explanation.isRegistered ? failure?.error_type : explanation.title
  }`;

  if (wasStopped) {
    toaster.create({
      id: dedupeId,
      title: "Stopped",
      // Only registered copy has anything to add to a deliberate stop.
      description: explanation.isRegistered ? explanation.description || undefined : undefined,
      type: "info",
      duration: 3000,
    });
    return;
  }
  toaster.create({
    id: dedupeId,
    error: reportableExecutionFailure(failure),
    title: explanation.title,
    type: "error",
    duration: 5000,
  });
}

type ServerMessageContext<Type extends StudioServerEvent["type"]> = {
  message: Extract<StudioServerEvent, { type: Type }>;
  workflowStore: WorkflowStore;
  alertOnComponent: AlertOnComponent;
};

function applyServerMessage({
  message,
  workflowStore,
  alertOnComponent,
}: ServerMessageContext<StudioServerEvent["type"]>) {
  switch (message.type) {
    case "is_alive_response":
      markPythonAlive(workflowStore);
      break;
    case "component_state_change":
      applyComponentStateChange({ message, workflowStore, alertOnComponent });
      break;
    case "execution_state_change":
      applyExecutionStateChange({ message, workflowStore, alertOnComponent });
      break;
    case "evaluation_state_change":
    case "evaluation_run_change":
      applyEvaluationChange({ message, workflowStore, alertOnComponent });
      break;
    case "optimization_state_change":
      applyOptimizationChange({ message, workflowStore, alertOnComponent });
      break;
    case "error":
      applyServerError({ message, workflowStore, alertOnComponent });
      break;
    case "debug":
      break;
    case "done":
      logger.debug("stream completed (done event received)");
      break;
    default:
      toaster.create({
        title: "Unknown message type on client",
        //@ts-expect-error: exhaustive switch; message is never in default
        description: message.type,
        type: "warning",
        duration: 5000,
      });
      break;
  }
}

function markPythonAlive(workflowStore: WorkflowStore) {
  if (pythonDisconnectedTimeout) {
    clearTimeout(pythonDisconnectedTimeout);
    pythonDisconnectedTimeout = null;
  }
  logger.debug("python is alive, setting status to connected");
  workflowStore.setSocketStatus("connected");
}

function applyComponentStateChange({
  message,
  workflowStore,
  alertOnComponent,
}: ServerMessageContext<"component_state_change">) {
  const { component_id: componentId, execution_state } = message.payload;
  logger.debug({ componentId, status: execution_state?.status }, "component_state_change received");
  workflowStore.setComponentExecutionState(componentId, execution_state);
  if (execution_state?.status !== "error") return;
  workflowStore.checkIfUnreachableErrorMessage(execution_state.error);
  alertOnComponent({ componentId, execution_state });
}

function focusNode(workflowStore: WorkflowStore, nodeId: string | undefined) {
  if (!nodeId) return;
  workflowStore.setSelectedNode(nodeId);
  workflowStore.setPropertiesExpanded(true);
}

function applyExecutionStateChange({
  message,
  workflowStore,
}: ServerMessageContext<"execution_state_change">) {
  const executionState = message.payload.execution_state;
  logger.debug({ status: executionState?.status }, "execution_state_change received");
  // The event allows the state to be absent; there is nothing to apply then.
  if (executionState) workflowStore.setWorkflowExecutionState(executionState);

  // A successful "Run workflow until here" selects its target so the result shows.
  if (executionState?.status === "success") {
    focusNode(workflowStore, workflowStore.getWorkflow().state.execution?.until_node_id);
  }
  if (executionState?.status !== "error") return;

  // Surface the node that actually failed, falling back to the run target.
  const workflow = workflowStore.getWorkflow();
  const failedNode = workflow.nodes.find((node) => node.data.execution_state?.status === "error");
  focusNode(workflowStore, failedNode?.id ?? workflow.state.execution?.until_node_id);
  alertOnError({ failure: executionState, fallbackTitle: "This run didn't finish" });
  // The whole coded failure, so every node still running is marked with a named code.
  workflowStore.stopWorkflowIfRunning(executionState);
}

function openResultsPanelLater(
  workflowStore: WorkflowStore,
  panel: Parameters<WorkflowStore["setOpenResultsPanelRequest"]>[0],
) {
  setTimeout(() => {
    workflowStore.setOpenResultsPanelRequest(panel);
  }, 500);
}

function applyEvaluationChange({
  message,
  workflowStore,
}: ServerMessageContext<"evaluation_state_change" | "evaluation_run_change">) {
  const evaluationState =
    message.type === "evaluation_state_change"
      ? message.payload.evaluation_state
      : message.payload.evaluation_run;
  logger.debug(
    { status: evaluationState?.status, progress: evaluationState?.progress },
    `${message.type} received`,
  );
  const currentEvaluationState = workflowStore.getWorkflow().state.evaluation;
  workflowStore.setEvaluationState(evaluationState);
  if (evaluationState?.status !== "error") return;
  alertOnError({ failure: evaluationState, fallbackTitle: "This run didn't finish" });
  if (currentEvaluationState?.status !== "waiting") {
    openResultsPanelLater(workflowStore, "evaluations");
  }
}

function applyOptimizationChange({
  message,
  workflowStore,
}: ServerMessageContext<"optimization_state_change">) {
  const currentOptimizationState = workflowStore.getWorkflow().state.optimization;
  const optimizationState = message.payload.optimization_state;
  workflowStore.setOptimizationState(optimizationState);
  if (optimizationState?.status !== "error") return;
  alertOnError({ failure: optimizationState, fallbackTitle: "This run didn't finish" });
  if (currentOptimizationState?.status !== "waiting") {
    openResultsPanelLater(workflowStore, "optimizations");
  }
}

function applyServerError({ message, workflowStore }: ServerMessageContext<"error">) {
  logger.error({ message: message.payload.message }, "error event received from server");
  workflowStore.checkIfUnreachableErrorMessage(message.payload.message);
  workflowStore.stopWorkflowIfRunning({ error: message.payload.message });
  // The `error` frame carries no code, so it presents as the generic unknown
  // state; the message rides along only so a deliberate stop reads "Stopped".
  alertOnError({
    failure: { error: message.payload.message },
    fallbackTitle: "This run didn't finish",
  });
}
