import { Box, Button, CodeBlock, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import AnnotationsLayout from "../../ui/sections/annotation-queue-layout";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Dialog } from "@langwatch/design-system/dialog";
import { IsolatedErrorBoundary } from "@langwatch/trace-web/components/ui/IsolatedErrorBoundary";
import { useShowErrorToast } from "../../behavior/use-error-toast";
import { ConversationView } from "@langwatch/trace-web/explorer/components/TraceDrawer/conversationView";
import {
  sessionTraceIds,
  useAnnotationQueueSessionStore,
  useShikiAdapter,
} from "@langwatch/trace-web";
import { useConversationTurns } from "@langwatch/trace-web/explorer/hooks/useConversationTurns";
import { legacyTraceToTurn } from "@langwatch/trace-web/explorer/utils/legacyTraceToTurn";
import { openTraceEditorFromConversation } from "@langwatch/trace-web/explorer/utils/traceEditMode";
import { useAnnotationQueues } from "../../behavior/use-annotation-queues";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api, type RouterOutputs } from "../../behavior/annotation-api";
import { useRouter } from "../../behavior/next-router";
import { TasksDone } from "../../ui/elements/tasks-done-icon";
import { QueueTraceHost } from "../../ui/sections/queue-trace-host";

type AssignedQueueItem =
  RouterOutputs["annotation"]["getOptimizedAnnotationQueues"]["assignedQueueItems"][number];

/** How long the queue bar waits after a route change before it reads settled. */
export const ROUTE_SETTLE_MS = 100;

/** What the reviewer is asked before the session ends with no dataset. */
export const END_SESSION_QUESTION =
  "Are you sure you want to end this annotation session without adding to a dataset?";

/**
 * The bar's hand-off switch, carrying what it would hand over. The count is a
 * decision aid, not decoration: the end of the queue should never surprise.
 */
const datasetToggleLabel = (sessionCount: number) => {
  if (sessionCount === 0) return "Add to dataset at the end";
  const traces = sessionCount === 1 ? "1 trace" : `${sessionCount} traces`;
  return `Add to dataset at the end (${traces})`;
};

/** A trace timestamp is only useful to the drawer when it is a real number. */
const partitionHint = (startedAt: unknown): number | null =>
  typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : null;

/** Where a queue item is read. One shape, so every way in agrees. */
const queueItemHref = ({
  projectSlug,
  queueItemId,
}: {
  projectSlug: string | undefined;
  queueItemId?: string;
}) =>
  queueItemId
    ? `/${projectSlug}/annotations/my-queue?queue-item=${queueItemId}`
    : `/${projectSlug}/annotations/my-queue`;

/**
 * How far the end of the walk has got.
 *
 * `walking` is a queue still being read, which is where the reviewer stays
 * until the last item is finished off. Choosing "Done" on it offers the
 * session's traces to a dataset (`handoff`) and then, if the reviewer closed
 * that offer, asks before the session ends without one (`asking`). Only `done`
 * celebrates, and only `done` finishes the item.
 */
type QueueEnding = "walking" | "handoff" | "asking" | "done";

/**
 * The end of the queue as a state rather than a race.
 *
 * The celebration is earned: it shows after the dataset add succeeds, or after
 * the reviewer confirms ending the session without one, and never under or
 * before the hand-off drawer. The last item is recorded as done at that same
 * moment, so a reviewer who backs out lands on an item that is still theirs.
 */
function useQueueEnding({
  handoffWanted,
  traceIds,
  isHandoffDrawerOpen,
  openHandoffDrawer,
  recordItemDone,
}: {
  /** Whether the bar's dataset toggle is on. */
  handoffWanted: boolean;
  /** The traces this sitting counted. */
  traceIds: string[];
  isHandoffDrawerOpen: boolean;
  openHandoffDrawer: (traceIds: string[]) => void;
  /** Marks the item the reviewer is finishing as done. */
  recordItemDone: () => void;
}) {
  const [ending, setEnding] = useState<QueueEnding>("walking");
  const noteHandoffOpened = useAnnotationQueueSessionStore((state) => state.noteHandoffOpened);
  const resetHandoff = useAnnotationQueueSessionStore((state) => state.resetHandoff);
  // The drawer is dismissed only once it has been seen open: the frame between
  // asking for it and the URL naming it would otherwise read as a dismissal.
  const drawerWasSeenOpen = useRef(false);

  const celebrate = useCallback(() => {
    recordItemDone();
    setEnding("done");
  }, [recordItemDone]);

  const finishLastItem = useCallback(() => {
    if (!handoffWanted || traceIds.length === 0) {
      celebrate();
      return;
    }
    drawerWasSeenOpen.current = false;
    noteHandoffOpened();
    openHandoffDrawer(traceIds);
    setEnding("handoff");
  }, [handoffWanted, traceIds, noteHandoffOpened, openHandoffDrawer, celebrate]);

  useHandoffOutcome({
    isOffered: ending === "handoff",
    isHandoffDrawerOpen,
    drawerWasSeenOpen,
    onAdded: celebrate,
    onDismissed: useCallback(() => setEnding("asking"), []),
  });

  return {
    ending,
    finishLastItem,
    confirmEndWithoutDataset: useCallback(() => {
      resetHandoff();
      celebrate();
    }, [resetHandoff, celebrate]),
    keepSession: useCallback(() => {
      resetHandoff();
      setEnding("walking");
    }, [resetHandoff]),
  };
}

/**
 * What became of the offer to hand the session's traces over: the records
 * landed, or the reviewer closed the drawer on it.
 */
function useHandoffOutcome({
  isOffered,
  isHandoffDrawerOpen,
  drawerWasSeenOpen,
  onAdded,
  onDismissed,
}: {
  isOffered: boolean;
  isHandoffDrawerOpen: boolean;
  drawerWasSeenOpen: { current: boolean };
  onAdded: () => void;
  onDismissed: () => void;
}) {
  const handoff = useAnnotationQueueSessionStore((state) => state.handoff);
  const setSessionActive = useAnnotationQueueSessionStore((state) => state.setActive);

  useEffect(() => {
    if (!isOffered) return;
    if (handoff === "added") {
      // The sitting's set is spent once it has become dataset records.
      setSessionActive(false);
      onAdded();
      return;
    }
    if (isHandoffDrawerOpen) {
      drawerWasSeenOpen.current = true;
      return;
    }
    if (drawerWasSeenOpen.current) onDismissed();
  }, [
    isOffered,
    handoff,
    isHandoffDrawerOpen,
    drawerWasSeenOpen,
    setSessionActive,
    onAdded,
    onDismissed,
  ]);
}

function QueueWalker() {
  const router = useRouter();
  const { "queue-item": queueItem } = router.query;
  // Only what is still waiting: this read resolves the trace behind every item
  // it returns, so widening it to a whole review history is a page load the
  // reviewer pays for on every visit.
  const { project, hasPermission } = useOrganizationTeamProject();
  // The paging arguments are the platform hook's own defaults, which it read
  // off the router; `allQueueItems` takes the paging off anyway, so they only
  // decide the shape of the request rather than what comes back.
  const { assignedQueueItems, queuesLoading } = useAnnotationQueues({
    projectId: project?.id,
    showQueueAndUser: true,
    allQueueItems: true,
    pageOffset: 0,
    pageSize: 25,
  });
  const queryClient = api.useUtils();
  const { openDrawer, drawerOpen } = useDrawer();

  const pendingQueueItems = useMemo(
    () => (assignedQueueItems ?? []).filter((item) => !item.doneAt),
    [assignedQueueItems],
  );

  // An item whose trace no longer resolves carries nothing to read, annotate or
  // finish. It stays walkable so the reviewer can clear it, but it is not work:
  // what is left to review is what decides whether the queue is finished, so one
  // unreadable item cannot hold the end of the queue hostage forever.
  const resolvablePendingItems = useMemo(
    () => pendingQueueItems.filter((item) => !!item.trace),
    [pendingQueueItems],
  );

  // Force re-render when items change by creating a key
  const queueItemsKey = useMemo(() => {
    return pendingQueueItems.map((item) => `${item.id}-${item.doneAt}`).join(",");
  }, [pendingQueueItems]);

  let currentQueueItem = pendingQueueItems.find((item) => item.id === queueItem);

  if (!currentQueueItem) {
    currentQueueItem = pendingQueueItems[0];
  }

  const refetchQueueItems = useCallback(async () => {
    // Four independent reads, so they go together: one queue action should not
    // cost four sequential round trips.
    await Promise.all([
      queryClient.annotation.getOptimizedAnnotationQueues.invalidate(),
      queryClient.annotation.getPendingItemsCount.invalidate(),
      queryClient.annotation.getAssignedItemsCount.invalidate(),
      queryClient.annotation.getQueueItemsCounts.invalidate(),
    ]);
  }, [queryClient]);

  const traceDetails = api.traces.getById.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: currentQueueItem?.trace?.trace_id ?? "",
    },
    {
      enabled: !!project?.id && !!currentQueueItem?.trace?.trace_id,
      refetchOnWindowFocus: false,
    },
  );

  // The queue read already resolves each item's trace, so the thread the item
  // belongs to is known without waiting on a second round trip.
  const currentTraceId = currentQueueItem?.trace?.trace_id ?? currentQueueItem?.traceId ?? "";
  const conversationId = currentQueueItem?.trace?.metadata?.thread_id ?? null;

  // The conversation only reads back 90 days, so a thread older than that
  // answers with no turns even though the item's own trace loaded. Reading it
  // as an empty conversation would hide the very turn the reviewer was sent
  // here for, so once the read has settled on nothing the trace is handed over
  // as the single turn instead.
  // The read keeps the previous thread's turns while the next one loads, so
  // `isPlaceholderData` is what tells "this thread holds nothing" apart from
  // "these turns belong to the item before this one".
  const conversationTurns = useConversationTurns(conversationId);
  const threadResolvedEmpty =
    !!conversationId &&
    !conversationTurns.isLoading &&
    !conversationTurns.isPlaceholderData &&
    (conversationTurns.data?.items.length ?? 0) === 0;

  // A trace that belongs to no thread has no conversation to query, so it is
  // handed over as the conversation's only turn.
  const fallbackTrace = traceDetails.data ?? currentQueueItem?.trace ?? null;
  const renderedConversationId = threadResolvedEmpty && fallbackTrace ? null : conversationId;
  const fallbackTurns = useMemo(
    () =>
      renderedConversationId || !fallbackTrace ? undefined : [legacyTraceToTurn(fallbackTrace)],
    [renderedConversationId, fallbackTrace],
  );

  // Picking another turn opens it over the queue, the same way the bar's
  // "Edit trace" does: the link states the whole intent and the drawer's URL
  // hydrator opens it, so the page never writes the drawer's own store.
  const openTurn = useCallback(
    ({ traceId, timestamp }: { traceId: string; timestamp: number }) => {
      const occurredAtMs = partitionHint(timestamp);
      openDrawer("traceV2Details", {
        traceId,
        ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
      });
    },
    [openDrawer],
  );

  const { colorMode } = useColorMode();
  // One Shiki adapter for the whole conversation, so the markdown view and
  // every code block inside it share a single highlighter.
  const shikiAdapter = useShikiAdapter(colorMode);

  // ── The sitting ───────────────────────────────────────────────────────
  // Which traces to keep is a decision about this sitting, so the set lives in
  // the browser for as long as the queue is open and is dropped on the way out.
  const setSessionActive = useAnnotationQueueSessionStore((state) => state.setActive);
  const noteWalked = useAnnotationQueueSessionStore((state) => state.noteWalked);
  const sessionMarks = useAnnotationQueueSessionStore((state) => state.marks);
  const sessionIds = useMemo(() => sessionTraceIds(sessionMarks), [sessionMarks]);
  // The hand-off is a decision, not a display: off at the start of every
  // sitting, and answered once for the whole walk rather than per item.
  const [handoffWanted, setHandoffWanted] = useState(false);

  useEffect(() => () => setSessionActive(false), [setSessionActive]);

  const queueFinished = !queuesLoading && resolvablePendingItems.length === 0;

  useEffect(() => {
    if (!queueFinished) setSessionActive(true);
  }, [queueFinished, setSessionActive]);

  // The queue sent the reviewer to this trace, so the sitting starts from it.
  // Only a trace that resolved: a queued trace nobody can read is nothing to
  // hand a dataset.
  const walkedTraceId = currentQueueItem?.trace?.trace_id;
  useEffect(() => {
    if (walkedTraceId) noteWalked(walkedTraceId);
  }, [walkedTraceId, noteWalked]);

  const openHandoffDrawer = useCallback(
    (traceIds: string[]) => openDrawer("addDatasetRecord", { selectedTraceIds: traceIds }),
    [openDrawer],
  );

  // Where "Skip" and a removal land: the next item still waiting, or the bare
  // queue when there is nothing after this one.
  const currentQueueItemId = currentQueueItem?.id;
  const nextPendingItemId = useMemo(() => {
    if (!currentQueueItemId) return undefined;
    const index = pendingQueueItems.findIndex((item) => item.id === currentQueueItemId);
    return pendingQueueItems[index + 1]?.id;
  }, [pendingQueueItems, currentQueueItemId]);

  const projectId = project?.id;
  const projectSlug = project?.slug;
  const advanceToNextItem = useCallback(
    () => router.push(queueItemHref({ projectSlug, queueItemId: nextPendingItemId })),
    [router, projectSlug, nextPendingItemId],
  );

  // Finishing an item lives here rather than on the bar, because the last item
  // is finished off long after the button was pressed: only once the hand-off
  // it opened has been answered.
  const showErrorToast = useShowErrorToast();
  const markQueueItemDone = api.annotation.markQueueItemDone.useMutation();
  const markDone = markQueueItemDone.mutate;
  const finishCurrentItem = useCallback(
    (onFinished?: () => void | Promise<void>) => {
      if (!projectId || !currentQueueItemId) return;
      markDone(
        { queueItemId: currentQueueItemId, projectId },
        {
          onSuccess: async () => {
            await refetchQueueItems();
            await onFinished?.();
          },
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't mark this item as done",
            }),
        },
      );
    },
    [projectId, currentQueueItemId, markDone, refetchQueueItems, showErrorToast],
  );
  const recordItemDone = useCallback(() => finishCurrentItem(), [finishCurrentItem]);

  const { ending, finishLastItem, confirmEndWithoutDataset, keepSession } = useQueueEnding({
    handoffWanted,
    traceIds: sessionIds,
    isHandoffDrawerOpen: drawerOpen("addDatasetRecord"),
    openHandoffDrawer,
    recordItemDone,
  });

  const deleteQueueItems = api.annotation.deleteQueueItems.useMutation();
  const removeQueueItems = deleteQueueItems.mutate;
  const removeCurrentItemFromQueue = useCallback(() => {
    if (!projectId || !currentQueueItemId) return;
    removeQueueItems(
      { projectId, queueItemIds: [currentQueueItemId] },
      {
        onSuccess: async () => {
          await advanceToNextItem();
          await refetchQueueItems();
        },
        onError: (error) =>
          showErrorToast({
            error,
            fallbackTitle: "Couldn't remove this item from your queue",
          }),
      },
    );
  }, [projectId, currentQueueItemId, removeQueueItems, advanceToNextItem, refetchQueueItems]);

  if (queuesLoading) {
    return <AnnotationsLayout />;
  }

  // The celebration is what the reviewer leaves the conversation for: either
  // the sitting was answered for, or there was nothing waiting to begin with.
  if (ending === "done" || queueFinished) {
    return (
      <AnnotationsLayout>
        <AllTasksCompleteScreen />
      </AnnotationsLayout>
    );
  }

  return (
    <Box display="flex" flexDirection="column" width="full" height="full">
      <VStack height="100%" width="full" gap={0} alignItems="stretch" position="relative" flex="1">
        {/*
          The conversation owns the scroll: this host is a non-scrolling
          column, so the turns scroll inside the view instead of the page
          scrolling a scroller. The bottom padding is the bar's clearance,
          taken here so the last turn stops above the bar rather than
          disappearing behind it.
        */}
        <Box
          flex="1"
          minHeight={0}
          display="flex"
          flexDirection="column"
          overflow="hidden"
          position="relative"
          paddingBottom={currentQueueItem ? "100px" : 0}
        >
          {currentQueueItem && !currentQueueItem.trace ? (
            <UnavailableTraceCard
              canRemove={hasPermission("annotations:update")}
              canSkip={!!nextPendingItemId}
              isRemoving={deleteQueueItems.isPending}
              onRemove={removeCurrentItemFromQueue}
              onSkip={() => void advanceToNextItem()}
            />
          ) : (
            <CodeBlock.AdapterProvider value={shikiAdapter}>
              <Box flex="1" minHeight={0} display="flex" flexDirection="column">
                <IsolatedErrorBoundary
                  scope="Couldn't render this conversation"
                  resetKeys={[currentQueueItem?.trace?.trace_id ?? ""]}
                >
                  <ConversationView
                    key={currentQueueItem?.trace?.trace_id ?? currentQueueItem?.id}
                    conversationId={renderedConversationId}
                    currentTraceId={currentTraceId}
                    // Which turn the reviewer was sent here for, so it
                    // announces itself however far they scroll.
                    focusTraceId={currentTraceId}
                    // The walk collects traces for the dataset, so each turn
                    // carries its own way in and out of the sitting's set.
                    showSessionCheckboxes
                    fallbackTurns={fallbackTurns}
                    onSelectTurn={openTurn}
                    // Reviewers read whole outputs, so nothing arrives folded.
                    defaultExpandAll
                  />
                </IsolatedErrorBoundary>
              </Box>
            </CodeBlock.AdapterProvider>
          )}
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
            <AnnotationQueuePicker
              key={queueItemsKey}
              queueItems={pendingQueueItems}
              currentQueueItem={currentQueueItem}
              isTraceAvailable={!!currentQueueItem.trace}
              isFinishing={markQueueItemDone.isPending}
              sessionCount={sessionIds.length}
              handoffWanted={handoffWanted}
              onHandoffWantedChange={setHandoffWanted}
              onFinishItem={finishCurrentItem}
              onFinishQueue={finishLastItem}
            />
          </Box>
        )}
      </VStack>
      {/*
        The question plays out over the conversation, so cancelling it lands
        the reviewer back on the turn they were reading with every mark still
        in reach.
      */}
      <EndSessionDialog
        open={ending === "asking"}
        onConfirm={confirmEndWithoutDataset}
        onCancel={keepSession}
      />
    </Box>
  );
}

/** What crowns a walk once the sitting has been answered for. */
const AllTasksCompleteScreen = () => (
  <VStack height="100%" width="full" justify="center" backgroundColor="bg.muted" marginTop="-48px">
    <TasksDone />
    <Text fontSize="xl" fontWeight="500">
      All tasks complete
    </Text>
    <Text>Nice work!</Text>
  </VStack>
);

/** The question asked before a sitting ends with nothing handed over. */
const EndSessionDialog = ({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <Dialog.Root
    open={open}
    placement="center"
    onOpenChange={({ open: nextOpen }) => {
      if (!nextOpen) onCancel();
    }}
  >
    <Dialog.Content bg="bg" maxWidth="480px">
      <Dialog.Header>
        <Dialog.Title fontSize="sm" fontWeight="500">
          {END_SESSION_QUESTION}
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button colorPalette="blue" onClick={onConfirm}>
          Confirm
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
);

/**
 * What the reviewer meets instead of a conversation when the queued trace does
 * not resolve. Its job is to say so plainly and hand back a way on, since there
 * is nothing here to read, annotate or finish.
 */
const UnavailableTraceCard = ({
  canRemove,
  canSkip,
  isRemoving,
  onRemove,
  onSkip,
}: {
  canRemove: boolean;
  canSkip: boolean;
  isRemoving: boolean;
  onRemove: () => void;
  onSkip: () => void;
}) => (
  <VStack flex="1" justify="center" gap={4} paddingX={6} textAlign="center">
    <Text fontSize="lg" fontWeight="500">
      This trace is no longer available
    </Text>
    <Text color="fg.muted" maxWidth="480px">
      The trace behind this queue item cannot be found in this project, so there is nothing here to
      review.
    </Text>
    <HStack gap={3}>
      {canRemove && (
        <Button variant="outline" disabled={isRemoving} onClick={onRemove}>
          Remove from queue
        </Button>
      )}
      <Button colorPalette="blue" disabled={!canSkip} onClick={onSkip}>
        Skip
      </Button>
    </HStack>
  </VStack>
);

const AnnotationQueuePicker = ({
  queueItems,
  currentQueueItem,
  isTraceAvailable,
  isFinishing,
  sessionCount,
  handoffWanted,
  onHandoffWantedChange,
  onFinishItem,
  onFinishQueue,
}: {
  queueItems: AssignedQueueItem[];
  currentQueueItem: AssignedQueueItem;
  /**
   * Whether the item's trace resolved. When it did not, the bar keeps its
   * navigation and drops everything that acts on the trace: there is nothing to
   * correct, count or finish, so moving on is all it offers.
   */
  isTraceAvailable: boolean;
  /** Whether an item is being recorded as done right now. */
  isFinishing: boolean;
  /** How many traces the sitting counts right now. */
  sessionCount: number;
  handoffWanted: boolean;
  onHandoffWantedChange: (wanted: boolean) => void;
  /** Records this item as done, then carries the reviewer onwards. */
  onFinishItem: (onFinished: () => Promise<void>) => void;
  /** Ends the walk: the hand-off to a dataset, or the celebration. */
  onFinishQueue: () => void;
}) => {
  const router = useRouter();
  const { project, hasPermission } = useOrganizationTeamProject();
  const canEditTrace = hasPermission("annotations:update");
  const { openDrawer } = useDrawer();
  const [isNavigating, setIsNavigating] = useState(false);

  const currentQueueItemIndex = queueItems.findIndex((item) => item.id === currentQueueItem.id);

  // The navigating state is released a beat after the route resolves, so the
  // bar does not flicker back before the new item renders. The timer is held
  // rather than fired and forgotten: leaving the queue while it is pending
  // would otherwise set state on a page that is already gone.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const releaseNavigatingWhenSettled = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      setIsNavigating(false);
    }, ROUTE_SETTLE_MS);
  }, []);

  const navigateToQueue = async (queueItemId: string) => {
    setIsNavigating(true);
    await router.push(queueItemHref({ projectSlug: project?.slug, queueItemId }));
    releaseNavigatingWhenSettled();
  };

  const previousItem = queueItems[currentQueueItemIndex - 1];
  const nextItem = queueItems[currentQueueItemIndex + 1];

  // One way forward: the primary action finishes this item and moves on, and
  // on the last item it ends the walk instead.
  const finishAndMoveOn = () => {
    if (!nextItem) {
      onFinishQueue();
      return;
    }
    onFinishItem(() => navigateToQueue(nextItem.id));
  };

  const editTrace = () => {
    // The queue page already shows the conversation, so the drawer opens on a
    // tab that adds something to it. Everything else is the helper's: the link
    // states the whole intent (which trace, and that it opens for editing) and
    // the drawer's URL hydrator opens it, rather than the page seeding the
    // drawer's own store a frame before the URL names it.
    openTraceEditorFromConversation({
      openDrawer,
      traceId: currentQueueItem.trace?.trace_id ?? currentQueueItem.traceId,
      occurredAtMs: partitionHint(currentQueueItem.trace?.timestamps?.started_at),
    });
  };

  return (
    <Box
      shadow="md"
      padding={5}
      // The Langy launcher is fixed to the bottom-right corner, so the bar
      // keeps its right edge clear of it and Done stays readable and clickable.
      paddingRight="86px"
      width="full"
      position="relative"
    >
      {isNavigating && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          backgroundColor="bg.panel/80"
          zIndex={20}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Spinner />
        </Box>
      )}
      <HStack gap={4} width="full">
        <Button
          variant="outline"
          disabled={!previousItem || isNavigating}
          onClick={() => {
            if (previousItem) void navigateToQueue(previousItem.id);
          }}
        >
          <ChevronLeft /> Previous
        </Button>
        <Text whiteSpace="nowrap">
          {currentQueueItemIndex + 1} of {queueItems.length}
        </Text>
        <Spacer />
        {isTraceAvailable ? (
          <>
            <Checkbox
              checked={handoffWanted}
              // With nothing counted there is nothing to decide about, so the
              // switch has nothing to switch.
              disabled={sessionCount === 0}
              onCheckedChange={(event) => onHandoffWantedChange(!!event.checked)}
            >
              {datasetToggleLabel(sessionCount)}
            </Checkbox>
            {canEditTrace && (
              <Button variant="outline" disabled={isNavigating} onClick={editTrace}>
                <Pencil /> Edit trace
              </Button>
            )}
            <Button
              colorPalette="blue"
              disabled={currentQueueItem.doneAt !== null || isFinishing || isNavigating}
              onClick={finishAndMoveOn}
            >
              {nextItem ? (
                <>
                  Next <ChevronRight />
                </>
              ) : (
                <>
                  <Check /> Done
                </>
              )}
            </Button>
          </>
        ) : (
          // Nothing here can be finished, so moving on is all this item is
          // good for, the same way the card behind the bar offers Skip.
          <Button
            variant="outline"
            disabled={!nextItem || isNavigating}
            onClick={() => {
              if (nextItem) void navigateToQueue(nextItem.id);
            }}
          >
            Next <ChevronRight />
          </Button>
        )}
      </HStack>
    </Box>
  );
};

/**
 * The walker, inside the trace host its conversation view asks for.
 *
 * The default export is the wrapped screen, so the host travels with the page
 * rather than with the address: this surface is mounted from one route today
 * and its own tests render it directly, and both need the bridge above it.
 */
export default function TraceAnnotations() {
  return (
    <QueueTraceHost>
      <QueueWalker />
    </QueueTraceHost>
  );
}
