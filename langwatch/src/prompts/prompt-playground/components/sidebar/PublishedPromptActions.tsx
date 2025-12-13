import { Box, Button, Text } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { LuEllipsisVertical, LuTrash2 } from "react-icons/lu";
import { Copy, RefreshCw, ArrowUp } from "react-feather";
import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePrompts } from "~/prompts/hooks/usePrompts";
import { api } from "~/utils/api";
import { getDisplayHandle } from "./PublishedPromptsList";
import { CopyPromptDialog } from "~/prompts/components/CopyPromptDialog";
import { PushToCopiesDialog } from "~/prompts/components/PushToCopiesDialog";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

interface PublishedPromptActionsProps {
  promptId: string;
  promptHandle: string | null;
  prompt?: VersionedPrompt | null;
}

/**
 * PublishedPromptActions
 * Single Responsibility: render per‑prompt actions (e.g., delete) with confirmation.
 */
export function PublishedPromptActions({
  promptId,
  promptHandle,
  prompt,
}: PublishedPromptActionsProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isPushToCopiesDialogOpen, setIsPushToCopiesDialogOpen] =
    useState(false);
  const { deletePrompt } = usePrompts();
  const { project, hasPermission } = useOrganizationTeamProject();
  const hasPromptsCreatePermission = hasPermission("prompts:create");
  const hasPromptsUpdatePermission = hasPermission("prompts:update");

  const syncFromSource = api.prompts.syncFromSource.useMutation();
  const utils = api.useContext();

  const isCopiedPrompt = !!prompt?.copiedFromPromptId;
  const hasCopies = (prompt?._count?.copiedPrompts ?? 0) > 0;

  const onSyncFromSource = useCallback(async () => {
    if (!project) return;

    try {
      await syncFromSource.mutateAsync({
        idOrHandle: promptId,
        projectId: project.id,
      });
      await utils.prompts.getAllPromptsForProject.invalidate();
      toaster.create({
        title: "Prompt updated",
        description: `Prompt "${getDisplayHandle(
          promptHandle,
        )}" has been updated from source.`,
        type: "success",
        meta: {
          closable: true,
        },
      });
    } catch (error) {
      toaster.create({
        title: "Error updating prompt",
        description:
          error instanceof Error ? error.message : "Please try again later.",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  }, [syncFromSource, project, utils, promptId, promptHandle]);

  const { data: permission } = api.prompts.checkModifyPermission.useQuery(
    {
      idOrHandle: promptId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    },
  );

  const canDelete = permission?.hasPermission ?? true;

  const handleDelete = useCallback(async () => {
    if (!project?.id) return;

    try {
      await deletePrompt({
        projectId: project.id,
        idOrHandle: promptId,
      });
      toaster.create({
        title: "Prompt deleted",
        description: `"${getDisplayHandle(promptHandle)}" has been deleted`,
        type: "success",
      });
    } catch (error) {
      toaster.create({
        title: "Failed to delete prompt",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        type: "error",
      });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  }, [promptId, promptHandle, project?.id, deletePrompt]);

  return (
    <>
      <Box
        onClick={(e) => e.stopPropagation()}
        opacity={0}
        _groupHover={{ opacity: 1 }}
        transition="opacity 0.2s"
      >
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => event.stopPropagation()}
            >
              <LuEllipsisVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content onClick={(event) => event.stopPropagation()}>
            {isCopiedPrompt && (
              <Tooltip
                content={
                  !hasPromptsUpdatePermission
                    ? "You need prompts:update permission to sync from source"
                    : undefined
                }
                disabled={hasPromptsUpdatePermission}
                positioning={{ placement: "right" }}
                showArrow
              >
                <Menu.Item
                  value="sync"
                  onClick={
                    hasPromptsUpdatePermission
                      ? () => void onSyncFromSource()
                      : undefined
                  }
                  disabled={!hasPromptsUpdatePermission}
                >
                  <RefreshCw size={16} /> Update from source
                </Menu.Item>
              </Tooltip>
            )}
            {hasCopies && (
              <Tooltip
                content={
                  !hasPromptsUpdatePermission
                    ? "You need prompts:update permission to push to replicas"
                    : undefined
                }
                disabled={hasPromptsUpdatePermission}
                positioning={{ placement: "right" }}
                showArrow
              >
                <Menu.Item
                  value="push"
                  onClick={
                    hasPromptsUpdatePermission
                      ? () => setIsPushToCopiesDialogOpen(true)
                      : undefined
                  }
                  disabled={!hasPromptsUpdatePermission}
                >
                  <ArrowUp size={16} /> Push to replicas
                </Menu.Item>
              </Tooltip>
            )}
            <Tooltip
              content={
                !hasPromptsCreatePermission
                  ? "You need prompts:create permission to replicate prompts"
                  : undefined
              }
              disabled={hasPromptsCreatePermission}
              positioning={{ placement: "right" }}
              showArrow
            >
              <Menu.Item
                value="copy"
                onClick={
                  hasPromptsCreatePermission
                    ? () => setIsCopyDialogOpen(true)
                    : undefined
                }
                disabled={!hasPromptsCreatePermission}
              >
                <Copy size={16} /> Replicate to another project
              </Menu.Item>
            </Tooltip>
            <Tooltip
              content={permission?.reason}
              disabled={canDelete}
              positioning={{ placement: "right" }}
              showArrow
            >
              <Menu.Item
                value="delete"
                onClick={() => canDelete && setIsDeleteDialogOpen(true)}
                disabled={!canDelete}
                opacity={canDelete ? 1 : 0.5}
                cursor={canDelete ? "pointer" : "not-allowed"}
              >
                <LuTrash2 size={16} />
                <Text as="span">Delete prompt</Text>
              </Menu.Item>
            </Tooltip>
          </Menu.Content>
        </Menu.Root>
      </Box>

      <DeleteConfirmationDialog
        title="Are you really sure?"
        description="There is no going back, and you will lose all versions of this prompt. If you're sure you want to delete this prompt, type 'delete' below:"
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => void handleDelete()}
      />

      <CopyPromptDialog
        open={isCopyDialogOpen}
        onClose={() => setIsCopyDialogOpen(false)}
        promptId={promptId}
        promptName={getDisplayHandle(promptHandle)}
      />

      <PushToCopiesDialog
        open={isPushToCopiesDialogOpen}
        onClose={() => setIsPushToCopiesDialogOpen(false)}
        promptId={promptId}
        promptName={getDisplayHandle(promptHandle)}
      />
    </>
  );
}
