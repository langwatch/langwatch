/**
 * One workflow on the list, with the four things its menu offers.
 *
 * A MOVE of `platform/app/src/optimization_studio/components/workflow/WorkflowCard.tsx`,
 * which was already an adapter over this package's own `WorkflowCardDisplay`
 * and `WorkflowCardActions`: what it added was the transport, the delete
 * cascade and the two copy dialogs. All of that is here now, unchanged in
 * behaviour.
 *
 * THE DELETE IS STILL TWO PATHS AND STILL DECIDES BY WHAT IT FINDS.
 * `getRelatedEntities` is read while the confirmation is open; a workflow with
 * linked evaluators or agents takes `cascadeArchive` and reports what went with
 * it, and one with neither takes the plain `archive`. Getting that backwards
 * would archive a project's evaluators without saying so, which is what the
 * confirmation exists to prevent.
 *
 * The toaster and the error toast are the host's. Every outcome — the sync, the
 * delete, both cascades — goes through `succeeded` / `failed`, so the
 * code-keyed presentation registry still decides the words a customer reads.
 */

import { useCallback, useState, type ComponentProps, type ReactNode } from "react";

import { workflowApi, type WorkflowListRow } from "../../behavior/workflow-api";
import { formatTimeAgo } from "../../model/format-time-ago";
import { useWorkflowHost } from "../../model/workflow-host";
import { WorkflowCardActions, WorkflowCardBase, WorkflowCardDisplay } from "../../workflow-card";
import { WorkflowCascadeArchiveDialog } from "../blocks/workflow-cascade-archive-dialog";
import { WorkflowPushToCopiesDialog } from "./workflow-push-to-copies-dialog";
import { WorkflowReplicateDialog } from "./workflow-replicate-dialog";

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

  const relatedEntitiesQuery = workflowApi.workflow.getRelatedEntities.useQuery(
    { workflowId: workflowId ?? "", projectId: projectId ?? "" },
    { enabled: isDeleteDialogOpen && !!workflowId && !!projectId },
  );

  const workflow = workflowId
    ? workflows?.find((candidate) => candidate.id === workflowId)
    : undefined;
  const isCopiedWorkflow = !!workflow?.copiedFromWorkflowId;
  const hasCopies = (workflow?._count?.copiedWorkflows ?? 0) > 0;

  const sourceProjectPath = workflow?.copiedFrom
    ? `${workflow.copiedFrom.project.team.organization.name} / ${workflow.copiedFrom.project.team.name} / ${workflow.copiedFrom.project.name}`
    : undefined;

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

            const parts: string[] = [];
            if (result.archivedEvaluatorsCount > 0) {
              parts.push(
                `${result.archivedEvaluatorsCount} evaluator${result.archivedEvaluatorsCount > 1 ? "s" : ""}`,
              );
            }
            if (result.archivedAgentsCount > 0) {
              parts.push(
                `${result.archivedAgentsCount} agent${result.archivedAgentsCount > 1 ? "s" : ""}`,
              );
            }
            if (result.deletedMonitorsCount > 0) {
              parts.push(
                `${result.deletedMonitorsCount} online evaluation${result.deletedMonitorsCount > 1 ? "s" : ""}`,
              );
            }

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
        updatedAtLabel={formatTimeAgo(workflow?.updatedAt ? new Date(workflow.updatedAt).getTime() : 0)}
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
        relatedEntities={{
          ...(relatedEntitiesQuery.data?.evaluators
            ? { evaluators: relatedEntitiesQuery.data.evaluators }
            : {}),
          ...(relatedEntitiesQuery.data?.agents
            ? { agents: relatedEntitiesQuery.data.agents }
            : {}),
          ...(relatedEntitiesQuery.data?.monitors
            ? { monitors: relatedEntitiesQuery.data.monitors }
            : {}),
        }}
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
