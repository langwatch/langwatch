import { Box, Button } from "@chakra-ui/react";
import { MoreVertical, Trash2 } from "react-feather";
import { Menu } from "~/components/ui/menu";
import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { useState, useCallback } from "react";
import { usePrompts } from "~/prompt-configs/hooks/usePrompts";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import { getDisplayHandle } from "./PublishedPromptsList";

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
            <Menu.Item
              value="delete"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <Trash2 size={16} /> Delete prompt
            </Menu.Item>
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
