import { Box, Button, Text } from "@chakra-ui/react";
import { MoreVertical, Trash2 } from "react-feather";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { useState, useCallback } from "react";
import { usePrompts } from "~/prompt-configs/hooks/usePrompts";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import { getDisplayHandle } from "./PublishedPromptsList";
import { api } from "~/utils/api";

interface PublishedPromptActionsProps {
  promptId: string;
  promptHandle: string | null;
}

export function PublishedPromptActions({
  promptId,
  promptHandle,
}: PublishedPromptActionsProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { deletePrompt } = usePrompts();
  const { project } = useOrganizationTeamProject();

  const { data: permission } = api.prompts.checkModifyPermission.useQuery(
    {
      idOrHandle: promptId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  const canDelete = permission?.hasPermission ?? true;
  const deleteLabel = canDelete
    ? "Delete prompt"
    : "Cannot delete (created by another project)";

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
        description: error instanceof Error ? error.message : "An unknown error occurred",
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
              <MoreVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content onClick={(event) => event.stopPropagation()}>
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
                <Trash2 size={16} />
                <Text>{deleteLabel}</Text>
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
    </>
  );
}
