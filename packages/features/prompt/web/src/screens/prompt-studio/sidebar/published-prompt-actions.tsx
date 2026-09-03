import { Box, Button, Text, useDisclosure } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { ArrowUp, Copy, RefreshCw } from "lucide-react";
import { LuClock, LuCopyPlus, LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";
import { DeleteConfirmationDialog } from "../../../ui/blocks/delete-confirmation-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { usePromptHost } from "../../../model/prompt-host";
import { usePromptProject } from "../../../behavior/use-prompt-project";
import { CopyPromptDialog } from "../dialogs/copy-prompt-dialog";
import { PushToCopiesDialog } from "../dialogs/push-to-copies-dialog";
import { usePrompts } from "../../../behavior/use-prompts";
import { useRenamePromptHandle } from "../../../behavior/use-rename-prompt-handle";
import { computeInitialFormValuesForPrompt } from "../../../surfaces/prompt-form";
import { getDisplayHandle } from "../../../surfaces/prompt-reference";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { promptApi } from "../../../behavior/prompt-api";
import { useDraggableTabsBrowserStore } from "../../../behavior/use-prompt-tabs-browser-store";

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
  const [isPushToCopiesDialogOpen, setIsPushToCopiesDialogOpen] = useState(false);
  const { open, setOpen } = useDisclosure();
  const { deletePrompt } = usePrompts();
  const { project } = usePromptProject();
  const host = usePromptHost();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
  const {
    renameHandle,
    canRename,
    permissionReason: renamePermissionReason,
  } = useRenamePromptHandle({ promptId });

  const syncFromSource = promptApi.prompts.syncFromSource.useMutation();
  const duplicatePrompt = promptApi.prompts.duplicate.useMutation();
  const utils = promptApi.useUtils();

  // Cascade-resolved model for new-tab "view history" prompts.
  const resolvedDefault = promptApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: open && !!project?.id },
  );

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
      host.succeeded({
        title: "Prompt updated",
        description: `Prompt "${getDisplayHandle(promptHandle)}" has been updated from source.`,
      });
    } catch (error) {
      if (host.isReportedGlobally(error)) return;
      host.failed({
        error,
        fallbackTitle: "Couldn't update the prompt from its source",
      });
    }
  }, [syncFromSource, project, utils, promptId, promptHandle, host]);

  const onDuplicate = useCallback(async () => {
    if (!project) return;

    try {
      const duplicated = await duplicatePrompt.mutateAsync({
        idOrHandle: promptId,
        projectId: project.id,
      });
      await utils.prompts.getAllPromptsForProject.invalidate();
      host.succeeded({
        title: "Prompt duplicated",
        description: `"${getDisplayHandle(
          promptHandle,
        )}" was duplicated as "${getDisplayHandle(duplicated.handle)}"`,
      });
    } catch (error) {
      // The application shows a plan-limit refusal as its own modal; asking
      // first is what keeps a reader from being told the same thing twice.
      if (host.isReportedGlobally(error)) return;
      host.failed({ error, fallbackTitle: "Couldn't duplicate the prompt" });
    }
  }, [duplicatePrompt, project, utils, promptId, promptHandle, host]);

  const { data: permission } = promptApi.prompts.checkModifyPermission.useQuery(
    {
      idOrHandle: promptId,
      projectId: project?.id ?? "",
    },
    {
      enabled: open && !!project?.id,
    },
  );

  // Default to NOT deletable until the permission query resolves. The query is
  // gated on the menu being open, so there is a brief loading window on first
  // open; defaulting to `true` there would enable the destructive Delete action
  // before we know the caller is actually allowed.
  const canDelete = permission?.hasPermission === true;

  const handleDelete = useCallback(async () => {
    if (!project?.id) return;

    try {
      await deletePrompt({
        projectId: project.id,
        idOrHandle: promptId,
      });
      host.succeeded({
        title: "Prompt deleted",
        description: `"${getDisplayHandle(promptHandle)}" has been deleted`,
      });
    } catch (error) {
      if (host.isReportedGlobally(error)) return;
      host.failed({ error, fallbackTitle: "Couldn't delete the prompt" });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  }, [promptId, promptHandle, project?.id, deletePrompt, host]);

  return (
    <>
      <Box
        onClick={(e) => e.stopPropagation()}
        opacity={0}
        _groupHover={{ opacity: 1 }}
        transition="opacity 0.2s"
      >
        <Menu.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
          <Menu.Trigger asChild>
            <Button variant="ghost" size="xs" onClick={(event) => event.stopPropagation()}>
              <LuEllipsisVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content onClick={(event) => event.stopPropagation()}>
            {isCopiedPrompt && (
              <Menu.Item value="sync" onClick={() => void onSyncFromSource()}>
                <RefreshCw size={16} /> Update from source
              </Menu.Item>
            )}
            {hasCopies && (
              <Menu.Item value="push" onClick={() => setIsPushToCopiesDialogOpen(true)}>
                <ArrowUp size={16} /> Push to replicas
              </Menu.Item>
            )}
            <Menu.Item value="copy" onClick={() => setIsCopyDialogOpen(true)}>
              <Copy size={16} /> Replicate to another project
            </Menu.Item>
            <Menu.Item value="duplicate" onClick={() => void onDuplicate()}>
              <LuCopyPlus size={16} /> Duplicate prompt
            </Menu.Item>
            <Menu.Item
              value="view-history"
              onClick={() => {
                if (!prompt) return;
                const defaultValues = computeInitialFormValuesForPrompt({
                  prompt,
                  defaultModel: resolvedDefault.data?.model ?? "",
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
