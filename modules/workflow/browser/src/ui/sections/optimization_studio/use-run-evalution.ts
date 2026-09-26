import { toaster } from "@langwatch/browser-host/toaster";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { createLogger } from "@langwatch/observability/browser";
import { nowInstant } from "@langwatch/time";
import type { StudioClientEvent, StudioWorkflow } from "@langwatch/workflow-contract";
import {
  generateWorkflowRunId,
  hasDSLChanged,
  mergeLocalConfigsIntoDsl,
} from "@langwatch/workflow-contract";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";

import { useOrganizationTeamProject } from "../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { serializeWorkflow, type WorkflowStore } from "../../../behavior/workflow-store.ts";
import { usePostEvent } from "./use-post-event.tsx";
import { useVersionState } from "./use-version-state.ts";

const logger = createLogger("langwatch:studio:evaluation");

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
    })),
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

  const { previousVersion, previousVersionDsl, nextVersion, latestVersion } = useVersionState({
    project,
    form: form,
    allowSaveIfAutoSaveIsCurrentButNotLatest: true,
  });

  const generateCommitMessage = api.workflow.generateCommitMessage.useMutation();

  // Cascade-resolved Fast model for commit-message autogen: null when
  // nothing is configured at any scope. Gates the generation call so a
  // missing model never auto-fires a doomed request (and its
  // missing-model toast) from a background autosave.
  const resolvedCommitMessageModel = api.modelProvider.getResolvedDefault.useQuery(
    {
      projectId: project?.id ?? "",
      featureKey: "workflows.commit_message",
    },
    { enabled: !!project?.id },
  );

  const trpc = api.useUtils();

  const [triggerTimeout, setTriggerTimeout] = useState<EvaluationTimeoutTrigger | null>(null);

  useEffect(() => {
    if (!triggerTimeout) return;
    reportEvaluationTimeout({
      triggerTimeout,
      evaluation: getWorkflow().state.evaluation,
      setEvaluationState,
    });
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
        });
        return;
      }

      const run_id = generateWorkflowRunId();
      const workflow = getWorkflow();
      logger.info(
        { run_id, workflowId, evaluate_on: evaluate_on ?? "full" },
        "evaluation starting",
      );

      const plan = planEvaluationVersion({
        workflow,
        latestVersion,
        previousVersion,
        previousVersionDsl,
        requestedVersionId: workflow_version_id,
      });
      let versionId = plan.versionId;
      if (plan.mustCommit) {
        const outcome = await commitForEvaluation({
          isFirstVersion: !previousVersion,
          previousVersionDsl,
          canGenerateMessage: resolvedCommitMessageModel.data != null,
          generateMessage: (prevDsl) =>
            generateCommitMessage.mutateAsync({
              projectId: project.id,
              prevDsl,
              newDsl: getWorkflow(),
            }),
          commit: (commitMessage) =>
            commitVersion.mutateAsync({
              projectId: project.id,
              workflowId,
              commitMessage,
              dsl: serializeWorkflow({ ...workflow, version: nextVersion }),
            }),
        });
        if (!outcome.ok) return;
        versionId = outcome.versionId;
        logger.info({ version: nextVersion, versionId }, "evaluation: auto-committed new version");
        setWorkflow({ version: nextVersion });
        void trpc.workflow.getVersions.invalidate();
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
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          // TODO: autosave and generate a new commit message and version id automatically
          workflow_version_id: versionId ?? "",
          evaluate_on: evaluate_on ?? "full",
          dataset_entry,
          origin: "evaluation",
        },
      };
      postEvent(payload);
    },
    [
      project,
      getWorkflow,
      latestVersion,
      previousVersion,
      previousVersionDsl,
      setEvaluationState,
      postEvent,
      generateCommitMessage,
      resolvedCommitMessageModel.data,
      commitVersion,
      nextVersion,
      setWorkflow,
      trpc.workflow.getVersions,
    ],
  );

  const stopEvaluation = useCallback(
    ({ run_id }: { run_id: string }) => {
      logger.info({ run_id }, "evaluation stopping");
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
        payload: {
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          run_id,
        },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({
          run_id,
          timeout_on_status: "running",
        });
      }, 10_000);
    },
    [setEvaluationState, getWorkflow, setTriggerTimeout, postEvent],
  );

  return {
    runEvaluation,
    stopEvaluation,
    isLoading: isLoading || generateCommitMessage.isPending || commitVersion.isPending,
  };
};

/** Autogen is cosmetic sugar over the fallback; a failure never reads as the run failing. */
async function resolveCommitMessage({
  fallback,
  generate,
}: {
  fallback: string;
  generate: (() => Promise<string>) | undefined;
}): Promise<string> {
  if (!generate) return fallback;
  try {
    return await generate();
  } catch (err) {
    logger.error({ error: err }, "evaluation: error auto-generating version description");
    return fallback;
  }
}

async function commitForEvaluation(
  input: Parameters<typeof commitChangedWorkflow>[0],
): Promise<{ ok: true; versionId: string } | { ok: false }> {
  try {
    return { ok: true, versionId: await commitChangedWorkflow(input) };
  } catch (err) {
    logger.error({ error: err }, "evaluation: error saving version");
    toaster.create({
      error: err,
      title: "Couldn't save the version",
      type: "error",
      duration: 5000,
    });
    return { ok: false };
  }
}

type VersionState = ReturnType<typeof useVersionState>;

/** An autosaved, changed DSL is committed first, unless the caller named a version. */
function planEvaluationVersion({
  workflow,
  latestVersion,
  previousVersion,
  previousVersionDsl,
  requestedVersionId,
}: Pick<VersionState, "latestVersion" | "previousVersion" | "previousVersionDsl"> & {
  workflow: StudioWorkflow;
  requestedVersionId: string | undefined;
}): { versionId: string | undefined; mustCommit: boolean } {
  const hasChanges =
    !!latestVersion?.autoSaved &&
    (previousVersionDsl ? hasDSLChanged(workflow, previousVersionDsl, false) : true);
  return {
    versionId:
      requestedVersionId ?? (latestVersion?.autoSaved ? previousVersion?.id : latestVersion?.id),
    mustCommit: hasChanges && !requestedVersionId,
  };
}

async function commitChangedWorkflow({
  isFirstVersion,
  previousVersionDsl,
  canGenerateMessage,
  generateMessage,
  commit,
}: {
  isFirstVersion: boolean;
  previousVersionDsl: StudioWorkflow | undefined;
  canGenerateMessage: boolean;
  generateMessage: (prevDsl: StudioWorkflow) => Promise<string>;
  commit: (commitMessage: string) => Promise<{ id: string }>;
}): Promise<string> {
  const commitMessage = await resolveCommitMessage({
    fallback: isFirstVersion ? "first version" : "autosaved",
    generate:
      previousVersionDsl && canGenerateMessage
        ? () => generateMessage(previousVersionDsl)
        : undefined,
  });
  return (await commit(commitMessage)).id;
}

type EvaluationTimeoutTrigger = {
  run_id: string;
  timeout_on_status: "waiting" | "running";
};

function reportEvaluationTimeout({
  triggerTimeout,
  evaluation,
  setEvaluationState,
}: {
  triggerTimeout: EvaluationTimeoutTrigger;
  evaluation: ReturnType<WorkflowStore["getWorkflow"]>["state"]["evaluation"];
  setEvaluationState: WorkflowStore["setEvaluationState"];
}) {
  const timedOutOnThisRun =
    evaluation?.run_id === triggerTimeout.run_id &&
    evaluation?.status === triggerTimeout.timeout_on_status;
  if (!timedOutOnThisRun) return;
  logger.warn(
    { run_id: triggerTimeout.run_id, timeout_on_status: triggerTimeout.timeout_on_status },
    "evaluation timeout triggered",
  );
  setEvaluationState({
    status: "error",
    error: "Timeout",
    timestamps: { finished_at: nowInstant().epochMilliseconds },
  });
  toaster.create({
    title: `Timeout ${
      triggerTimeout.timeout_on_status === "waiting" ? "starting" : "stopping"
    } evaluation execution`,
    type: "error",
    duration: 5000,
  });
}
