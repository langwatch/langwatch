import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useState } from "react";
import { showErrorToast } from "~/features/errors";
import { CascadeArchiveDialog } from "../../../components/CascadeArchiveDialog";
import { toaster } from "../../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { AppRouter } from "../../../server/api/root";
import { api } from "../../../utils/api";
import { formatTimeAgo } from "../../../utils/formatTimeAgo";
import {
  WorkflowCardActions,
  WorkflowCardBase,
  WorkflowCardDisplay,
} from "@langwatch/workflow-web";
import { CopyWorkflowDialog } from "./CopyWorkflowDialog";
import { PushToCopiesDialog } from "./PushToCopiesDialog";

export function WorkflowCard({
  workflowId,
  query,
  name,
  icon,
  description,
  children,
  ...props
}: {
  workflowId?: string;
  query?: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["workflow"]["getAll"],
    TRPCClientErrorLike<AppRouter>
  >;
  name: string;
  icon: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
} & React.ComponentProps<typeof WorkflowCardBase>) {
  const { project } = useOrganizationTeamProject();
  const archiveWorkflow = api.workflow.archive.useMutation();
  const cascadeArchiveWorkflow = api.workflow.cascadeArchive.useMutation();
  const syncFromSource = api.workflow.syncFromSource.useMutation();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isPushToCopiesDialogOpen, setIsPushToCopiesDialogOpen] = useState(false);

  // Query related entities when delete dialog is open
  const relatedEntitiesQuery = api.workflow.getRelatedEntities.useQuery(
    { workflowId: workflowId ?? "", projectId: project?.id ?? "" },
    { enabled: isDeleteDialogOpen && !!workflowId && !!project?.id },
  );

  // Get the workflow data to check if it's a copy or has copies
  const workflow = workflowId ? query?.data?.find((w) => w.id === workflowId) : undefined;
  const isCopiedWorkflow = !!workflow?.copiedFromWorkflowId;
  const hasCopies = (workflow?._count?.copiedWorkflows ?? 0) > 0;

  // Get source project path for tooltip
  const sourceProjectPath = workflow?.copiedFrom
    ? `${workflow.copiedFrom.project.team.organization.name} / ${workflow.copiedFrom.project.team.name} / ${workflow.copiedFrom.project.name}`
    : undefined;

  const onSyncFromSource = useCallback(() => {
    if (!workflowId || !project) return;

    syncFromSource.mutate(
      { workflowId, projectId: project.id },
      {
        onSuccess: () => {
          void query?.refetch();
          toaster.create({
            title: "Workflow updated",
            description: `Workflow "${name}" has been updated from source.`,
            type: "success",
          });
        },
        onError: (error) =>
          showErrorToast({
            error,
            fallbackTitle: "Couldn't update workflow from source",
          }),
      },
    );
  }, [syncFromSource, workflowId, project, query, name]);

  const onPushToCopies = useCallback(() => {
    setIsPushToCopiesDialogOpen(true);
  }, []);

  const onArchiveWorkflow = useCallback(() => {
    if (!workflowId || !project) return;

    const hasRelated =
      (relatedEntitiesQuery.data?.evaluators.length ?? 0) > 0 ||
      (relatedEntitiesQuery.data?.agents.length ?? 0) > 0;

    // Use cascade archive if there are related entities, otherwise use simple archive
    if (hasRelated) {
      cascadeArchiveWorkflow.mutate(
        { workflowId, projectId: project.id },
        {
          onSuccess: (result) => {
            setIsDeleteDialogOpen(false);
            void query?.refetch();

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

            toaster.create({
              title: `Workflow "${name}" deleted`,
              description: parts.length > 0 ? `Also deleted: ${parts.join(", ")}` : undefined,
              type: "success",
            });
          },
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't delete workflow",
            }),
        },
      );
    } else {
      archiveWorkflow.mutate(
        { workflowId, projectId: project.id },
        {
          onSuccess: () => {
            setIsDeleteDialogOpen(false);
            void query?.refetch();
            toaster.create({
              title: `Workflow "${name}" deleted`,
              type: "success",
            });
          },
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't delete workflow",
            }),
        },
      );
    }
  }, [
    archiveWorkflow,
    cascadeArchiveWorkflow,
    name,
    project,
    query,
    relatedEntitiesQuery.data,
    workflowId,
  ]);

  return (
    <>
      <WorkflowCardDisplay
        {...props}
        name={name}
        icon={icon}
        description={description}
        updatedAtLabel={formatTimeAgo(workflow?.updatedAt?.getTime() ?? 0)}
        action={
          workflowId ? (
            <WorkflowCardActions
              isCopy={isCopiedWorkflow}
              hasCopies={hasCopies}
              sourceProjectPath={sourceProjectPath}
              onSyncFromSource={onSyncFromSource}
              onPushToCopies={onPushToCopies}
              onCopy={() => setIsCopyDialogOpen(true)}
              onDelete={() => setIsDeleteDialogOpen(true)}
            />
          ) : undefined
        }
      >
        {children}
      </WorkflowCardDisplay>

      <CascadeArchiveDialog
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={onArchiveWorkflow}
        isLoading={cascadeArchiveWorkflow.isPending || archiveWorkflow.isPending}
        isLoadingRelated={relatedEntitiesQuery.isLoading}
        entityType="workflow"
        entityName={name}
        relatedEntities={{
          evaluators: relatedEntitiesQuery.data?.evaluators,
          agents: relatedEntitiesQuery.data?.agents,
          monitors: relatedEntitiesQuery.data?.monitors,
        }}
      />

      {workflowId && (
        <CopyWorkflowDialog
          open={isCopyDialogOpen}
          onClose={() => setIsCopyDialogOpen(false)}
          workflowId={workflowId}
          workflowName={name}
        />
      )}
      {workflowId && (
        <PushToCopiesDialog
          open={isPushToCopiesDialogOpen}
          onClose={() => setIsPushToCopiesDialogOpen(false)}
          workflowId={workflowId}
          workflowName={name}
        />
      )}
    </>
  );
}
