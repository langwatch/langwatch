import { Button, HStack, Icon, Spinner, Text } from "@chakra-ui/react";
import { useCallback, useMemo, useState } from "react";
import { LuFileOutput, LuPencil } from "react-icons/lu";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../../../stores/drawerStore";
import { useFocusSectionStore } from "../../../stores/focusSectionStore";
import {
  buildTraceEditPatch,
  summarizeTraceEdit,
  useTraceEditStore,
} from "../../../stores/traceEditStore";
import { exitTraceEditMode } from "../../../utils/traceEditMode";

/** "3 fields changed, 1 span deleted", with only the non-zero parts. */
function describeEdit({
  changedFields,
  deletedSpans,
}: {
  changedFields: number;
  deletedSpans: number;
}): string {
  const parts: string[] = [];
  if (changedFields > 0) {
    parts.push(
      `${changedFields} field${changedFields === 1 ? "" : "s"} changed`,
    );
  }
  if (deletedSpans > 0) {
    parts.push(`${deletedSpans} span${deletedSpans === 1 ? "" : "s"} deleted`);
  }
  return parts.length > 0 ? parts.join(", ") : "No changes yet";
}

/** The draft the bar summarizes and, on Save, writes as the correction. */
function useTraceEditDraft() {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const spanDrafts = useTraceEditStore((s) => s.spanDrafts);
  const deletedSpanIds = useTraceEditStore((s) => s.deletedSpanIds);
  const restoredSpanIds = useTraceEditStore((s) => s.restoredSpanIds);
  const traceOutputDraft = useTraceEditStore((s) => s.traceOutputDraft);

  return useMemo(
    () => ({
      basePatch,
      spanDrafts,
      deletedSpanIds,
      restoredSpanIds,
      traceOutputDraft,
    }),
    [basePatch, spanDrafts, deletedSpanIds, restoredSpanIds, traceOutputDraft],
  );
}

/** Writing the correction, confirming it, and leaving edit mode behind it. */
function useSaveTraceEdit({ traceId }: { traceId: string }) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const [isRebasing, setIsRebasing] = useState(false);

  const upsert = api.traceEditOverlay.upsert.useMutation({
    onSuccess: () => {
      if (project) {
        void utils.traceEditOverlay.getByTraceId.invalidate({
          projectId: project.id,
          traceId,
        });
      }
      toaster.create({ title: "Trace edits saved", type: "success" });
      exitTraceEditMode();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't save trace edits" }),
  });

  const save = useCallback(async () => {
    if (!project) return;
    // Read the correction back before merging onto it. The one adopted when
    // editing started can be minutes old — a suggestion saved in between writes
    // the same record — and building on a stale one would drop whatever was
    // stored since. Two people saving in the same instant still race, and the
    // last write wins; a reviewer racing themselves does not.
    setIsRebasing(true);
    try {
      const latest = await utils.traceEditOverlay.getByTraceId.fetch(
        { projectId: project.id, traceId },
        { staleTime: 0 },
      );
      if (latest?.patch) {
        useTraceEditStore
          .getState()
          .rebaseBasePatch({ traceId, basePatch: latest.patch });
      }
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't save trace edits" });
      return;
    } finally {
      setIsRebasing(false);
    }

    upsert.mutate({
      projectId: project.id,
      traceId,
      patch: buildTraceEditPatch(useTraceEditStore.getState()),
    });
  }, [project, traceId, upsert, utils]);

  return { save, isSaving: upsert.isLoading || isRebasing };
}

/**
 * The strip that says the drawer is being edited, what the correction changes
 * so far, and how to finish. Rendered between the header and the panes for as
 * long as edit mode is on.
 */
export function EditModeBar({ traceId }: { traceId: string }) {
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // Something else already asked to leave the trace (closing the drawer,
  // opening another one) and is waiting on the same decision, so both use one
  // dialog and one set of words.
  const pendingExit = useTraceEditStore((s) => s.pendingExit);
  const clearPendingExit = useTraceEditStore((s) => s.clearPendingExit);
  const confirmOpen = cancelConfirmOpen || pendingExit !== null;

  const setViewModeTransient = useDrawerStore((s) => s.setViewModeTransient);
  const requestFocusSection = useFocusSectionStore((s) => s.request);

  const draft = useTraceEditDraft();
  const summary = summarizeTraceEdit(draft);
  const isDirty = summary.changedFields > 0 || summary.deletedSpans > 0;
  const { save, isSaving } = useSaveTraceEdit({ traceId });
  const handleSave = useCallback(() => void save(), [save]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setCancelConfirmOpen(true);
      return;
    }
    exitTraceEditMode();
  }, [isDirty]);

  const handleKeepEditing = useCallback(() => {
    setCancelConfirmOpen(false);
    clearPendingExit();
  }, [clearPendingExit]);

  const handleDiscard = useCallback(() => {
    setCancelConfirmOpen(false);
    const run = pendingExit;
    exitTraceEditMode();
    run?.();
  }, [pendingExit]);

  const handleJumpToTraceOutput = useCallback(() => {
    // The trace's own output lives in the Summary view, so the jump changes
    // view first. Transient: the reviewer is being taken there, they did not
    // pick it as their landing tab.
    setViewModeTransient("summary");
    requestFocusSection({ traceId, section: "io" });
  }, [setViewModeTransient, requestFocusSection, traceId]);

  return (
    <>
      <HStack
        paddingX={4}
        paddingY={2}
        gap={3}
        bg="blue.subtle"
        borderBottomWidth="1px"
        borderColor="border"
        flexShrink={0}
        data-testid="trace-edit-mode-bar"
      >
        <Icon as={LuPencil} boxSize={3.5} color="blue.fg" />
        <Text textStyle="sm" fontWeight="semibold" color="blue.fg">
          Editing trace
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {describeEdit(summary)}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={handleJumpToTraceOutput}
          gap={1.5}
        >
          <Icon as={LuFileOutput} boxSize={3} />
          <Text textStyle="2xs">Trace output</Text>
        </Button>
        <HStack marginLeft="auto" gap={2}>
          <Button size="xs" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            size="xs"
            colorPalette="blue"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            gap={1.5}
          >
            {isSaving && <Spinner size="xs" />}
            Save
          </Button>
        </HStack>
      </HStack>

      <DiscardTraceEditsDialog
        open={confirmOpen}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscard}
      />
    </>
  );
}

/** The one question asked for every way of leaving an unsaved correction. */
function DiscardTraceEditsDialog({
  open,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onKeepEditing();
      }}
      size="sm"
      placement="center"
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Discard trace edits?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text textStyle="sm" color="fg.muted">
            Your changes to this trace have not been saved.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button size="sm" variant="outline" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button size="sm" colorPalette="red" onClick={onDiscard}>
            Discard changes
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
