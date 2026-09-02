import { useDisclosure, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { AddAnnotationQueueDrawer } from "../../components/AddAnnotationQueueDrawer";
import { AddParticipants } from "../../components/traces/AddParticipants";
import { Dialog } from "../../components/ui/dialog";
import { toaster } from "../../components/ui/toaster";
import { showErrorToast } from "../../features/errors";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api } from "../../behavior/trace-api";
import { useSession } from "../../behavior/auth-session";
import { useRouter } from "../../behavior/next-router";

type Annotator = { id: string; name: string };

interface AddToAnnotationQueueDialogProps {
  open: boolean;
  onClose: () => void;
  /** Traces to queue. One from the drawer, many from the selection bar. */
  traceIds: string[];
  /**
   * Who the picker starts on, read when the dialog mounts. A queue page opens
   * it on its own queue, so moving traces elsewhere is an edit of the
   * membership they already have rather than a retype of it.
   */
  initialAnnotators?: Annotator[];
  /** Who the traces ended up queued for, once the send went through. */
  onQueued?: (annotatorIds: string[]) => void;
  /**
   * What the sender is doing, so the dialog's words match the button that
   * opened it: adding queues the traces somewhere new, moving edits the
   * membership they already have.
   */
  intent?: "add" | "move";
}

const QUEUE_PREFIX = "queue-";
const USER_PREFIX = "user-";

/**
 * Where the confirmation takes the sender. Sending to one queue lands on that
 * queue; sending only to yourself lands on your own inbox; anything wider has
 * no single destination, so it lands on the queue listing.
 */
function destinationFor({
  annotators,
  projectSlug,
  sessionUserId,
  queueSlugById,
}: {
  annotators: Annotator[];
  projectSlug: string | undefined;
  sessionUserId: string | undefined;
  queueSlugById: Map<string, string>;
}): { label: string; href: string } {
  const queueIds = annotators
    .filter((annotator) => annotator.id.startsWith(QUEUE_PREFIX))
    .map((annotator) => annotator.id.slice(QUEUE_PREFIX.length));
  const userIds = annotators
    .filter((annotator) => annotator.id.startsWith(USER_PREFIX))
    .map((annotator) => annotator.id.slice(USER_PREFIX.length));

  if (queueIds.length === 1 && userIds.length === 0) {
    const slug = queueSlugById.get(queueIds[0]!);
    if (slug) {
      return {
        label: "View queue",
        href: `/${projectSlug}/annotations/${slug}`,
      };
    }
  }

  if (
    userIds.length === 1 &&
    queueIds.length === 0 &&
    !!sessionUserId &&
    userIds[0] === sessionUserId
  ) {
    return { label: "View inbox", href: `/${projectSlug}/annotations/me` };
  }

  return { label: "View queues", href: `/${projectSlug}/annotations` };
}

/** What actually happened, in the sender's terms. */
function sentDescription({
  created,
  skipped,
}: {
  created: number;
  skipped: number;
}): string {
  const sent = `${created} ${created === 1 ? "trace" : "traces"} sent for annotation`;
  if (skipped === 0) return sent;
  const reason =
    skipped === 1
      ? "1 skipped because its trace no longer exists"
      : `${skipped} skipped because their traces no longer exist`;
  return `${sent}. ${reason}`;
}

/** The success toast, with a way into where the traces landed. */
function toastQueued({
  created,
  skipped,
  destination,
  onView,
}: {
  created: number;
  skipped: number;
  destination: { label: string; href: string };
  onView: (href: string) => void;
}) {
  toaster.create({
    title: "Added to annotation queue",
    description: sentDescription({ created, skipped }),
    type: "success",
    action: {
      label: destination.label,
      onClick: () => onView(destination.href),
    },
  });
}

/** The dialog's words, keyed to what the sender is doing. */
function QueueDialogHeader({ intent }: { intent: "add" | "move" }) {
  return (
    <Dialog.Header paddingBottom={0}>
      <VStack align="start" gap={1}>
        <Dialog.Title>
          {intent === "move" ? "Move to queue" : "Add to annotation queue"}
        </Dialog.Title>
        <Dialog.Description color="fg.muted" fontSize="sm">
          {intent === "move"
            ? "Change which people or queues these traces are queued for"
            : "Send the selected traces to people or queues for annotation"}
        </Dialog.Description>
      </VStack>
    </Dialog.Header>
  );
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
  initialAnnotators,
  onQueued,
  intent = "add",
}: AddToAnnotationQueueDialogProps) {
  const { project } = useOrganizationTeamProject();
  const { data: session } = useSession();
  const router = useRouter();
  const utils = api.useUtils();
  const newQueueDrawer = useDisclosure();
  const [annotators, setAnnotators] = useState<Annotator[]>(initialAnnotators ?? []);

  // The picker reads the same query, so this shares its cache rather than
  // costing a second round trip.
  const queues = api.annotation.getQueues.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const createQueueItem = api.annotation.createQueueItem.useMutation({
    onSuccess: ({ created, skipped }) => {
      // The sidebar badges and the queue listing all count pending work, so
      // every one of them is stale the moment items land.
      void utils.annotation.getPendingItemsCount.invalidate();
      void utils.annotation.getAssignedItemsCount.invalidate();
      void utils.annotation.getQueueItemsCounts.invalidate();
      void utils.annotation.getOptimizedAnnotationQueues.invalidate();

      const destination = destinationFor({
        annotators,
        projectSlug: project?.slug,
        sessionUserId: session?.user?.id,
        queueSlugById: new Map(
          (queues.data ?? []).map((queue) => [queue.id, queue.slug]),
        ),
      });

      setAnnotators([]);
      onClose();
      onQueued?.(annotators.map((annotator) => annotator.id));

      toastQueued({
        created,
        skipped,
        destination,
        onView: (href) => void router.push(href),
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
          <QueueDialogHeader intent={intent} />
          <Dialog.Body paddingTop={5} paddingBottom={6}>
            <AddParticipants
              annotators={annotators}
              setAnnotators={setAnnotators}
              queueDrawerOpen={newQueueDrawer}
              sendToQueue={sendToQueue}
              isLoading={createQueueItem.isPending}
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
