/**
 * The reviewer's own queue, walked one item at a time: the item's conversation
 * as trace lends it, the bar beneath, and the end of the queue as a state.
 * Behaviour is main's my-queue page; see modules/annotation/specs.
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import { sessionTraceIds, useAnnotationQueueSessionStore } from "@langwatch/trace-browser-kit";
import { useCallback, useEffect, useMemo, useState } from "react";

import { annotationApi } from "../../behavior/annotation-api.ts";
import { AnnotationQueueConversation } from "../../behavior/lent-trace.tsx";
import { useAnnotationQueueWalk } from "../../behavior/use-annotation-queue-walk.ts";
import { useShowErrorToast } from "../../behavior/use-error-toast.ts";
import { useQueueEnding } from "../../behavior/use-queue-ending.ts";
import { useAnnotationHost } from "../../model/annotation-host.ts";
import { queueItemHref, readConversationId } from "../../model/annotation-queue-walk.ts";
import { EndSessionDialog } from "../blocks/end-session-dialog.tsx";
import { UnavailableTraceCard } from "../blocks/unavailable-trace-card.tsx";
import { TasksDone } from "../elements/tasks-done-icon.tsx";
import { AnnotationQueueBar } from "./annotation-queue-bar.tsx";
import AnnotationsLayout from "./annotation-queue-layout.tsx";

export function AnnotationQueueWalker() {
  const host = useAnnotationHost();
  const queueItem = host.route().query["queue-item"];
  const {
    item: currentQueueItem,
    position,
    total,
    previousItemId,
    nextItemId,
    queueFinished: nothingLeftToReview,
    queueLoading,
    stepIsStale,
  } = useAnnotationQueueWalk({ queueItemId: queueItem });
  const project = host.project();
  const utils = annotationApi.useUtils();
  const showErrorToast = useShowErrorToast();

  const refetchQueueItems = useCallback(async () => {
    await Promise.all([
      utils.annotation.getQueueWalkStep.invalidate(),
      utils.annotation.getPendingItemsCount.invalidate(),
      utils.annotation.getAssignedItemsCount.invalidate(),
      utils.annotation.getQueueItemsCounts.invalidate(),
    ]);
  }, [utils]);

  const currentTraceId = currentQueueItem?.trace?.trace_id ?? currentQueueItem?.traceId ?? "";
  const conversationId = readConversationId(currentQueueItem?.trace?.metadata);

  // ── The sitting: which traces to keep lives in the browser while the queue is open.
  const setSessionActive = useAnnotationQueueSessionStore((state) => state.setActive);
  const noteWalked = useAnnotationQueueSessionStore((state) => state.noteWalked);
  const sessionMarks = useAnnotationQueueSessionStore((state) => state.marks);
  const sessionIds = useMemo(() => sessionTraceIds(sessionMarks), [sessionMarks]);
  // Off at the start of every sitting, answered once for the whole walk.
  const [handoffWanted, setHandoffWanted] = useState(false);

  useEffect(() => () => setSessionActive(false), [setSessionActive]);

  // An item whose trace no longer resolves is walkable but is not work.
  const queueFinished = !queueLoading && nothingLeftToReview;

  useEffect(() => {
    if (!queueFinished) setSessionActive(true);
  }, [queueFinished, setSessionActive]);

  const walkedTraceId = currentQueueItem?.trace?.trace_id;
  useEffect(() => {
    if (walkedTraceId) noteWalked(walkedTraceId);
  }, [walkedTraceId, noteWalked]);

  const openHandoffDrawer = useCallback(
    (traceIds: string[]) => host.openDrawer("addDatasetRecord", { selectedTraceIds: traceIds }),
    [host],
  );

  const currentQueueItemId = currentQueueItem?.id;
  const projectId = project?.id;
  const projectSlug = project?.slug;
  // Moving on reads the step in hand, so it waits while that step is the one left behind.
  const advanceToNextItem = useCallback(() => {
    if (stepIsStale) return;
    host.navigate(queueItemHref({ projectSlug, queueItemId: nextItemId ?? undefined }));
  }, [host, projectSlug, nextItemId, stepIsStale]);

  const markQueueItemDone = annotationApi.annotation.markQueueItemDone.useMutation();
  const markDone = markQueueItemDone.mutate;
  const finishCurrentItem = useCallback(
    (onFinished?: () => void) => {
      if (!projectId || !currentQueueItemId) return;
      markDone(
        { queueItemId: currentQueueItemId, projectId },
        {
          onSuccess: async () => {
            await refetchQueueItems();
            onFinished?.();
          },
          onError: (error) =>
            showErrorToast({ error, fallbackTitle: "Couldn't mark this item as done" }),
        },
      );
    },
    [projectId, currentQueueItemId, markDone, refetchQueueItems, showErrorToast],
  );
  const recordItemDone = useCallback(() => finishCurrentItem(), [finishCurrentItem]);

  const { ending, finishLastItem, confirmEndWithoutDataset, keepSession } = useQueueEnding({
    handoffWanted,
    traceIds: sessionIds,
    isHandoffDrawerOpen: host.isDrawerOpen("addDatasetRecord"),
    openHandoffDrawer,
    recordItemDone,
  });

  const deleteQueueItems = annotationApi.annotation.deleteQueueItems.useMutation();
  const removeQueueItems = deleteQueueItems.mutate;
  const removeCurrentItemFromQueue = useCallback(() => {
    // The card offering this is still drawn from the item left behind.
    if (stepIsStale) return;
    if (!projectId || !currentQueueItemId) return;
    removeQueueItems(
      { projectId, queueItemIds: [currentQueueItemId] },
      {
        onSuccess: async () => {
          advanceToNextItem();
          await refetchQueueItems();
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't remove this item from your queue" }),
      },
    );
  }, [
    projectId,
    currentQueueItemId,
    removeQueueItems,
    advanceToNextItem,
    refetchQueueItems,
    stepIsStale,
    showErrorToast,
  ]);

  if (queueLoading) return <AnnotationsLayout />;

  if (ending === "done" || queueFinished) {
    return (
      <AnnotationsLayout>
        <AllTasksCompleteScreen />
      </AnnotationsLayout>
    );
  }

  return (
    <>
      <VStack height="100%" width="full" gap={0} alignItems="stretch" position="relative" flex="1">
        {/* The conversation owns the scroll; the bottom padding is the bar's clearance. */}
        <Box
          flex="1"
          minHeight={0}
          display="flex"
          flexDirection="column"
          overflow="hidden"
          position="relative"
          paddingBottom={currentQueueItem ? "100px" : 0}
        >
          <WalkedItemBody
            isTraceGone={!!currentQueueItem && !currentQueueItem.trace}
            traceId={currentTraceId}
            conversationId={conversationId}
            stepIsStale={stepIsStale}
            canRemove={host.hasPermission("annotations:update")}
            canSkip={!!nextItemId}
            isRemoving={deleteQueueItems.isPending}
            onRemove={removeCurrentItemFromQueue}
            onSkip={advanceToNextItem}
          />
        </Box>
        {currentQueueItem && (
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            width="full"
            backgroundColor="bg.panel"
            borderTop="1px solid"
            borderColor="border"
            zIndex={10}
          >
            <AnnotationQueueBar
              // A fresh bar per item, so it never arrives held from the step before.
              key={currentQueueItem.id}
              currentQueueItem={currentQueueItem}
              position={position}
              total={total}
              previousItemId={previousItemId}
              nextItemId={nextItemId}
              isTraceAvailable={!!currentQueueItem.trace}
              isFinishing={markQueueItemDone.isPending}
              stepIsStale={stepIsStale}
              sessionCount={sessionIds.length}
              handoffWanted={handoffWanted}
              onHandoffWantedChange={setHandoffWanted}
              onFinishItem={finishCurrentItem}
              onFinishQueue={finishLastItem}
            />
          </Box>
        )}
      </VStack>
      <EndSessionDialog
        open={ending === "asking"}
        onConfirm={confirmEndWithoutDataset}
        onCancel={keepSession}
      />
    </>
  );
}

/** The item's conversation as trace lends it, or the card saying its trace is gone. */
function WalkedItemBody({
  isTraceGone,
  traceId,
  conversationId,
  stepIsStale,
  canRemove,
  canSkip,
  isRemoving,
  onRemove,
  onSkip,
}: {
  isTraceGone: boolean;
  traceId: string;
  conversationId: string | null;
  stepIsStale: boolean;
  canRemove: boolean;
  canSkip: boolean;
  isRemoving: boolean;
  onRemove: () => void;
  onSkip: () => void;
}) {
  if (isTraceGone) {
    return (
      <UnavailableTraceCard
        canRemove={canRemove}
        canSkip={canSkip}
        isRemoving={isRemoving}
        isStale={stepIsStale}
        onRemove={onRemove}
        onSkip={onSkip}
      />
    );
  }

  // While the step in hand is the item left behind, the thread is held:
  // dimmed, pointer-inert, keyboard-inert and announced as busy.
  return (
    <Box
      flex="1"
      minHeight={0}
      display="flex"
      flexDirection="column"
      opacity={stepIsStale ? 0.6 : 1}
      transition="opacity 150ms ease-out"
      pointerEvents={stepIsStale ? "none" : "auto"}
      aria-busy={stepIsStale ? true : undefined}
      inert={stepIsStale || undefined}
    >
      {traceId && <AnnotationQueueConversation traceId={traceId} conversationId={conversationId} />}
    </Box>
  );
}

/** What crowns a walk once the sitting has been answered for. */
function AllTasksCompleteScreen() {
  return (
    <VStack height="100%" width="full" justify="center" backgroundColor="bg.muted">
      <TasksDone />
      <Text fontSize="xl" fontWeight="500">
        All tasks complete
      </Text>
      <Text>Nice work!</Text>
    </VStack>
  );
}

export default AnnotationQueueWalker;
