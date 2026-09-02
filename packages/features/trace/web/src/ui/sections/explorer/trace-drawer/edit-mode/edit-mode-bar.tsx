import { Button, HStack, Icon, Spinner, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuFileOutput, LuPencil } from "react-icons/lu";
import { Dialog } from "../../../dialog";
import { toaster } from "../../../../blocks/toaster";
import { showErrorToast } from "../../../errors";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project";
import { api } from "../../../trace-api";
import {
  buildTraceEditPatch,
  summarizeTraceEdit,
  useAnnotationSessionStore,
  useDrawerStore,
  useFocusSectionStore,
  useTraceEditStore,
} from "../../../../../index";
import { exitTraceEditMode } from "../../utils/trace-edit-mode";

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
    parts.push(`${changedFields} field${changedFields === 1 ? "" : "s"} changed`);
  }
  if (deletedSpans > 0) {
    parts.push(`${deletedSpans} span${deletedSpans === 1 ? "" : "s"} deleted`);
  }
  return parts.length > 0 ? parts.join(", ") : "No changes yet";
}

/**
 * The comments written in this pass, reported apart from the correction because
 * they are on a different clock: each one was saved as it was written, so none
 * of them is waiting on Save and none of them is at risk from Discard. A pass
 * that has produced none says nothing rather than reporting a zero.
 */
function CommentsWritten({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Text textStyle="xs" color="fg.subtle">
      {count} comment{count === 1 ? "" : "s"} saved
    </Text>
  );
}

/** The draft the bar summarizes and, on Save, writes as the correction. */
function useTraceEditDraft() {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const spanDrafts = useTraceEditStore((s) => s.spanDrafts);
  const deletedSpanIds = useTraceEditStore((s) => s.deletedSpanIds);
  const restoredSpanIds = useTraceEditStore((s) => s.restoredSpanIds);
  const traceInputDraft = useTraceEditStore((s) => s.traceInputDraft);
  const traceOutputDraft = useTraceEditStore((s) => s.traceOutputDraft);
  const traceMetadataDrafts = useTraceEditStore((s) => s.traceMetadataDrafts);

  return useMemo(
    () => ({
      basePatch,
      spanDrafts,
      deletedSpanIds,
      restoredSpanIds,
      traceInputDraft,
      traceOutputDraft,
      traceMetadataDrafts,
    }),
    [
      basePatch,
      spanDrafts,
      deletedSpanIds,
      restoredSpanIds,
      traceInputDraft,
      traceOutputDraft,
      traceMetadataDrafts,
    ],
  );
}

/**
 * Whether the session in the store is the one being saved. The drawer can move
 * to another trace at any moment, including while the stored correction is read
 * back, and what it leaves behind belongs to wherever it went: writing that
 * under this trace's id would attribute one trace's correction to another. The
 * refusal is logged, not shown, because nothing on screen asked for it.
 */
function holdsSessionFor(traceId: string): boolean {
  if (useTraceEditStore.getState().editingTraceId === traceId) return true;
  console.warn(
    "[traces-v2] trace edit save skipped: the session in the store belongs to another trace",
  );
  return false;
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
      toaster.create({ title: "Trace corrections saved", type: "success" });
      exitTraceEditMode();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't save trace corrections",
      }),
  });

  /**
   * Moves the session onto the correction as it stands right now. The one
   * adopted when editing started can be minutes old (a suggestion saved in
   * between writes the same record), and building on a stale one would drop
   * whatever was stored since. Two people saving in the same instant still
   * race, and the last write wins; a reviewer racing themselves does not.
   *
   * Answers false when the read failed, which is the one case where writing on
   * top of an unknown baseline would lose someone else's correction.
   */
  const rebaseOntoStoredCorrection = useCallback(
    async ({ projectId }: { projectId: string }) => {
      setIsRebasing(true);
      try {
        const latest = await utils.traceEditOverlay.getByTraceId.fetch(
          { projectId, traceId },
          { staleTime: 0 },
        );
        if (latest?.patch) {
          useTraceEditStore
            .getState()
            .rebaseBasePatch({ traceId, basePatch: latest.patch });
        }
        return true;
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't save trace corrections",
        });
        return false;
      } finally {
        setIsRebasing(false);
      }
    },
    [traceId, utils],
  );

  const save = useCallback(async () => {
    if (!project) return;
    if (!holdsSessionFor(traceId)) return;
    if (!(await rebaseOntoStoredCorrection({ projectId: project.id }))) return;
    // The read above yields, so the drawer can move while it is in flight and
    // the session has to be claimed again before anything is written.
    if (!holdsSessionFor(traceId)) return;

    upsert.mutate({
      projectId: project.id,
      traceId,
      patch: buildTraceEditPatch(useTraceEditStore.getState()),
    });
  }, [project, rebaseOntoStoredCorrection, traceId, upsert]);

  return { save, isSaving: upsert.isPending || isRebasing };
}

/**
 * The strip that says the trace is being annotated, what the pass has produced
 * so far, and how to finish. Rendered between the header and the panes for as
 * long as annotation mode is on.
 *
 * The two halves of the pass are reported apart because they are saved apart:
 * the correction is a draft this bar writes, and every comment is already
 * stored.
 */
export function EditModeBar({ traceId }: { traceId: string }) {
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const commentsSaved = useAnnotationSessionStore((s) => s.savedCount);
  // The count belongs to this pass, so it starts over each time one does.
  useEffect(() => {
    useAnnotationSessionStore.getState().start();
  }, []);
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
          Annotation mode
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {describeEdit(summary)}
        </Text>
        <CommentsWritten count={commentsSaved} />
        <Button size="xs" variant="ghost" onClick={handleJumpToTraceOutput} gap={1.5}>
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

/**
 * The one question asked for every way of leaving an unsaved correction.
 *
 * It names the corrections outright. A reviewer who has just left eight
 * comments and reads "discard your changes" has no way of knowing the comments
 * are not what is at risk, so the prompt says so.
 */
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
          <Dialog.Title>Discard trace corrections?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text textStyle="sm" color="fg.muted">
            Your corrections to this trace have not been saved. Comments are saved as you
            write them and are not discarded.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button size="sm" variant="outline" onClick={onKeepEditing}>
            Keep annotating
          </Button>
          <Button size="sm" colorPalette="red" onClick={onDiscard}>
            Discard corrections
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
