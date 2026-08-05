import { VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { AddParticipants } from "~/components/traces/AddParticipants";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface AddToAnnotationQueueDialogProps {
  open: boolean;
  onClose: () => void;
  /** Traces to queue. One from the drawer, many from the selection bar. */
  traceIds: string[];
}

/**
 * Hands traces to a teammate or an annotation queue. Shared by the selection
 * action bar and the trace drawer's overflow menu.
 *
 * Spec: specs/traces-v2/annotation-queue-actions.feature
 */
export function AddToAnnotationQueueDialog({
  open,
  onClose,
  traceIds,
}: AddToAnnotationQueueDialogProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, drawerOpen } = useDrawer();
  const utils = api.useUtils();
  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    [],
  );
  const queueItem = api.annotation.createQueueItem.useMutation();

  const sendToQueue = useCallback(() => {
    queueItem.mutate(
      {
        projectId: project?.id ?? "",
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
          toaster.create({
            title: "Trace added to annotation queue",
            description: (
              <Link
                href={`/${project?.slug}/annotations/`}
                textDecoration="underline"
              >
                View Queues
              </Link>
            ),
            type: "success",
            meta: { closable: true },
          });
        },
      },
    );
  }, [queueItem, project, traceIds, annotators, utils, onClose]);

  const handleOpenQueueDrawer = useCallback(() => {
    openDrawer("addAnnotationQueue", undefined);
  }, [openDrawer]);

  // The new-queue drawer opens on top of this dialog. Step out of its way
  // rather than closing, so the picks made so far survive.
  const queueDrawerShowing = drawerOpen("addAnnotationQueue");

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      size="sm"
      // The picker loads teammates and queues on mount. Keep it out of the
      // tree until the dialog is actually opened.
      lazyMount
      unmountOnExit
    >
      <Dialog.Content
        display={queueDrawerShowing ? "none" : undefined}
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
              Send {traceIds.length === 1 ? "this trace" : "these traces"} to a
              teammate or a queue for review.
            </Dialog.Description>
          </VStack>
        </Dialog.Header>

        <Dialog.Body paddingTop={5} paddingBottom={6}>
          <AddParticipants
            annotators={annotators}
            setAnnotators={setAnnotators}
            queueDrawerOpen={{
              onOpen: handleOpenQueueDrawer,
              onClose: () => {
                // The drawer closes itself; nothing to undo here.
              },
            }}
            sendToQueue={sendToQueue}
            isLoading={queueItem.isLoading}
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
