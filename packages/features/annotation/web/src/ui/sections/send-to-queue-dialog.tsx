/**
 * Sends traces to people or annotation queues for review.
 *
 * A FAMILY-LOCAL COPY of
 * `platform/app/src/features/traces-v2/components/AddToAnnotationQueueDialog`,
 * which keeps two callers on the trace surfaces — the trace table's bulk bar
 * and the trace drawer's overflow menu — and so did not travel.
 *
 * NARROWED IN ONE PLACE: the platform dialog mounts the queue-creation drawer
 * itself, through `useDisclosure`. Here "Add New Queue" writes this family's own
 * `?queue-editor=new` address and the screen above mounts the editor, so the
 * dialog does not have to know that a queue can be created at all.
 *
 * WHERE THE CONFIRMATION TAKES THE SENDER is not a detail: sending to one queue
 * lands on that queue, sending only to yourself lands on your own inbox, and
 * anything wider has no single destination and lands on the queue listing.
 *
 * Spec: specs/traces-v2/bulk-actions.feature ("Send selected traces to an
 * annotation queue"), packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { useState } from "react";
import { annotationApi } from "../../behavior/annotation-api";
import type { AnnotationSuccessNotice } from "../../model/annotation-host";
import { QueueParticipants, type QueueParticipant } from "../blocks/queue-participants";

const QUEUE_PREFIX = "queue-";
const USER_PREFIX = "user-";

/** Where the confirmation takes the sender, and what the link says. */
export function queuedDestination({
  annotators,
  projectSlug,
  sessionUserId,
  queueSlugById,
}: {
  annotators: readonly QueueParticipant[];
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
    if (slug) return { label: "View queue", href: `/${projectSlug}/annotations/${slug}` };
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
export function sentDescription({
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

export function SendToQueueDialog({
  projectId,
  projectSlug,
  organizationId,
  currentUserId,
  traceIds,
  initialAnnotators,
  intent = "add",
  onClose,
  onQueued,
  onCreateQueue,
  onSucceeded,
  onFailed,
  navigate,
}: {
  projectId: string | undefined;
  projectSlug: string | undefined;
  organizationId: string | undefined;
  currentUserId: string | undefined;
  /** Traces to queue. One from a row, many from the selection bar. */
  traceIds: string[];
  /**
   * Who the picker starts on, read when the dialog mounts. A queue page opens
   * it on its own queue, so moving traces elsewhere is an edit of the
   * membership they already have rather than a retype of it.
   */
  initialAnnotators?: QueueParticipant[];
  /**
   * What the sender is doing, so the dialog's words match the button that
   * opened it: adding queues the traces somewhere new, moving edits the
   * membership they already have.
   */
  intent?: "add" | "move";
  onClose: () => void;
  /** Who the traces ended up queued for, once the send went through. */
  onQueued?: (annotatorIds: string[]) => void;
  onCreateQueue: () => void;
  onSucceeded: (notice: AnnotationSuccessNotice) => void;
  onFailed: (error: unknown) => void;
  /** Follows the confirmation's own link, which is what the toast action does. */
  navigate: (to: string) => void;
}) {
  const [annotators, setAnnotators] = useState<QueueParticipant[]>(initialAnnotators ?? []);

  // The picker reads the same query, so this shares its cache rather than
  // costing a second round trip.
  const queues = annotationApi.annotation.getQueues.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const organization = annotationApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );

  const utils = annotationApi.useUtils();
  const send = annotationApi.annotation.createQueueItem.useMutation({
    onSuccess: ({ created, skipped }) => {
      // The sidebar badges and the queue listing all count pending work, so
      // every one of them is stale the moment items land.
      void utils.annotation.getPendingItemsCount.invalidate();
      void utils.annotation.getAssignedItemsCount.invalidate();
      void utils.annotation.getQueueItemsCounts.invalidate();
      void utils.annotation.getOptimizedAnnotationQueues.invalidate();

      const destination = queuedDestination({
        annotators,
        projectSlug,
        sessionUserId: currentUserId,
        queueSlugById: new Map((queues.data ?? []).map((queue) => [queue.id, queue.slug])),
      });

      setAnnotators([]);
      onClose();
      onQueued?.(annotators.map((annotator) => annotator.id));
      onSucceeded({
        title: "Added to annotation queue",
        description: sentDescription({ created, skipped }),
        action: {
          label: destination.label,
          perform: () => navigate(destination.href),
        },
      });
    },
    onError: onFailed,
  });

  return (
    <Dialog.Root open onOpenChange={(details) => !details.open && onClose()}>
      <Dialog.Content>
        <Dialog.CloseTrigger />
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
        <Dialog.Body paddingTop={5} paddingBottom={6}>
          <QueueParticipants
            annotators={annotators}
            setAnnotators={setAnnotators}
            queues={queues.data ?? []}
            members={organization.data?.members ?? []}
            onCreateQueue={onCreateQueue}
            isSending={send.isPending}
            onSend={() => {
              if (!projectId) return;
              send.mutate({
                projectId,
                traceIds,
                annotators: annotators.map((annotator) => annotator.id),
              });
            }}
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
