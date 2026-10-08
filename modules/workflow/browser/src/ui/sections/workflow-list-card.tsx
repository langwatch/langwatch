/**
 * One workflow on the list, with the four things its menu offers.
 */

import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { type WorkflowCardBase, WorkflowCardDisplay } from "@langwatch/design-system/workflow-card";
import { toEpochMs } from "@langwatch/time";
import type { WorkflowCascadeArchive, WorkflowRelatedEntities } from "@langwatch/workflow-contract";
import { useCallback, useState, type ComponentProps, type ReactNode } from "react";

import { useWorkflowArchivePreview } from "../../behavior/use-workflow-archive-preview.ts";
import { workflowApi, type WorkflowListRow } from "../../behavior/workflow-api.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";
import { WorkflowCascadeArchiveDialog } from "../blocks/workflow-cascade-archive-dialog.tsx";
import { WorkflowCardActions } from "../elements/workflow-card.tsx";
import { WorkflowPushToCopiesDialog } from "./workflow-push-to-copies-dialog.tsx";
import { WorkflowReplicateDialog } from "./workflow-replicate-dialog.tsx";

export function WorkflowListCard({
  workflowId,
  workflows,
  name,
  icon,
  description,
  children,
  ...props
}: {
  workflowId?: string;
  /** The list this card belongs to, so lineage is read once for the page. */
  workflows?: readonly WorkflowListRow[];
  name: string;
  icon: ReactNode;
  description?: string;
  children?: ReactNode;
} & ComponentProps<typeof WorkflowCardBase>) {
  const host = useWorkflowHost();
  const { projectId } = host.scope();
  const utils = workflowApi.useUtils();

  const archiveWorkflow = workflowApi.workflow.archive.useMutation();
  const cascadeArchiveWorkflow = workflowApi.workflow.cascadeArchive.useMutation();
  const syncFromSource = workflowApi.workflow.syncFromSource.useMutation();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isPushToCopiesDialogOpen, setIsPushToCopiesDialogOpen] = useState(false);

  const relatedEntitiesQuery = useWorkflowArchivePreview({
    workflowId,
    projectId,
    enabled: isDeleteDialogOpen,
  });

  const workflow = workflowId
    ? workflows?.find((candidate) => candidate.id === workflowId)
    : undefined;
  const { isCopiedWorkflow, hasCopies, sourceProjectPath } = readLineage(workflow);

  const onSyncFromSource = useCallback(() => {
    if (!workflowId || !projectId) return;

    syncFromSource.mutate(
      { workflowId, projectId },
      {
        onSuccess: () => {
          void utils.workflow.getAll.invalidate();
          host.succeeded({
            title: "Workflow updated",
            description: `Workflow "${name}" has been updated from source.`,
          });
        },
        onError: (error) =>
          host.failed({ error, fallbackTitle: "Couldn't update workflow from source" }),
      },
    );
  }, [syncFromSource, workflowId, projectId, utils, host, name]);

  const onArchiveWorkflow = useCallback(() => {
    if (!workflowId || !projectId) return;

    const hasRelated =
      (relatedEntitiesQuery.data?.evaluators.length ?? 0) > 0 ||
      (relatedEntitiesQuery.data?.agents.length ?? 0) > 0;

    if (hasRelated) {
      cascadeArchiveWorkflow.mutate(
        { workflowId, projectId },
        {
          onSuccess: (result) => {
            setIsDeleteDialogOpen(false);
            void utils.workflow.getAll.invalidate();
            const parts = describeCascadeArchive({ result, related: relatedEntitiesQuery.data });
            host.succeeded({
              title: `Workflow "${name}" deleted`,
              ...(parts.length > 0 ? { description: `Also deleted: ${parts.join(", ")}` } : {}),
            });
          },
          onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete workflow" }),
        },
      );
      return;
    }

    archiveWorkflow.mutate(
      { workflowId, projectId },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false);
          void utils.workflow.getAll.invalidate();
          host.succeeded({ title: `Workflow "${name}" deleted` });
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete workflow" }),
      },
    );
  }, [
    archiveWorkflow,
    cascadeArchiveWorkflow,
    host,
    name,
    projectId,
    relatedEntitiesQuery.data,
    utils,
    workflowId,
  ]);

  return (
    <>
      <WorkflowCardDisplay
        {...props}
        name={name}
        icon={icon}
        {...(description ? { description } : {})}
        updatedAtLabel={formatTimeAgo(workflow?.updatedAt ? toEpochMs(workflow.updatedAt) : 0)}
        action={
          workflowId ? (
            <WorkflowCardActions
              isCopy={isCopiedWorkflow}
              hasCopies={hasCopies}
              {...(sourceProjectPath ? { sourceProjectPath } : {})}
              onSyncFromSource={onSyncFromSource}
              onPushToCopies={() => setIsPushToCopiesDialogOpen(true)}
              onCopy={() => setIsCopyDialogOpen(true)}
              onDelete={() => setIsDeleteDialogOpen(true)}
            />
          ) : undefined
        }
      >
        {children}
      </WorkflowCardDisplay>

      <WorkflowCascadeArchiveDialog
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={onArchiveWorkflow}
        isLoading={cascadeArchiveWorkflow.isPending || archiveWorkflow.isPending}
        isLoadingRelated={relatedEntitiesQuery.isLoading}
        entityType="workflow"
        entityName={name}
        relatedEntities={relatedEntitiesQuery.data ?? {}}
      />

      {workflowId && (
        <WorkflowReplicateDialog
          open={isCopyDialogOpen}
          onClose={() => setIsCopyDialogOpen(false)}
          workflowId={workflowId}
          workflowName={name}
        />
      )}
      {workflowId && (
        <WorkflowPushToCopiesDialog
          open={isPushToCopiesDialogOpen}
          onClose={() => setIsPushToCopiesDialogOpen(false)}
          workflowId={workflowId}
          workflowName={name}
        />
      )}
    </>
  );
}

function readLineage(workflow: WorkflowListRow | undefined) {
  const source = workflow?.copiedFrom?.project;
  return {
    isCopiedWorkflow: !!workflow?.copiedFromWorkflowId,
    hasCopies: (workflow?._count?.copiedWorkflows ?? 0) > 0,
    sourceProjectPath: source
      ? `${source.team.organization.name} / ${source.team.name} / ${source.name}`
      : undefined,
  };
}

function countLabel(count: number, noun: string): string[] {
  return count > 0 ? [`${count} ${noun}${count > 1 ? "s" : ""}`] : [];
}

/** Evaluators and their monitors go after a lag, so the preview the reader confirmed names them. */
function describeCascadeArchive({
  result,
  related,
}: {
  result: Pick<WorkflowCascadeArchive, "archivedAgentsCount">;
  related:
    | (Pick<WorkflowRelatedEntities, "monitors"> & { evaluators: readonly { id: string }[] })
    | undefined;
}): string[] {
  return [
    ...countLabel(related?.evaluators.length ?? 0, "evaluator"),
    ...countLabel(result.archivedAgentsCount, "agent"),
    ...countLabel(related?.monitors.length ?? 0, "online evaluation"),
  ];
}
