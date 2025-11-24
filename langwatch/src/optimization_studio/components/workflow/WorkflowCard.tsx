import {
  Button,
  Separator,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Menu } from "../../../components/ui/menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { WorkflowIcon } from "../ColorfulBlockIcons";
import { MoreVertical, Copy, Trash2, RefreshCw, ArrowUp } from "react-feather";
import { api } from "../../../utils/api";
import { useCallback, useState } from "react";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/api/root";
import { toaster } from "../../../components/ui/toaster";
import { DeleteConfirmationDialog } from "../../../components/annotations/DeleteConfirmationDialog";
import { CopyWorkflowDialog } from "./CopyWorkflowDialog";

export function WorkflowCardBase(props: React.ComponentProps<typeof VStack>) {
  return (
    <VStack
      align="start"
      padding={4}
      gap={4}
      borderRadius={8}
      background="white"
      boxShadow="md"
      height="200px"
      cursor="pointer"
      role="button"
      transition="all 0.2s ease-in-out"
      _hover={{
        boxShadow: "lg",
        textDecoration: "none",
      }}
      {...props}
    >
      {props.children}
    </VStack>
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
  const syncFromSource = api.workflow.syncFromSource.useMutation();
  const pushToCopies = api.workflow.pushToCopies.useMutation();
  const hasWorkflowsDeletePermission = hasPermission("workflows:delete");
  const hasWorkflowsCreatePermission = hasPermission("workflows:create");
  const hasWorkflowsUpdatePermission = hasPermission("workflows:update");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);

  // Get the workflow data to check if it's a copy or has copies
  const workflow = workflowId
    ? query?.data?.find((w) => w.id === workflowId)
    : undefined;
  const isCopiedWorkflow = !!workflow?.copiedFromWorkflowId;
  const hasCopies = (workflow?._count?.copiedWorkflows ?? 0) > 0;

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
    if (!workflowId || !project) return;

    pushToCopies.mutate(
      { workflowId, projectId: project.id },
      {
        onSuccess: (result) => {
          void query?.refetch();
          toaster.create({
            title: "Workflow pushed",
            description: `Latest version of "${name}" has been pushed to ${result.pushedTo} of ${result.totalCopies} copied workflow(s).`,
            type: "success",
            meta: {
              closable: true,
            },
          });
        },
        onError: (error) => {
          toaster.create({
            title: "Error pushing workflow",
            description: error.message || "Please try again later.",
            type: "error",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  }, [pushToCopies, workflowId, project, query, name]);

  const onArchiveWorkflow = useCallback(() => {
    if (!workflowId || !project) return;

    archiveWorkflow.mutate(
      { workflowId, projectId: project.id },
      {
        onSuccess: () => {
          void query?.refetch();
          toaster.create({
            title: `Workflow ${name} deleted`,
            description: (
              <HStack>
                <Button
                  unstyled
                  color="white"
                  cursor="pointer"
                  textDecoration="underline"
                  onClick={() => {
                    toaster.remove(`delete-workflow-${workflowId}`);
                    setTimeout(() => {
                      void query?.refetch();
                    }, 1000);
                    archiveWorkflow.mutate(
                      {
                        projectId: project?.id ?? "",
                        workflowId,
                        unarchive: true,
                      },
                      {
                        onSuccess: () => {
                          void query?.refetch();
                          toaster.create({
                            title: "Workflow restored",
                            description: "The workflow has been restored.",
                            type: "success",
                            meta: {
                              closable: true,
                            },
                          });
                        },
                      },
                    );
                  }}
                >
                  Undo
                </Button>
              </HStack>
            ),
            id: `delete-workflow-${workflowId}`,
            type: "success",
            meta: {
              closable: true,
            },
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
  }, [archiveWorkflow, name, project, query, workflowId]);

  return (
    <>
      <WorkflowCardBase paddingX={0} {...props}>
        <HStack gap={4} paddingX={4} width="full">
          <WorkflowIcon icon={icon} size={"lg"} />
          <Heading as={"h2"} size="sm" fontWeight={600}>
            {name}
          </Heading>
          <Spacer />
          {workflowId && (
            <Menu.Root>
              <Menu.Trigger className="js-inner-menu">
                <MoreVertical size={24} />
              </Menu.Trigger>
              <Menu.Content className="js-inner-menu">
                {isCopiedWorkflow && (
                  <Tooltip
                    content={
                      !hasWorkflowsUpdatePermission
                        ? "You need workflows:update permission to sync from source"
                        : undefined
                    }
                    disabled={hasWorkflowsUpdatePermission}
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
                        ? "You need workflows:update permission to push to copies"
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
                      <ArrowUp size={16} /> Push to copies
                    </Menu.Item>
                  </Tooltip>
                )}
                <Tooltip
                  content={
                    !hasWorkflowsCreatePermission
                      ? "You need workflows:create permission to copy workflows"
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
                    <Copy size={16} /> Copy to another project
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
        <Separator />
        {description && (
          <Text paddingX={4} color="gray.600" fontSize="14px">
            {description}
          </Text>
        )}
        {children}
      </WorkflowCardBase>

      <DeleteConfirmationDialog
        title="Are you really sure?"
        description={`Deleting "${name}" cannot be undone. If you're sure you want to delete this workflow, type 'delete' below:`}
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={onArchiveWorkflow}
      />

      {workflowId && (
        <CopyWorkflowDialog
          open={isCopyDialogOpen}
          onClose={() => setIsCopyDialogOpen(false)}
          workflowId={workflowId}
          workflowName={name}
        />
      )}
    </>
  );
}
