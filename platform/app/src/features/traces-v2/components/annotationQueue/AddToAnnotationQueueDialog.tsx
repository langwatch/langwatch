import { VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { AddAnnotationQueueDrawer } from "~/components/AddAnnotationQueueDrawer";
import { AddParticipants } from "~/components/traces/AddParticipants";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface AddToAnnotationQueueDialogProps {
  open: boolean;
  onClose: () => void;
  /** Traces to queue. One from the drawer, many from the selection bar. */
  traceIds: string[];
}

const showQueuedToast = ({
  count,
  projectSlug,
}: {
  count: number;
  projectSlug: string;
}) =>
  toaster.create({
    title:
      count === 1
        ? "Trace added to annotation queue"
        : `${count} traces added to annotation queue`,
    description: (
      <Link href={`/${projectSlug}/annotations/`} textDecoration="underline">
        View Queues
      </Link>
    ),
    type: "success",
    meta: { closable: true },
  });

/**
 * Hands traces to a teammate or an annotation queue. Shared by the selection
 * action bar and the trace drawer's header.
 *
 * The "Add New Queue" sub-flow renders AddAnnotationQueueDrawer inline with
 * local state, NOT via the drawer registry: the registry is one-drawer-at-a-
 * time through the `drawer.open` URL param, so routing through it from inside
 * the trace drawer would close that drawer and destroy this dialog's picks.
 *
 * Spec: specs/traces-v2/annotation-queue-actions.feature
 */
export function AddToAnnotationQueueDialog({
  open,
  onClose,
  traceIds,
}: AddToAnnotationQueueDialogProps) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const queueItem = api.annotation.createQueueItem.useMutation();

  const handleClose = useCallback(() => {
    setAnnotators([]);
    onClose();
  }, [onClose]);

  const sendToQueue = useCallback(() => {
    if (!project) return;
    queueItem.mutate(
      {
        projectId: project.id,
        traceIds,
        annotators: annotators.map((annotator) => annotator.id),
      },
      {
        onSuccess: () => {
          // The sidebar carries pending / assigned / per-queue counts.
          void utils.annotation.getPendingItemsCount.invalidate();
          void utils.annotation.getAssignedItemsCount.invalidate();
          void utils.annotation.getQueueItemsCounts.invalidate();

          setAnnotators([]);
          onClose();
          showQueuedToast({
            count: traceIds.length,
            projectSlug: project.slug,
          });
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to add to annotation queue",
            description: error.message,
            type: "error",
          });
        },
      },
    );
  }, [queueItem, project, traceIds, annotators, utils, onClose]);

  return (
    <>
      <Dialog.Root
        // Fully closed (not display:none) while the new-queue drawer is up:
        // an open modal dialog marks the rest of the body inert, which would
        // make the drawer unclickable. The picks live in this component's
        // state, so they survive the round trip.
        open={open && !queueDrawerOpen}
        onOpenChange={(e) => !e.open && handleClose()}
        size="sm"
        // The picker loads teammates and queues on mount. Keep it out of the
        // tree until the dialog is actually opened.
        lazyMount
        unmountOnExit
      >
        <Dialog.Content
          background="bg.surface/80"
          backdropFilter="blur(25px)"
          borderRadius="lg"
          onClick={(e) => e.stopPropagation()}
        >
          <Dialog.CloseTrigger />
          <Dialog.Header paddingBottom={0}>
            <VStack align="start" gap={1}>
              <Dialog.Title>Add to annotation queue</Dialog.Title>
              <Dialog.Description color="fg.muted" fontSize="sm">
                Send {traceIds.length === 1 ? "this trace" : "these traces"} to
                a teammate or a queue for review.
              </Dialog.Description>
            </VStack>
          </Dialog.Header>

          <Dialog.Body paddingTop={5} paddingBottom={6}>
            <AddParticipants
              annotators={annotators}
              setAnnotators={setAnnotators}
              queueDrawerOpen={{
                onOpen: () => setQueueDrawerOpen(true),
                onClose: () => setQueueDrawerOpen(false),
              }}
              sendToQueue={sendToQueue}
              isLoading={queueItem.isLoading}
            />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      {queueDrawerOpen && (
        <AddAnnotationQueueDrawer
          onClose={() => setQueueDrawerOpen(false)}
          onOverlayClick={() => setQueueDrawerOpen(false)}
        />
      )}
    </>
  );
}
