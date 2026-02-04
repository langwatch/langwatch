import {
  Button,
  Heading,
  HStack,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useState } from "react";
import { ArrowUp, Copy, MoreVertical, RefreshCw, Trash2 } from "react-feather";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { CascadeArchiveDialog } from "../../../components/CascadeArchiveDialog";
import { Menu } from "../../../components/ui/menu";
import { toaster } from "../../../components/ui/toaster";
import { Tooltip } from "../../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { AppRouter } from "../../../server/api/root";
import { api } from "../../../utils/api";
import { WorkflowIcon } from "../ColorfulBlockIcons";
import { CopyWorkflowDialog } from "./CopyWorkflowDialog";
import { PushToCopiesDialog } from "./PushToCopiesDialog";

export function WorkflowCardBase(props: React.ComponentProps<typeof VStack>) {
  return (
    <VStack
      align="start"
      padding={4}
      gap={2}
      borderRadius="xl"
      background="white"
      boxShadow="md"
      height="142px"
      cursor="pointer"
      role="button"
      transition="all 0.2s ease-in-out"
      border="1px solid"
      borderColor="border.muted"
      _hover={{
        boxShadow: "xl",
        textDecoration: "none",
      }}
      {...props}
    >
      {props.children}
    </VStack>
  );
}

/**
 * Simple workflow card display component for reuse.
 * Shows workflow icon, name, and timestamp with a customizable action slot.
 */
export function WorkflowCardDisplay({
  name,
  icon,
  updatedAt,
  action,
  ...props
}: {
  name: string;
  icon: React.ReactNode;
  updatedAt?: Date | number;
  action?: React.ReactNode;
} & Omit<React.ComponentProps<typeof WorkflowCardBase>, "children">) {
  return (
    <WorkflowCardBase paddingX={0} {...props}>
      <HStack gap={4} paddingX={4} paddingBottom={2} width="full">
        <WorkflowIcon icon={icon} size="lg" />
        <Spacer />
        {action}
      </HStack>
      <Spacer />
      <Text paddingX={4} color="fg.muted" fontSize="sm" fontWeight={500}>
        {name}
      </Text>
      {updatedAt && (
        <Text paddingX={4} color="fg.subtle" fontSize="12px">
          {formatTimeAgo(
            typeof updatedAt === "number" ? updatedAt : updatedAt.getTime(),
          )}
        </Text>
      )}
    </WorkflowCardBase>
  );
}

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
  const { project, hasPermission } = useOrganizationTeamProject();
  const archiveWorkflow = api.workflow.archive.useMutation();
  const cascadeArchiveWorkflow = api.workflow.cascadeArchive.useMutation();
  const syncFromSource = api.workflow.syncFromSource.useMutation();
  const hasWorkflowsDeletePermission = hasPermission("workflows:delete");
  const hasWorkflowsCreatePermission = hasPermission("workflows:create");
  const hasWorkflowsUpdatePermission = hasPermission("workflows:update");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isPushToCopiesDialogOpen, setIsPushToCopiesDialogOpen] =
    useState(false);

  // Query related entities when delete dialog is open
  const relatedEntitiesQuery = api.workflow.getRelatedEntities.useQuery(
    { workflowId: workflowId ?? "", projectId: project?.id ?? "" },
    { enabled: isDeleteDialogOpen && !!workflowId && !!project?.id },
  );

  // Get the workflow data to check if it's a copy or has copies
  const workflow = workflowId
    ? query?.data?.find((w) => w.id === workflowId)
    : undefined;
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
            meta: {
              closable: true,
            },
          });
        },
        onError: (error) => {
          toaster.create({
            title: "Error updating workflow",
            description: error.message || "Please try again later.",
            type: "error",
            meta: {
              closable: true,
            },
          });
        },
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
              description:
                parts.length > 0
                  ? `Also deleted: ${parts.join(", ")}`
                  : undefined,
              type: "success",
              meta: { closable: true },
            });
          },
          onError: () => {
            toaster.create({
              title: "Error deleting workflow",
              description: "Please try again later.",
              type: "error",
            });
          },
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
              meta: { closable: true },
            });
          },
          onError: () => {
            toaster.create({
              title: "Error deleting workflow",
              description: "Please try again later.",
              type: "error",
            });
          },
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
      <WorkflowCardBase paddingX={0} {...props}>
        <HStack gap={4} paddingX={4} paddingBottom={2} width="full">
          <WorkflowIcon icon={icon} size={"lg"} />
          {description && (
            <Text color="fg.muted" fontSize="sm" fontWeight={500}>
              {name}
            </Text>
          )}
          <Spacer />
          {workflowId && (
            <Menu.Root>
              <Menu.Trigger className="js-inner-menu">
                <MoreVertical size={16} />
              </Menu.Trigger>
              <Menu.Content className="js-inner-menu">
                {isCopiedWorkflow && (
                  <Tooltip
                    content={
                      !hasWorkflowsUpdatePermission
                        ? "You need workflows:update permission to sync from source"
                        : sourceProjectPath
                          ? `Copied from: ${sourceProjectPath}`
                          : undefined
                    }
                    disabled={
                      !hasWorkflowsUpdatePermission && !sourceProjectPath
                    }
                    positioning={{ placement: "right" }}
                    showArrow
                  >
                    <Menu.Item
                      value="sync"
                      onClick={
                        hasWorkflowsUpdatePermission
                          ? () => onSyncFromSource()
                          : undefined
                      }
                      disabled={!hasWorkflowsUpdatePermission}
                    >
                      <RefreshCw size={16} /> Update from source
                    </Menu.Item>
                  </Tooltip>
                )}
                {hasCopies && (
                  <Tooltip
                    content={
                      !hasWorkflowsUpdatePermission
                        ? "You need workflows:update permission to push to replicas"
                        : undefined
                    }
                    disabled={hasWorkflowsUpdatePermission}
                    positioning={{ placement: "right" }}
                    showArrow
                  >
                    <Menu.Item
                      value="push"
                      onClick={
                        hasWorkflowsUpdatePermission
                          ? () => onPushToCopies()
                          : undefined
                      }
                      disabled={!hasWorkflowsUpdatePermission}
                    >
                      <ArrowUp size={16} /> Push to replicas
                    </Menu.Item>
                  </Tooltip>
                )}
                <Tooltip
                  content={
                    !hasWorkflowsCreatePermission
                      ? "You need workflows:create permission to replicate workflows"
                      : undefined
                  }
                  disabled={hasWorkflowsCreatePermission}
                  positioning={{ placement: "right" }}
                  showArrow
                >
                  <Menu.Item
                    value="copy"
                    onClick={
                      hasWorkflowsCreatePermission
                        ? () => setIsCopyDialogOpen(true)
                        : undefined
                    }
                    disabled={!hasWorkflowsCreatePermission}
                  >
                    <Copy size={16} /> Replicate to another project
                  </Menu.Item>
                </Tooltip>
                <Tooltip
                  content={
                    !hasWorkflowsDeletePermission
                      ? "You need workflows:delete permission to delete workflows"
                      : undefined
                  }
                  disabled={hasWorkflowsDeletePermission}
                  positioning={{ placement: "right" }}
                  showArrow
                >
                  <Menu.Item
                    value="delete"
                    color="red.500"
                    onClick={
                      hasWorkflowsDeletePermission
                        ? () => setIsDeleteDialogOpen(true)
                        : undefined
                    }
                    disabled={!hasWorkflowsDeletePermission}
                  >
                    <Trash2 size={16} /> Delete
                  </Menu.Item>
                </Tooltip>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>
        {children}
        {!description && <Spacer />}
        <Text
          paddingX={4}
          color="fg.muted"
          fontSize="sm"
          fontWeight={!description ? 500 : undefined}
        >
          {description ?? name}
        </Text>
        <Text paddingX={4} color="fg.subtle" fontSize="12px">
          {formatTimeAgo(workflow?.updatedAt?.getTime() ?? 0)}
        </Text>
      </WorkflowCardBase>

      <CascadeArchiveDialog
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={onArchiveWorkflow}
        isLoading={
          cascadeArchiveWorkflow.isPending || archiveWorkflow.isPending
        }
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
