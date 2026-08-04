import { Button, HStack, Icon, Spinner, Text } from "@chakra-ui/react";
import { useCallback, useState } from "react";
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

/**
 * The strip that says the drawer is being edited, what the correction changes
 * so far, and how to finish. Rendered between the header and the panes for as
 * long as edit mode is on.
 */
export function EditModeBar({ traceId }: { traceId: string }) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // Something else already asked to leave the trace (closing the drawer,
  // opening another one) and is waiting on the same decision, so both use one
  // dialog and one set of words.
  const pendingExit = useTraceEditStore((s) => s.pendingExit);
  const clearPendingExit = useTraceEditStore((s) => s.clearPendingExit);
  const confirmOpen = cancelConfirmOpen || pendingExit !== null;

  const basePatch = useTraceEditStore((s) => s.basePatch);
  const spanDrafts = useTraceEditStore((s) => s.spanDrafts);
  const deletedSpanIds = useTraceEditStore((s) => s.deletedSpanIds);
  const restoredSpanIds = useTraceEditStore((s) => s.restoredSpanIds);
  const traceOutputDraft = useTraceEditStore((s) => s.traceOutputDraft);
  const setViewModeTransient = useDrawerStore((s) => s.setViewModeTransient);
  const requestFocusSection = useFocusSectionStore((s) => s.request);

  const draftState = {
    basePatch,
    spanDrafts,
    deletedSpanIds,
    restoredSpanIds,
    traceOutputDraft,
  };
  const summary = summarizeTraceEdit(draftState);
  const isDirty = summary.changedFields > 0 || summary.deletedSpans > 0;

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

  const handleSave = useCallback(() => {
    if (!project) return;
    upsert.mutate({
      projectId: project.id,
      traceId,
      patch: buildTraceEditPatch({
        basePatch,
        spanDrafts,
        deletedSpanIds,
        restoredSpanIds,
        traceOutputDraft,
      }),
    });
  }, [
    project,
    traceId,
    upsert,
    basePatch,
    spanDrafts,
    deletedSpanIds,
    restoredSpanIds,
    traceOutputDraft,
  ]);

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
            disabled={!isDirty || upsert.isLoading}
            gap={1.5}
          >
            {upsert.isLoading && <Spinner size="xs" />}
            Save
          </Button>
        </HStack>
      </HStack>

      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(e) => {
          if (!e.open) handleKeepEditing();
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
            <Button size="sm" variant="outline" onClick={handleKeepEditing}>
              Keep editing
            </Button>
            <Button size="sm" colorPalette="red" onClick={handleDiscard}>
              Discard changes
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
