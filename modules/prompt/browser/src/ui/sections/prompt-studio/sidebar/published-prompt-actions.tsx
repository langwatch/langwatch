import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, Text, useDisclosure } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ArrowUp, Copy, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { LuClock, LuCopyPlus, LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";

import { useCanModifyPrompt } from "../../../../behavior/use-can-modify-prompt.ts";
import { usePromptCopyActions } from "../../../../behavior/use-prompt-copy-actions.ts";
import { usePromptDefaultModel } from "../../../../behavior/use-prompt-default-model.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { useDraggableTabsBrowserStore } from "../../../../behavior/use-prompt-tabs-browser-store.ts";
import { usePrompts } from "../../../../behavior/use-prompts.ts";
import { useRenamePromptHandle } from "../../../../behavior/use-rename-prompt-handle.ts";
import { type PromptHostApi, usePromptHost } from "../../../../model/prompt-host.ts";
import type { WireVersionedPrompt } from "../../../../model/wire-versioned-prompt.ts";
import { computeInitialFormValuesForPrompt } from "../../../../prompt-form.ts";
import { getDisplayHandle } from "../../../../prompt-reference.ts";
import { CopyPromptDialog } from "../dialogs/copy-prompt-dialog.tsx";
import { PushToCopiesDialog } from "../dialogs/push-to-copies-dialog.tsx";

interface PublishedPromptActionsProps {
  promptId: string;
  promptHandle: string | null;
  prompt?: WireVersionedPrompt | null;
}

function reportUnlessGlobal({
  host,
  error,
  fallbackTitle,
}: {
  host: PromptHostApi;
  error: unknown;
  fallbackTitle: string;
}): void {
  if (host.isReportedGlobally(error)) return;
  host.failed({ error, fallbackTitle });
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
  const addTab = useDraggableTabsBrowserStore((state) => state.addTab);
  const {
    renameHandle,
    canRename,
    permissionReason: renamePermissionReason,
  } = useRenamePromptHandle({ promptId });

  const { syncFromSource, duplicatePrompt } = usePromptCopyActions();

  // Cascade-resolved model for new-tab "view history" prompts.
  const resolvedDefault = usePromptDefaultModel({ enabled: open });

  const isCopiedPrompt = !!prompt?.copiedFromPromptId;
  const hasCopies = (prompt?._count?.copiedPrompts ?? 0) > 0;

  const onSyncFromSource = useCallback(async () => {
    if (!project) return;

    try {
      await syncFromSource.mutateAsync({
        idOrHandle: promptId,
        projectId: project.id,
      });
      host.succeeded({
        title: "Prompt updated",
        description: `Prompt "${getDisplayHandle(promptHandle)}" has been updated from source.`,
      });
    } catch (error) {
      reportUnlessGlobal({
        host,
        error,
        fallbackTitle: "Couldn't update the prompt from its source",
      });
    }
  }, [syncFromSource, project, promptId, promptHandle, host]);

  const onDuplicate = useCallback(async () => {
    if (!project) return;

    try {
      const duplicated = await duplicatePrompt.mutateAsync({
        idOrHandle: promptId,
        projectId: project.id,
      });
      host.succeeded({
        title: "Prompt duplicated",
        description: `"${getDisplayHandle(
          promptHandle,
        )}" was duplicated as "${getDisplayHandle(duplicated.handle)}"`,
      });
    } catch (error) {
      // The application shows a plan-limit refusal as its own modal; asking
      // first is what keeps a reader from being told the same thing twice.
      reportUnlessGlobal({ host, error, fallbackTitle: "Couldn't duplicate the prompt" });
    }
  }, [duplicatePrompt, project, promptId, promptHandle, host]);

  const { data: permission } = useCanModifyPrompt({ promptId, enabled: open });

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
      reportUnlessGlobal({ host, error, fallbackTitle: "Couldn't delete the prompt" });
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
            <Button
              variant="ghost"
              size="xs"
              aria-label="Prompt actions"
              data-testid={`prompt-actions-menu-${promptHandle ?? promptId}`}
              onClick={(event) => event.stopPropagation()}
            >
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
            <Menu.Item
              value="duplicate"
              data-testid="prompt-actions-duplicate"
              onClick={() => void onDuplicate()}
            >
              <LuCopyPlus size={16} /> Duplicate prompt
            </Menu.Item>
            <Menu.Item
              value="view-history"
              data-testid="prompt-actions-view-history"
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
                data-testid="prompt-actions-rename-handle"
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
                data-testid="prompt-actions-delete"
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
