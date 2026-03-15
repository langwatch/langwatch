import { Box, Button, Text } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { ArrowUp, Copy, RefreshCw } from "react-feather";
import { LuClock, LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";
import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { CopyPromptDialog } from "~/prompts/components/CopyPromptDialog";
import { PushToCopiesDialog } from "~/prompts/components/PushToCopiesDialog";
import { usePrompts } from "~/prompts/hooks/usePrompts";
import { useRenamePromptHandle } from "~/prompts/hooks/useRenamePromptHandle";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { getDisplayHandle } from "./PublishedPromptsList";

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
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
  const {
    renameHandle,
    canRename,
    permissionReason: renamePermissionReason,
  } = useRenamePromptHandle({ promptId });

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
      if (isHandledByGlobalHandler(error)) return;
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
      if (isHandledByGlobalHandler(error)) return;
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
              size="xs"
              onClick={(event) => event.stopPropagation()}
            >
              <LuEllipsisVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content onClick={(event) => event.stopPropagation()}>
            {isCopiedPrompt && (
                <Menu.Item
                  value="sync"
                  onClick={() => void onSyncFromSource()}
                >
                  <RefreshCw size={16} /> Update from source
                </Menu.Item>
            )}
            {hasCopies && (
                <Menu.Item
                  value="push"
                  onClick={() => setIsPushToCopiesDialogOpen(true)}
                >
                  <ArrowUp size={16} /> Push to replicas
                </Menu.Item>
            )}
              <Menu.Item
                value="copy"
                onClick={() => setIsCopyDialogOpen(true)}
              >
                <Copy size={16} /> Replicate to another project
              </Menu.Item>
            <Menu.Item
              value="view-history"
              onClick={() => {
                if (!prompt) return;
                const projectDefaultModel = project?.defaultModel;
                const normalizedDefaultModel =
                  typeof projectDefaultModel === "string"
                    ? projectDefaultModel
                    : undefined;
                const defaultValues = computeInitialFormValuesForPrompt({
                  prompt,
                  defaultModel: normalizedDefaultModel,
                  useSystemMessage: true,
                });
                addTab({
                  data: {
                    chat: { initialMessagesFromSpanData: [] },
                    form: { currentValues: defaultValues },
                    meta: {
                      title: defaultValues.handle ?? null,
                      versionNumber: defaultValues.versionMetadata?.versionNumber,
                      openHistoryOnLoad: true,
                    },
                    variableValues: {},
                  },
                });
              }}
            >
              <LuClock size={16} /> View history
            </Menu.Item>
            <Tooltip
              content={renamePermissionReason}
              disabled={canRename}
              positioning={{ placement: "right" }}
              showArrow
            >
              <Menu.Item
                value="rename"
                onClick={canRename ? renameHandle : undefined}
                disabled={!canRename}
                opacity={canRename ? 1 : 0.5}
                cursor={canRename ? "pointer" : "not-allowed"}
              >
                <LuPencil size={16} />
                <Text as="span">Rename handle</Text>
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
        onSuccess={() => void utils.prompts.getAllPromptsForProject.invalidate()}
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
