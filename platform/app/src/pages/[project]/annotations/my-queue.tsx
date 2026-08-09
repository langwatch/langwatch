import {
  Box,
  Button,
  CodeBlock,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "react-feather";
import { LuPencil } from "react-icons/lu";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { Checkbox } from "~/components/ui/checkbox";
import { useColorMode } from "~/components/ui/color-mode";
import { Dialog } from "~/components/ui/dialog";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Link } from "~/components/ui/link";
import { showErrorToast } from "~/features/errors";
import { ConversationView } from "~/features/traces-v2/components/TraceDrawer/conversationView";
import { useShikiAdapter } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";
import { useConversationTurns } from "~/features/traces-v2/hooks/useConversationTurns";
import {
  sessionTraceIds,
  useAnnotationQueueSessionStore,
} from "~/features/traces-v2/stores/annotationQueueSessionStore";
import { legacyTraceToTurn } from "~/features/traces-v2/utils/legacyTraceToTurn";
import { openTraceEditorFromConversation } from "~/features/traces-v2/utils/traceEditMode";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { TasksDone } from "../../../components/icons/TasksDone";

type AssignedQueueItem =
  RouterOutputs["annotation"]["getOptimizedAnnotationQueues"]["assignedQueueItems"][number];

/** How long the queue bar waits after a route change before it reads settled. */
export const ROUTE_SETTLE_MS = 100;

/** What the reviewer is asked before the session ends with no dataset. */
export const END_SESSION_QUESTION =
  "Are you sure you want to end this annotation session without adding to a dataset?";

/** A trace timestamp is only useful to the drawer when it is a real number. */
const partitionHint = (startedAt: unknown): number | null =>
  typeof startedAt === "number" && Number.isFinite(startedAt)
    ? startedAt
    : null;

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
 * `walking` is a queue with work left in it. Once there is none, the session's
 * traces are offered to a dataset (`handoff`), the reviewer is asked before the
 * session ends without one (`asking`), or the queue waits to be finished off
 * again after they cancelled (`pending`). Only `done` celebrates.
 */
type QueueEnding = "walking" | "handoff" | "asking" | "pending" | "done";

/**
 * The end of the queue as a state rather than a race.
 *
 * The celebration is earned: it shows after the dataset add succeeds, or after
 * the reviewer confirms ending the session without one, and never under or
 * before the hand-off drawer.
 */
function useQueueEnding({
  queueFinished,
  handoffWanted,
  traceIds,
  isHandoffDrawerOpen,
  openHandoffDrawer,
}: {
  queueFinished: boolean;
  /** Whether the bar's dataset toggle is on. */
  handoffWanted: boolean;
  /** The traces this sitting counted. */
  traceIds: string[];
  isHandoffDrawerOpen: boolean;
  openHandoffDrawer: (traceIds: string[]) => void;
}) {
  const [ending, setEnding] = useState<QueueEnding>("walking");
  const handoff = useAnnotationQueueSessionStore((state) => state.handoff);
  const noteHandoffOpened = useAnnotationQueueSessionStore(
    (state) => state.noteHandoffOpened,
  );
  const resetHandoff = useAnnotationQueueSessionStore(
    (state) => state.resetHandoff,
  );
  const setSessionActive = useAnnotationQueueSessionStore(
    (state) => state.setActive,
  );
  // The drawer is dismissed only once it has been seen open: the frame between
  // asking for it and the URL naming it would otherwise read as a dismissal.
  const drawerWasSeenOpen = useRef(false);

  const hasSomethingToHandOff = handoffWanted && traceIds.length > 0;

  const offerHandoff = useCallback(() => {
    if (!handoffWanted || traceIds.length === 0) {
      setEnding("done");
      return;
    }
    drawerWasSeenOpen.current = false;
    noteHandoffOpened();
    openHandoffDrawer(traceIds);
    setEnding("handoff");
  }, [handoffWanted, traceIds, noteHandoffOpened, openHandoffDrawer]);

  useEffect(() => {
    if (!queueFinished) setEnding("walking");
  }, [queueFinished]);

  useEffect(() => {
    if (queueFinished && ending === "walking") offerHandoff();
  }, [queueFinished, ending, offerHandoff]);

  useEffect(() => {
    if (ending !== "handoff") return;
    if (handoff === "added") {
      setEnding("done");
      // The sitting's set is spent once it has become dataset records.
      setSessionActive(false);
      return;
    }
    if (isHandoffDrawerOpen) {
      drawerWasSeenOpen.current = true;
      return;
    }
    if (drawerWasSeenOpen.current) setEnding("asking");
  }, [ending, handoff, isHandoffDrawerOpen, setSessionActive]);

  return {
    // A queue that ends with nothing to hand over is finished the moment it
    // reads as finished, so the reader never sees a frame of the offer before
    // the effect that skips it.
    ending:
      ending === "walking" && queueFinished && !hasSomethingToHandOff
        ? "done"
        : ending,
    offerHandoff,
    finishWithoutDataset: useCallback(() => {
      resetHandoff();
      setEnding("done");
    }, [resetHandoff]),
    keepSession: useCallback(() => {
      resetHandoff();
      setEnding("pending");
    }, [resetHandoff]),
  };
}

export default function TraceAnnotations() {
  const router = useRouter();
  const { "queue-item": queueItem } = router.query;
  // Only what is still waiting: this read resolves the trace behind every item
  // it returns, so widening it to a whole review history is a page load the
  // reviewer pays for on every visit.
  const { assignedQueueItems, queuesLoading } = useAnnotationQueues({
    showQueueAndUser: true,
    allQueueItems: true,
  });
  const { project, hasPermission } = useOrganizationTeamProject();
  const queryClient = api.useContext();
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
    return pendingQueueItems
      .map((item) => `${item.id}-${item.doneAt}`)
      .join(",");
  }, [pendingQueueItems]);

  let currentQueueItem = pendingQueueItems.find(
    (item) => item.id === queueItem,
  );

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
  const currentTraceId =
    currentQueueItem?.trace?.trace_id ?? currentQueueItem?.traceId ?? "";
  const conversationId = currentQueueItem?.trace?.metadata?.thread_id ?? null;

  // The conversation only reads back 90 days, so a thread older than that
  // answers with no turns even though the item's own trace loaded. Reading it
  // as an empty conversation would hide the very turn the reviewer was sent
  // here for, so once the read has settled on nothing the trace is handed over
  // as the single turn instead.
  // The read keeps the previous thread's turns while the next one loads, so
  // `isPreviousData` is what tells "this thread holds nothing" apart from
  // "these turns belong to the item before this one".
  const conversationTurns = useConversationTurns(conversationId);
  const threadResolvedEmpty =
    !!conversationId &&
    !conversationTurns.isLoading &&
    !conversationTurns.isPreviousData &&
    (conversationTurns.data?.items.length ?? 0) === 0;

  // A trace that belongs to no thread has no conversation to query, so it is
  // handed over as the conversation's only turn.
  const fallbackTrace = traceDetails.data ?? currentQueueItem?.trace ?? null;
  const renderedConversationId =
    threadResolvedEmpty && fallbackTrace ? null : conversationId;
  const fallbackTurns = useMemo(
    () =>
      renderedConversationId || !fallbackTrace
        ? undefined
        : [legacyTraceToTurn(fallbackTrace)],
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
  const setSessionActive = useAnnotationQueueSessionStore(
    (state) => state.setActive,
  );
  const sessionMarks = useAnnotationQueueSessionStore((state) => state.marks);
  const sessionIds = useMemo(
    () => sessionTraceIds(sessionMarks),
    [sessionMarks],
  );
  // The hand-off is a decision, not a display: off at the start of every
  // sitting, and answered once for the whole walk rather than per item.
  const [handoffWanted, setHandoffWanted] = useState(false);

  useEffect(() => () => setSessionActive(false), [setSessionActive]);

  const queueFinished = !queuesLoading && resolvablePendingItems.length === 0;

  useEffect(() => {
    if (!queueFinished) setSessionActive(true);
  }, [queueFinished, setSessionActive]);

  const openHandoffDrawer = useCallback(
    (traceIds: string[]) =>
      openDrawer("addDatasetRecord", { selectedTraceIds: traceIds }),
    [openDrawer],
  );

  const { ending, offerHandoff, finishWithoutDataset, keepSession } =
    useQueueEnding({
      queueFinished,
      handoffWanted,
      traceIds: sessionIds,
      isHandoffDrawerOpen: drawerOpen("addDatasetRecord"),
      openHandoffDrawer,
    });

  // Where "Skip" and a removal land: the next item still waiting, or the bare
  // queue when there is nothing after this one.
  const currentQueueItemId = currentQueueItem?.id;
  const nextPendingItemId = useMemo(() => {
    if (!currentQueueItemId) return undefined;
    const index = pendingQueueItems.findIndex(
      (item) => item.id === currentQueueItemId,
    );
    return pendingQueueItems[index + 1]?.id;
  }, [pendingQueueItems, currentQueueItemId]);

  const projectId = project?.id;
  const projectSlug = project?.slug;
  const advanceToNextItem = useCallback(
    () =>
      router.push(
        queueItemHref({ projectSlug, queueItemId: nextPendingItemId }),
      ),
    [router, projectSlug, nextPendingItemId],
  );

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
  }, [
    projectId,
    currentQueueItemId,
    removeQueueItems,
    advanceToNextItem,
    refetchQueueItems,
  ]);

  if (queuesLoading) {
    return <AnnotationsLayout />;
  }

  if (queueFinished) {
    return (
      <AnnotationsLayout>
        <VStack
          height="100%"
          width="full"
          justify="center"
          backgroundColor="bg.muted"
          marginTop="-48px"
        >
          {ending === "done" ? (
            <>
              <TasksDone />
              <Text fontSize="xl" fontWeight="500">
                All tasks complete
              </Text>
              <Text>Nice work!</Text>
            </>
          ) : (
            <FinishedQueueCard
              traceCount={sessionIds.length}
              onAddToDataset={offerHandoff}
              onFinish={finishWithoutDataset}
            />
          )}
        </VStack>
        <EndSessionDialog
          open={ending === "asking"}
          onConfirm={finishWithoutDataset}
          onCancel={keepSession}
        />
      </AnnotationsLayout>
    );
  }

  return (
    <DashboardLayout display="flex" flexDirection="column">
      <VStack
        height="100%"
        width="full"
        gap={0}
        alignItems="stretch"
        position="relative"
        flex="1"
      >
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
              isRemoving={deleteQueueItems.isLoading}
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
                    key={
                      currentQueueItem?.trace?.trace_id ?? currentQueueItem?.id
                    }
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
              {!conversationId && !!currentQueueItem?.trace && (
                <Box flexShrink={0} paddingX={4} paddingY={6}>
                  <Text
                    fontStyle="italic"
                    color="fg.muted"
                    textAlign="center"
                    width="full"
                  >
                    Pass the thread_id on your integration to capture and
                    visualize the whole conversation or associated actions. Read
                    more on our{" "}
                    <Link
                      isExternal
                      href="https://docs.langwatch.ai/integration/python/guide#adding-metadata"
                      textDecoration="underline"
                    >
                      docs
                    </Link>
                    .
                  </Text>
                </Box>
              )}
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
              refetchQueueItems={refetchQueueItems}
              isTraceAvailable={!!currentQueueItem.trace}
              sessionCount={sessionIds.length}
              handoffWanted={handoffWanted}
              onHandoffWantedChange={setHandoffWanted}
            />
          </Box>
        )}
      </VStack>
    </DashboardLayout>
  );
}

/**
 * The finished queue, before the session has been answered for. It says the
 * walk is over and offers both ways out, so a reviewer who backed out of the
 * hand-off can still hand the traces over or finish without them.
 */
const FinishedQueueCard = ({
  traceCount,
  onAddToDataset,
  onFinish,
}: {
  traceCount: number;
  onAddToDataset: () => void;
  onFinish: () => void;
}) => (
  <VStack gap={4} paddingX={6} textAlign="center">
    <Text fontSize="xl" fontWeight="500">
      Your queue is finished
    </Text>
    <Text color="fg.muted">
      {traceCount === 1
        ? "1 trace is counted in this session."
        : `${traceCount} traces are counted in this session.`}
    </Text>
    <HStack gap={3}>
      {traceCount > 0 && (
        <Button colorPalette="blue" onClick={onAddToDataset}>
          Add to dataset
        </Button>
      )}
      <Button variant="outline" onClick={onFinish}>
        Finish without adding
      </Button>
    </HStack>
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
        <Dialog.Title fontSize="md" fontWeight="500">
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
      The trace behind this queue item cannot be found in this project, so there
      is nothing here to review.
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
  refetchQueueItems,
  isTraceAvailable,
  sessionCount,
  handoffWanted,
  onHandoffWantedChange,
}: {
  queueItems: AssignedQueueItem[];
  currentQueueItem: AssignedQueueItem;
  refetchQueueItems: () => Promise<void>;
  /**
   * Whether the item's trace resolved. When it did not, the bar keeps its
   * navigation and drops everything that acts on the trace: there is nothing to
   * correct, count or finish.
   */
  isTraceAvailable: boolean;
  /** How many traces the sitting counts right now. */
  sessionCount: number;
  handoffWanted: boolean;
  onHandoffWantedChange: (wanted: boolean) => void;
}) => {
  const router = useRouter();
  const { project, hasPermission } = useOrganizationTeamProject();
  const canEditTrace = hasPermission("annotations:update");
  const { openDrawer } = useDrawer();
  const [isNavigating, setIsNavigating] = useState(false);

  const currentQueueItemIndex = queueItems.findIndex(
    (item) => item.id === currentQueueItem.id,
  );

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
    await router.push(
      queueItemHref({ projectSlug: project?.slug, queueItemId }),
    );
    releaseNavigatingWhenSettled();
  };

  const markQueueItemDone = api.annotation.markQueueItemDone.useMutation();

  const markQueueItemDoneMoveToNext = async () => {
    markQueueItemDone.mutate(
      {
        queueItemId: currentQueueItem.id,
        projectId: project?.id ?? "",
      },
      {
        onSuccess: async () => {
          const nextItem = queueItems[currentQueueItemIndex + 1];
          if (nextItem) {
            await refetchQueueItems();
            await navigateToQueue(nextItem.id);
          } else {
            // Clear the queue item out of the URL before the refetch empties
            // the queue, so the end-of-queue hand-off opens onto a bare URL
            // instead of having its drawer params replaced away.
            setIsNavigating(true);
            await router.replace(`/${project?.slug}/annotations/my-queue`);
            await refetchQueueItems();
            releaseNavigatingWhenSettled();
          }
        },
      },
    );
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
      occurredAtMs: partitionHint(
        currentQueueItem.trace?.timestamps?.started_at,
      ),
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
          disabled={currentQueueItemIndex === 0 || isNavigating}
          onClick={() => {
            const previousItem = queueItems[currentQueueItemIndex - 1];
            if (previousItem) {
              void navigateToQueue(previousItem.id);
            }
          }}
        >
          <ChevronLeft /> Previous
        </Button>
        <Button
          variant="outline"
          disabled={
            currentQueueItemIndex === queueItems.length - 1 || isNavigating
          }
          onClick={() => {
            const nextItem = queueItems[currentQueueItemIndex + 1];
            if (nextItem) {
              void navigateToQueue(nextItem.id);
            }
          }}
        >
          Next <ChevronRight />
        </Button>
        <Text whiteSpace="nowrap">
          {currentQueueItemIndex + 1} of {queueItems.length}
        </Text>
        <Spacer />
        {isTraceAvailable && (
          <>
            <Checkbox
              checked={handoffWanted}
              onCheckedChange={(event) =>
                onHandoffWantedChange(!!event.checked)
              }
            >
              {sessionCount > 0
                ? `Add to dataset at the end (${sessionCount})`
                : "Add to dataset at the end"}
            </Checkbox>
            {canEditTrace && (
              <Button
                variant="outline"
                disabled={isNavigating}
                onClick={editTrace}
              >
                <LuPencil /> Edit trace
              </Button>
            )}
            <Button
              colorPalette="blue"
              disabled={
                currentQueueItem.doneAt !== null ||
                markQueueItemDone.isLoading ||
                isNavigating
              }
              onClick={() => {
                void markQueueItemDoneMoveToNext();
              }}
            >
              <Check /> Done
            </Button>
          </>
        )}
      </HStack>
    </Box>
  );
};
