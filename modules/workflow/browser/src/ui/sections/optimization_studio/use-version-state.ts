import { api as workflowApi } from "@langwatch/browser-trpc/workflow-api";
import { hasDSLChanged, type Project, studioWorkflowSchema } from "@langwatch/workflow-contract";
import { useEffect, useMemo } from "react";

import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";

function parseStudioDsl(dsl: unknown) {
  if (!dsl) return undefined;
  const parsed = studioWorkflowSchema.safeParse(dsl);
  return parsed.success ? parsed.data : undefined;
}

export const useVersionState = ({
  project,
  form,
  allowSaveIfAutoSaveIsCurrentButNotLatest = true,
}: {
  project?: Project;
  form?: { setValue(name: "version", value: string): void };
  allowSaveIfAutoSaveIsCurrentButNotLatest?: boolean;
}) => {
  const { workflowId, getWorkflow, autosavedWorkflow } = useWorkflowStore(
    ({ workflow_id: workflowId, version, getWorkflow, autosavedWorkflow }) => ({
      workflowId,
      version,
      getWorkflow,
      autosavedWorkflow,
    }),
  );

  const versions = workflowApi.workflow.getVersions.useQuery(
    {
      projectId: project?.id ?? "",
      workflowId: workflowId ?? "",
      returnDSL: "previousVersion",
    },
    { enabled: !!project?.id && !!workflowId },
  );
  const currentVersion = versions.data?.find((version) => version.isCurrentVersion);
  const previousVersion = versions.data?.find((version) => version.isPreviousVersion);
  const latestVersion = versions.data?.find((version) => version.isLatestVersion);
  /**
   * `getVersions` publishes the open `WorkflowDsl` envelope; parse it once
   * here into the typed Studio refinement the diff and autogen both need.
   */
  const previousVersionDsl = useMemo(
    () => parseStudioDsl(previousVersion?.dsl),
    [previousVersion?.dsl],
  );
  const hasChanges = autosavedWorkflow
    ? hasDSLChanged(getWorkflow(), autosavedWorkflow, false)
    : false;

  const canSaveNewVersion =
    hasChanges ||
    !!latestVersion?.autoSaved ||
    (allowSaveIfAutoSaveIsCurrentButNotLatest && !!currentVersion?.autoSaved);

  const [versionMajor] = latestVersion?.version.split(".") ?? ["0"];
  const nextVersion = useMemo(() => {
    return latestVersion?.autoSaved
      ? latestVersion.version
      : `${parseInt(versionMajor ?? "0") + 1}`;
  }, [latestVersion?.autoSaved, latestVersion?.version, versionMajor]);

  const versionToBeEvaluated = useMemo(() => {
    if (canSaveNewVersion) return { id: "", version: nextVersion, commitMessage: "" };
    const evaluated = currentVersion?.autoSaved ? currentVersion.parent : currentVersion;
    return {
      id: evaluated?.id,
      version: evaluated?.version,
      commitMessage: evaluated?.commitMessage,
    };
  }, [canSaveNewVersion, currentVersion, nextVersion]);

  useEffect(() => {
    if (form) {
      form.setValue("version", nextVersion);
    }
  }, [nextVersion, form]);

  return {
    versions,
    currentVersion,
    previousVersion,
    previousVersionDsl,
    latestVersion,
    hasChanges,
    canSaveNewVersion,
    nextVersion,
    versionToBeEvaluated,
  };
};
