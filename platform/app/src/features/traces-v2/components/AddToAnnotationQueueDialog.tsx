import { useDisclosure, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { AddAnnotationQueueDrawer } from "~/components/AddAnnotationQueueDrawer";
import { AddParticipants } from "~/components/traces/AddParticipants";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

interface AddToAnnotationQueueDialogProps {
  open: boolean;
  onClose: () => void;
  /** Traces to queue. One from the drawer, many from the selection bar. */
  traceIds: string[];
}

/**
 * Sends traces to people or annotation queues for review. Shared by every
 * surface that can hand traces over: the trace table's selection bar and the
 * trace drawer's overflow menu.
 *
 * Spec: specs/traces-v2/bulk-actions.feature ("Send selected traces to an
 * annotation queue").
 */
export function AddToAnnotationQueueDialog({
  open,
  onClose,
  traceIds,
}: AddToAnnotationQueueDialogProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const utils = api.useUtils();
  const newQueueDrawer = useDisclosure();
  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    [],
  );

  const createQueueItem = api.annotation.createQueueItem.useMutation({
    onSuccess: () => {
      // The sidebar badges and the queue listing all count pending work, so
      // every one of them is stale the moment items land.
      void utils.annotation.getPendingItemsCount.invalidate();
      void utils.annotation.getAssignedItemsCount.invalidate();
      void utils.annotation.getQueueItemsCounts.invalidate();
      void utils.annotation.getOptimizedAnnotationQueues.invalidate();

      setAnnotators([]);
      onClose();

      toaster.create({
        title: "Added to annotation queue",
        description: `${traceIds.length} ${
          traceIds.length === 1 ? "trace" : "traces"
        } sent for annotation`,
        type: "success",
        meta: { closable: true },
        action: {
          label: "View queues",
          onClick: () => {
            void router.push(`/${project?.slug}/annotations`);
          },
        },
      });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't add to annotation queue",
      }),
  });

  const sendToQueue = () => {
    if (!project) return;
    createQueueItem.mutate({
      projectId: project.id,
      traceIds,
      annotators: annotators.map((annotator) => annotator.id),
    });
  };

  if (!open) return null;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header paddingBottom={0}>
            <VStack align="start" gap={1}>
              <Dialog.Title>Add to annotation queue</Dialog.Title>
              <Dialog.Description color="fg.muted" fontSize="sm">
                Send the selected traces to people or queues for annotation
              </Dialog.Description>
            </VStack>
          </Dialog.Header>
          <Dialog.Body paddingTop={5} paddingBottom={6}>
            <AddParticipants
              annotators={annotators}
              setAnnotators={setAnnotators}
              queueDrawerOpen={newQueueDrawer}
              sendToQueue={sendToQueue}
              isLoading={createQueueItem.isLoading}
            />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      {newQueueDrawer.open && (
        <AddAnnotationQueueDrawer
          open={newQueueDrawer.open}
          onClose={newQueueDrawer.onClose}
          onOverlayClick={newQueueDrawer.onClose}
        />
      )}
    </>
  );
}
