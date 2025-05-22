import { toaster } from "../../components/ui/toaster";
import type { StudioClientEvent } from "../types/events";
import { useCallback, useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { usePostEvent } from "./usePostEvent";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../utils/api";
import { useForm } from "react-hook-form";
import { useVersionState } from "../components/History";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { hasDSLChanged } from "../utils/dslUtils";
import { useWorkflowStore } from "./useWorkflowStore";

/**
 * This is the non-socket version of the useEvaluationExecution hook.
 * It should work both in the wizard and in the optimization studio.
 */
export const useRunEvalution = () => {
  const { setEvaluationState, getWorkflow, setWorkflow } = useWorkflowStore(
    useShallow((state) => ({
      setEvaluationState: state.setEvaluationState,
      getWorkflow: state.getWorkflow,
      setWorkflow: state.setWorkflow,
    }))
  );

  const { postEvent, isLoading } = usePostEvent();

  const { project } = useOrganizationTeamProject();

  const commitVersion = api.workflow.commitVersion.useMutation();

  const form = useForm({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  const { previousVersion, nextVersion, latestVersion } = useVersionState({
    project,
    form: form,
    allowSaveIfAutoSaveIsCurrentButNotLatest: true,
  });

  const generateCommitMessage =
    api.workflow.generateCommitMessage.useMutation();

  const trpc = api.useContext();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    run_id: string;
    timeout_on_status: "waiting" | "running";
  } | null>(null);

  useEffect(() => {
    const workflow = getWorkflow();
    if (
      triggerTimeout &&
      workflow.state.evaluation?.run_id === triggerTimeout.run_id &&
      workflow.state.evaluation?.status === triggerTimeout.timeout_on_status
    ) {
      setEvaluationState({
        status: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      });
      toaster.create({
        title: `Timeout ${
          triggerTimeout.timeout_on_status === "waiting"
            ? "starting"
            : "stopping"
        } evaluation execution`,
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
    }
  }, [triggerTimeout, setEvaluationState, getWorkflow]);

  const runEvaluation = useCallback(
    async ({
      onStart,
      workflow_version_id,
      evaluate_on,
      dataset_entry,
    }: {
      onStart?: () => void;
      workflow_version_id?: string;
      evaluate_on?: "full" | "test" | "train" | "specific";
      dataset_entry?: number;
    } = {}) => {
      if (!project) return;

      const workflowId = getWorkflow().workflow_id;
      if (!workflowId) {
        toaster.create({
          title: "Error running evaluation: workflow not found",
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });
        return;
      }

      const run_id = `run_${nanoid()}`;
      const workflow = getWorkflow();
      const hasChanges =
        latestVersion?.autoSaved &&
        (previousVersion?.dsl
          ? hasDSLChanged(workflow, previousVersion.dsl, false)
          : true);

      let versionId =
        workflow_version_id ??
        (latestVersion?.autoSaved ? previousVersion?.id : latestVersion?.id);
      // Automatically generate a new version if there are changes and no version id was provided (e.g. when running from the wizard)
      if (hasChanges && !workflow_version_id) {
        let commitMessage = previousVersion ? "autosaved" : "first version";
        if (previousVersion?.dsl) {
          try {
            const commitMessageResponse =
              await generateCommitMessage.mutateAsync({
                projectId: project?.id ?? "",
                prevDsl: previousVersion?.dsl,
                newDsl: getWorkflow(),
              });
            commitMessage = commitMessageResponse ?? "autosaved";
          } catch (error) {
            toaster.create({
              title: "Error auto-generating version description",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          }
        }

        try {
          const versionResponse = await commitVersion.mutateAsync({
            projectId: project.id,
            workflowId,
            commitMessage,
            dsl: {
              ...workflow,
              version: nextVersion,
            },
          });
          versionId = versionResponse.id;

          setWorkflow({
            ...workflow,
            version: nextVersion,
          });

          void trpc.workflow.getVersions.invalidate();
        } catch (error) {
          toaster.create({
            title: "Error saving version",
            type: "error",
            duration: 5000,
            meta: { closable: true },
            placement: "top-end",
          });
          return;
        }
      }

      onStart?.();
      setEvaluationState({
        status: "waiting",
        run_id,
        progress: 0,
        total: 0,
      });

      const payload: StudioClientEvent = {
        type: "execute_evaluation",
        payload: {
          run_id,
          workflow,
          // TODO: autosave and generate a new commit message and version id automatically
          workflow_version_id: versionId ?? "",
          evaluate_on: evaluate_on ?? "full",
          dataset_entry,
        },
      };
      postEvent(payload);
    },
    [
      project,
      getWorkflow,
      latestVersion,
      previousVersion,
      setEvaluationState,
      postEvent,
      generateCommitMessage,
      commitVersion,
      nextVersion,
      setWorkflow,
      trpc.workflow.getVersions,
    ]
  );

  const stopEvaluation = useCallback(
    ({ run_id }: { run_id: string }) => {
      const workflow = getWorkflow();
      const current_state = workflow.state.evaluation?.status;
      if (current_state === "waiting") {
        setEvaluationState({
          status: "idle",
          run_id: undefined,
        });
        return;
      }

      const payload: StudioClientEvent = {
        type: "stop_evaluation_execution",
        payload: { workflow: workflow, run_id },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({
          run_id,
          timeout_on_status: "running",
        });
      }, 10_000);
    },
    [setEvaluationState]
  );

  return {
    runEvaluation,
    stopEvaluation,
    isLoading:
      isLoading || generateCommitMessage.isLoading || commitVersion.isLoading,
  };
};
