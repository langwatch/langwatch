import { createLogger } from "@langwatch/observability";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { describeError, showErrorToast } from "~/features/errors";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { BaseComponent } from "../types/dsl";
import type { StudioClientEvent, StudioServerEvent } from "../types/events";
import {
  type CodedExecutionFailure,
  explainExecutionStateError,
} from "../utils/executionStateError";
import { useWorkflowStore, type WorkflowStore } from "./useWorkflowStore";

const logger = createLogger("langwatch:wizard:usePostEvent");
let pythonDisconnectedTimeout: NodeJS.Timeout | null = null;

/** The engine's code for "somebody pressed stop", not a failure. */
const STOP_ERROR_TYPE = "context_canceled";

/**
 * Whether a failed state is really a cancellation.
 *
 * The code is asked first because it is the fact: the engine emits
 * `context_canceled` for a deliberate stop, and it matches neither of the
 * words the prose check looks for — so a user who pressed Stop got a red
 * "something went wrong" toast for doing exactly what they meant to.
 *
 * The prose check stays as the fallback for the frames that carry no code at
 * all (the stream's top-level `error`, the optimization runner).
 */
function isDeliberateStop(failure: CodedExecutionFailure | undefined): boolean {
  if (failure?.error_type === STOP_ERROR_TYPE) return true;
  const raw = failure?.error?.toLowerCase() ?? "";
  return raw.includes("stopped") || raw.includes("interrupted");
}

export const PostEventProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
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

    const interval = setInterval(
      isAlive,
      socketStatus === "connecting-python" ? 5_000 : 30_000,
    );

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
  const { socketStatus, setEvaluationState, setComponentExecutionState } =
    useWorkflowStore(
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
          fallbackTitle: "Couldn't reach the workflow engine",
        });

        // Update evaluation state if relevant
        if (event.type === "execute_evaluation") {
          setEvaluationState({
            status: "error",
            run_id: undefined,
            error: describeError({
              error,
              fallbackTitle: "Couldn't reach the workflow engine",
            }),
            timestamps: { finished_at: Date.now() },
          });
        }

        if (event.type === "execute_component") {
          setComponentExecutionState(event.payload.node_id, {
            status: "error",
            error: describeError({
              error,
              fallbackTitle: "Couldn't reach the workflow engine",
            }),
            timestamps: { finished_at: Date.now() },
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
          if (
            serverEvent.type === "error" &&
            event.type === "execute_evaluation"
          ) {
            setEvaluationState({
              status: "error",
              run_id: undefined,
              error: serverEvent.payload.message,
              timestamps: { finished_at: Date.now() },
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
        .catch(onError)
        .finally(() => {
          setIsLoading(false);
        });
    },
    [handleServerMessage, project, setEvaluationState],
  );

  return { postEvent, isLoading, socketStatus };
};

export const useHandleServerMessage = ({
  workflowStore,
  alertOnComponent,
}: {
  workflowStore: WorkflowStore;
  alertOnComponent: ({
    componentId,
    execution_state,
  }: {
    componentId: string;
    execution_state: BaseComponent["execution_state"];
  }) => void;
}) => {
  const {
    setSocketStatus,
    getWorkflow,
    setComponentExecutionState,
    setWorkflowExecutionState,
    setEvaluationState,
    setOptimizationState,
    checkIfUnreachableErrorMessage,
    stopWorkflowIfRunning,
    setOpenResultsPanelRequest,
  } = workflowStore;

  /**
   * Toasts a failed run.
   *
   * The words come from the state's `error_type` via the code-keyed registry
   * (ADR-045). A state with no code — or one whose code the registry has no
   * copy for — falls back to its raw message. See
   * `explainExecutionStateError`, which explains why saying "we've been
   * notified" there would be untrue.
   */
  const alertOnError = useCallback(
    (failure: CodedExecutionFailure | undefined) => {
      const explanation = explainExecutionStateError(failure);
      const wasStopped = isDeliberateStop(failure);

      // Keyed by what the toast actually SAYS, so a repeating failure (the
      // engine down while the studio retries) updates one toast instead of
      // stacking a wall of them — while two different failures stay two
      // toasts. Keying on `error_type` alone collapsed every uncoded failure
      // onto one id, so a second, different one would silently replace the
      // first — and that includes a code the registry doesn't know, which
      // presents from its raw message just like an uncoded one does.
      const dedupeId = `studio-${wasStopped ? "stopped" : "error"}-${
        explanation.isRegistered
          ? failure?.error_type
          : explanation.title + explanation.description
      }`;

      if (wasStopped) {
        toaster.create({
          id: dedupeId,
          title: "Stopped",
          // Only registered copy has anything to add here; the generic
          // "we've been notified" would be wrong for a deliberate stop.
          description: explanation.isRegistered
            ? explanation.description || undefined
            : undefined,
          type: "info",
          meta: {
            closable: true,
          },
          duration: 3000,
        });
      } else {
        toaster.create({
          id: dedupeId,
          title: explanation.title,
          description: explanation.description || undefined,
          type: "error",
          meta: {
            closable: true,
          },
          duration: 5000,
        });
      }
    },
    [],
  );

  return useCallback(
    (message: StudioServerEvent) => {
      switch (message.type) {
        case "is_alive_response":
          if (pythonDisconnectedTimeout) {
            clearTimeout(pythonDisconnectedTimeout);
            pythonDisconnectedTimeout = null;
          }
          logger.debug("python is alive, setting status to connected");
          setSocketStatus("connected");
          break;
        case "component_state_change":
          logger.debug(
            {
              componentId: message.payload.component_id,
              status: message.payload.execution_state?.status,
            },
            "component_state_change received",
          );
          setComponentExecutionState(
            message.payload.component_id,
            message.payload.execution_state,
          );

          if (message.payload.execution_state?.status === "error") {
            checkIfUnreachableErrorMessage(
              message.payload.execution_state.error,
            );
            alertOnComponent({
              componentId: message.payload.component_id,
              execution_state: message.payload.execution_state,
            });
          }

          break;
        case "execution_state_change":
          logger.debug(
            { status: message.payload.execution_state?.status },
            "execution_state_change received",
          );
          setWorkflowExecutionState(message.payload.execution_state);

          // Auto-select the target node and expand properties when a
          // "Run workflow until here" execution succeeds, so the user
          // can see the results without clicking manually.
          if (message.payload.execution_state?.status === "success") {
            const untilNodeId = getWorkflow().state.execution?.until_node_id;
            if (untilNodeId) {
              workflowStore.setSelectedNode(untilNodeId);
              workflowStore.setPropertiesExpanded(true);
            }
          }

          if (message.payload.execution_state?.status === "error") {
            // Surface the node that actually failed (e.g. an LLM with no
            // messages) instead of the run target, whose stale output would
            // otherwise hide the error. Fall back to the target when no
            // single node carries the error.
            const failedNode = getWorkflow().nodes.find(
              (node) => node.data.execution_state?.status === "error",
            );
            const focusNodeId =
              failedNode?.id ?? getWorkflow().state.execution?.until_node_id;
            if (focusNodeId) {
              workflowStore.setSelectedNode(focusNodeId);
              workflowStore.setPropertiesExpanded(true);
            }
            alertOnError(message.payload.execution_state);
            stopWorkflowIfRunning(message.payload.execution_state.error);
          }
          break;
        case "evaluation_state_change":
        case "evaluation_run_change": {
          const evaluationState =
            message.type === "evaluation_state_change"
              ? message.payload.evaluation_state
              : message.payload.evaluation_run;
          logger.debug(
            {
              status: evaluationState?.status,
              progress: evaluationState?.progress,
            },
            `${message.type} received`,
          );
          const currentEvaluationState = getWorkflow().state.evaluation;
          setEvaluationState(evaluationState);
          if (evaluationState?.status === "error") {
            alertOnError(evaluationState);
            if (currentEvaluationState?.status !== "waiting") {
              setTimeout(() => {
                setOpenResultsPanelRequest("evaluations");
              }, 500);
            }
          }
          break;
        }
        case "optimization_state_change":
          const currentOptimizationState = getWorkflow().state.optimization;
          setOptimizationState(message.payload.optimization_state);
          if (message.payload.optimization_state?.status === "error") {
            alertOnError(message.payload.optimization_state);
            if (currentOptimizationState?.status !== "waiting") {
              setTimeout(() => {
                setOpenResultsPanelRequest("optimizations");
              }, 500);
            }
          }
          break;
        case "error":
          logger.error(
            { message: message.payload.message },
            "error event received from server",
          );
          checkIfUnreachableErrorMessage(message.payload.message);
          stopWorkflowIfRunning(message.payload.message);
          // The stream's `error` frame carries no code (see StudioServerEvent),
          // so this presents as the generic unknown state — the message rides
          // along only so a deliberate stop still reads as "Stopped".
          alertOnError({ error: message.payload.message });
          break;
        case "debug":
          break;
        case "done":
          logger.debug("stream completed (done event received)");
          break;
        default:
          toaster.create({
            title: "Unknown message type on client",
            //@ts-expect-error
            description: message.type,
            type: "warning",
            meta: {
              closable: true,
            },
            duration: 5000,
          });
          break;
      }
    },
    [
      alertOnComponent,
      alertOnError,
      checkIfUnreachableErrorMessage,
      getWorkflow,
      setComponentExecutionState,
      setEvaluationState,
      setOpenResultsPanelRequest,
      setOptimizationState,
      setSocketStatus,
      setWorkflowExecutionState,
      stopWorkflowIfRunning,
    ],
  );
};
