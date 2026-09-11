import { Box, Button, CodeBlock, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import {
  annotationApi as api,
  AnnotationQueueLayout as AnnotationsLayout,
  TasksDone,
  type RouterOutputs,
  useAnnotationQueues,
  useShowErrorToast,
} from "@langwatch/annotation-web/annotations";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Dialog } from "@langwatch/design-system/dialog";
import { IsolatedErrorBoundary } from "@langwatch/trace-web/surfaces/isolated-error-boundary";
import { ConversationView } from "@langwatch/trace-web/surfaces/conversation-view";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import {
  sessionTraceIds,
  useAnnotationQueueSessionStore,
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
} from "@langwatch/trace-web/surfaces/annotation-queue-session";
import { useConversationTurns } from "@langwatch/trace-web/surfaces/conversation-turns";
import { legacyTraceToTurn } from "@langwatch/trace-web/surfaces/legacy-trace-to-turn";
import { openTraceEditorFromConversation } from "@langwatch/trace-web/surfaces/trace-edit-mode";
import { useDrawer } from "@langwatch/ui-drawer";
import { useActiveScope, usePermissions } from "@langwatch/ui-host/session";
import { useRouter } from "@langwatch/ui-host/use-router";
import type { Trace } from "@langwatch/trace-contract";
import { QueueTraceHost } from "./queue-trace-host.tsx";
=======
} from "~/features/traces-v2/stores/annotationQueueSessionStore";
import { legacyTraceToTurn } from "~/features/traces-v2/utils/legacyTraceToTurn";
import { openTraceEditorFromConversation } from "~/features/traces-v2/utils/traceEditMode";
import { useAnnotationQueueWalk } from "~/hooks/useAnnotationQueueWalk";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { TasksDone } from "../../../components/icons/TasksDone";
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx

type AssignedQueueItem = NonNullable<
  RouterOutputs["annotation"]["getQueueWalkStep"]["item"]
>;

/** How long the queue bar waits after a route change before it reads settled. */
export const ROUTE_SETTLE_MS = 100;

/** What the reviewer is asked before the session ends with no dataset. */
export const END_SESSION_QUESTION =
  "Are you sure you want to end this annotation session without adding to a dataset?";

function readConversationId(trace: AssignedQueueItem["trace"]): string | null {
  const threadId = trace?.metadata?.thread_id;

  return typeof threadId === "string" ? threadId : null;
}

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
 * How far the end of the walk has got. `walking` is a queue still being read, which is where
 * the reviewer stays until the last item is finished off.
 */
type QueueEnding = "walking" | "handoff" | "asking" | "done";

/**
 * The end of the queue as a state rather than a race. The celebration is earned: it shows after
 * the dataset add succeeds, or after the reviewer confirms ending the session without one, and
 * never under or before the hand-off drawer.
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

function useQueueWalkerData() {
  const router = useRouter();
  const { "queue-item": queueItem } = router.query;
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
  const { project, status: scopeStatus } = useActiveScope();
  const { can } = usePermissions();

  const { assignedQueueItems, queuesError, queuesLoading, queuesReady } = useAnnotationQueues({
    projectId: project?.id,
    showQueueAndUser: true,
    allQueueItems: true,
    pageOffset: 0,
    pageSize: 25,
    enabled: scopeStatus === "ready" && !!project,
=======
  // One step at a time. The page reads one conversation, and the walk resolves
  // one item to match: the item on screen carries its whole trace, and the rest
  // of the queue is a rank, a count, and the two ids either side. Reading the
  // whole queue to render one of it is what stopped working once queues grew.
  const {
    item: currentQueueItem,
    position,
    total,
    previousItemId,
    nextItemId,
    queueFinished: nothingLeftToReview,
    queueLoading: queuesLoading,
    stepIsStale,
  } = useAnnotationQueueWalk({
    queueItemId: typeof queueItem === "string" ? queueItem : undefined,
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
  });

  const queryClient = api.useUtils();
  const { openDrawer, drawerOpen } = useDrawer();

<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
  const pendingQueueItems = useMemo(
    () => (assignedQueueItems ?? []).filter((item) => !item.doneAt),
    [assignedQueueItems],
  );

  const resolvablePendingItems = useMemo(
    () => pendingQueueItems.filter((item) => !!item.trace),
    [pendingQueueItems],
  );

  const queueItemsKey = useMemo(
    () => pendingQueueItems.map((item) => `${item.id}-${item.doneAt}`).join(","),
    [pendingQueueItems],
  );

  const currentQueueItem =
    pendingQueueItems.find((item) => item.id === queueItem) ?? pendingQueueItems[0];

=======
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
  const refetchQueueItems = useCallback(async () => {
    await Promise.all([
      queryClient.annotation.getQueueWalkStep.invalidate(),
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

  const currentTraceId = currentQueueItem?.trace?.trace_id ?? currentQueueItem?.traceId ?? "";
  const conversationId = readConversationId(currentQueueItem?.trace ?? null);
  const conversationTurns = useConversationTurns(conversationId);
  const fallbackTrace = traceDetails.data ?? currentQueueItem?.trace ?? null;

  const renderedConversationId = getRenderedConversationId(
    conversationId,
    conversationTurns,
    fallbackTrace,
  );

  const fallbackTurns = useMemo(
    () => getFallbackTurns(renderedConversationId, fallbackTrace),
    [renderedConversationId, fallbackTrace],
  );

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
  const shikiAdapter = useShikiAdapter(colorMode);

  return {
    router,
    project,
    scopeStatus,
    can,
    queuesError,
    queuesLoading,
    queuesReady,
    pendingQueueItems,
    resolvablePendingItems,
    currentQueueItem,
    queueItemsKey,
    refetchQueueItems,
    currentTraceId,
    fallbackTurns,
    openTurn,
    shikiAdapter,
    openDrawer,
    drawerOpen,
    renderedConversationId,
  };
}

function getRenderedConversationId(
  conversationId: string | null,
  conversationTurns: ReturnType<typeof useConversationTurns>,
  fallbackTrace: Trace | null,
) {
  const threadResolvedEmpty =
    !!conversationId &&
    !conversationTurns.isLoading &&
    !conversationTurns.isPlaceholderData &&
    (conversationTurns.data?.items.length ?? 0) === 0;

  return threadResolvedEmpty && fallbackTrace ? null : conversationId;
}

function getFallbackTurns(renderedConversationId: string | null, fallbackTrace: Trace | null) {
  if (renderedConversationId || !fallbackTrace) return undefined;

  return [legacyTraceToTurn(fallbackTrace)];
}

function getQueueWalkerStateScreen({
  scopeStatus,
  queuesLoading,
  queuesError,
  queuesReady,
  project,
}: {
  scopeStatus: string;
  queuesLoading: boolean;
  queuesError: unknown;
  queuesReady: boolean;
  project: unknown;
}) {
  if (scopeStatus === "loading" || queuesLoading) {
    return <QueueStateScreen title="Loading annotation queue" />;
  }

  if (scopeStatus !== "ready" || !project) {
    return (
      <QueueStateScreen
        title="Annotation queue unavailable"
        description="Choose a project to review its annotation queue."
      />
    );
  }

  if (queuesError || !queuesReady) {
    return (
      <QueueStateScreen
        title="Couldn't load your annotation queue"
        description="Try refreshing the page."
      />
    );
  }

  return null;
}

function QueueWalker() {
  const data = useQueueWalkerData();

  const {
    router,
    project,
    scopeStatus,
    can,
    queuesError,
    queuesLoading,
    queuesReady,
    pendingQueueItems,
    resolvablePendingItems,
    currentQueueItem,
    queueItemsKey,
    refetchQueueItems,
    currentTraceId,
    fallbackTurns,
    openTurn,
    shikiAdapter,
    openDrawer,
    drawerOpen,
    renderedConversationId,
  } = data;

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

<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
  const queueFinished = queuesReady && resolvablePendingItems.length === 0;
=======
  // What is left to review is what ends the queue: an item whose trace no
  // longer resolves is walkable, so the reviewer can clear it, but it is not
  // work, and one of those cannot hold the end of the queue hostage.
  const queueFinished = !queuesLoading && nothingLeftToReview;
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx

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
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx

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
=======
  const nextPendingItemId = nextItemId ?? undefined;

  const projectId = project?.id;
  const projectSlug = project?.slug;
  // Which item comes next is read from the step in hand, so while that step is
  // still the one the reviewer stepped away from, moving on would carry them
  // past the item they actually asked for. The hold lives here rather than on
  // each button because this is where all of them end up.
  const advanceToNextItem = useCallback(() => {
    if (stepIsStale) return;
    return router.push(
      queueItemHref({ projectSlug, queueItemId: nextPendingItemId }),
    );
  }, [router, projectSlug, nextPendingItemId, stepIsStale]);
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx

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
    // The card offering this button is still drawn from the item left behind,
    // so acting on it would take away what the reviewer has stepped off.
    if (stepIsStale) return;
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
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
    showErrorToast,
=======
    stepIsStale,
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
  ]);

  const stateScreen = getQueueWalkerStateScreen({
    scopeStatus,
    queuesLoading,
    queuesError,
    queuesReady,
    project,
  });

  if (stateScreen) return stateScreen;

  return (
    <QueueWalkerContent
      canRemove={can("annotations:update")}
      currentQueueItem={currentQueueItem}
      currentTraceId={currentTraceId}
      isRemoving={deleteQueueItems.isPending}
      ending={ending}
      finishCurrentItem={finishCurrentItem}
      finishLastItem={finishLastItem}
      fallbackTurns={fallbackTurns}
      handoffWanted={handoffWanted}
      nextPendingItemId={nextPendingItemId}
      openTurn={openTurn}
      pendingQueueItems={pendingQueueItems}
      queueFinished={queueFinished}
      queueItemsKey={queueItemsKey}
      setHandoffWanted={setHandoffWanted}
      sessionCount={sessionIds.length}
      shikiAdapter={shikiAdapter}
      confirmEndWithoutDataset={confirmEndWithoutDataset}
      keepSession={keepSession}
      isFinishing={markQueueItemDone.isPending}
      removeCurrentItemFromQueue={removeCurrentItemFromQueue}
      advanceToNextItem={advanceToNextItem}
      renderedConversationId={renderedConversationId}
    />
  );
}

type QueueWalkerContentProps = {
  canRemove: boolean;
  currentQueueItem: AssignedQueueItem | undefined;
  currentTraceId: string;
  ending: QueueEnding;
  fallbackTurns: ReturnType<typeof legacyTraceToTurn>[] | undefined;
  finishCurrentItem: (onFinished?: () => void | Promise<void>) => void;
  finishLastItem: () => void;
  handoffWanted: boolean;
  nextPendingItemId: string | undefined;
  openTurn: ({ traceId, timestamp }: { traceId: string; timestamp: number }) => void;
  pendingQueueItems: AssignedQueueItem[];
  queueFinished: boolean;
  queueItemsKey: string;
  setHandoffWanted: (wanted: boolean) => void;
  sessionCount: number;
  shikiAdapter: ReturnType<typeof useShikiAdapter>;
  confirmEndWithoutDataset: () => void;
  keepSession: () => void;
  isFinishing: boolean;
  isRemoving: boolean;
  removeCurrentItemFromQueue: () => void;
  advanceToNextItem: () => void;
  renderedConversationId: string | null;
};

const QueueWalkerContent = ({
  canRemove,
  currentQueueItem,
  currentTraceId,
  ending,
  fallbackTurns,
  finishCurrentItem,
  finishLastItem,
  handoffWanted,
  nextPendingItemId,
  openTurn,
  pendingQueueItems,
  queueFinished,
  queueItemsKey,
  setHandoffWanted,
  sessionCount,
  shikiAdapter,
  confirmEndWithoutDataset,
  keepSession,
  isFinishing,
  isRemoving,
  removeCurrentItemFromQueue,
  advanceToNextItem,
  renderedConversationId,
}: QueueWalkerContentProps) => {
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
              canRemove={canRemove}
              canSkip={!!nextPendingItemId}
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
              isRemoving={isRemoving}
=======
              isRemoving={deleteQueueItems.isPending}
              isStale={stepIsStale}
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
              onRemove={removeCurrentItemFromQueue}
              onSkip={() => void advanceToNextItem()}
            />
          ) : (
            <CodeBlock.AdapterProvider value={shikiAdapter}>
              {/*
                While the step in hand is the item the reviewer has left, the
                controls inside the thread — annotate, suggest, the per-turn
                dataset tick, Edit trace, opening a turn — would act on that
                item rather than the one asked for, and annotating writes. The
                hold sits on the subtree rather than on each control: the
                controls belong to ConversationView, which the trace drawer
                renders too, so gating them one at a time leaves whatever is
                added there next ungated.

                Held the way the table holds a subtree over stale rows
                (TraceTableLayout): dimmed, pointer-inert, and announced as
                busy. Scrolling goes with it, as it does there. `inert` is what
                covers the keyboard, which pointer-events does not; React 19
                reads it as a boolean, so the empty string other call sites
                pass is read as false.
              */}
              <Box
                flex="1"
                minHeight={0}
                display="flex"
                flexDirection="column"
                opacity={stepIsStale ? 0.6 : 1}
                transition="opacity 150ms ease-out"
                pointerEvents={stepIsStale ? "none" : "auto"}
                // Driven by staleness alone, never by navigation: the two
                // states look alike from the bar, and only this one means the
                // thread on screen belongs to another item.
                aria-busy={stepIsStale ? true : undefined}
                {...({ inert: stepIsStale || undefined } as {
                  inert?: boolean;
                })}
              >
                <IsolatedErrorBoundary
                  scope="Couldn't render this conversation"
                  resetKeys={[currentQueueItem?.trace?.trace_id ?? ""]}
                >
                  <ConversationView
                    key={currentQueueItem?.trace?.trace_id ?? currentQueueItem?.id}
                    conversationId={renderedConversationId}
                    currentTraceId={currentTraceId}
                    focusTraceId={currentTraceId}
                    showSessionCheckboxes
                    fallbackTurns={fallbackTurns}
                    onSelectTurn={openTurn}
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
              // A fresh bar per item: the one it was on has been left behind,
              // and with it the beat it was waiting out before releasing its
              // controls. Without this the reviewer arrives at the next item
              // with the bar still held from the step that brought them here.
              key={currentQueueItem.id}
              currentQueueItem={currentQueueItem}
              position={position}
              total={total}
              previousItemId={previousItemId}
              nextItemId={nextItemId}
              isTraceAvailable={!!currentQueueItem.trace}
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
              isFinishing={isFinishing}
              sessionCount={sessionCount}
=======
              isFinishing={markQueueItemDone.isPending}
              stepIsStale={stepIsStale}
              sessionCount={sessionIds.length}
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
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
    </Box>
  );
};

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

const QueueStateScreen = ({ title, description }: { title: string; description?: string }) => (
  <AnnotationsLayout>
    <VStack height="100%" width="full" justify="center" gap={3} textAlign="center">
      <Text fontSize="xl" fontWeight="500">
        {title}
      </Text>
      {description && <Text color="fg.muted">{description}</Text>}
    </VStack>
  </AnnotationsLayout>
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
  isStale,
  onRemove,
  onSkip,
}: {
  canRemove: boolean;
  canSkip: boolean;
  isRemoving: boolean;
  /**
   * Whether the item this card was drawn from is the one the reviewer has
   * left. The bar holds its own buttons by disabling them; this card is a
   * separate surface, so it is told and holds its own.
   */
  isStale: boolean;
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
        <Button
          variant="outline"
          disabled={isRemoving || isStale}
          onClick={onRemove}
        >
          Remove from queue
        </Button>
      )}
      <Button
        colorPalette="blue"
        disabled={!canSkip || isStale}
        onClick={onSkip}
      >
        Skip
      </Button>
    </HStack>
  </VStack>
);

const AnnotationQueuePicker = ({
  currentQueueItem,
  position,
  total,
  previousItemId,
  nextItemId,
  isTraceAvailable,
  isFinishing,
  stepIsStale,
  sessionCount,
  handoffWanted,
  onHandoffWantedChange,
  onFinishItem,
  onFinishQueue,
}: {
  currentQueueItem: AssignedQueueItem;
  /**
   * Where this item sits in the queue and how many are waiting. A rank and a
   * count rather than the queue itself: the bar never listed it, it only ever
   * said which one of how many this is.
   */
  position: number;
  total: number;
  /** The items either side, as ids: all the walk needs to step. */
  previousItemId: string | null;
  nextItemId: string | null;
  /**
   * Whether the item's trace resolved. When it did not, the bar keeps its
   * navigation and drops everything that acts on the trace: there is nothing to
   * correct, count or finish, so moving on is all it offers.
   */
  isTraceAvailable: boolean;
  /** Whether an item is being recorded as done right now. */
  isFinishing: boolean;
  /**
   * Whether the item above is the one the reviewer has left, with the one they
   * asked for still being read.
   *
   * Everything that acts on the item waits for this to clear. Releasing on a
   * timer instead let the bar act on the item behind: pressing the primary
   * action finished the item the reviewer had already stepped away from, and
   * "Edit trace" opened the trace they had left.
   */
  stepIsStale: boolean;
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
  const { project } = useActiveScope();
  const { can } = usePermissions();
  const canEditTrace = can("annotations:update");
  const { openDrawer } = useDrawer();
  const [isNavigating, setIsNavigating] = useState(false);

<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
  const currentQueueItemIndex = queueItems.findIndex((item) => item.id === currentQueueItem.id);

=======
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
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

  // One way forward: the primary action finishes this item and moves on, and
  // on the last item it ends the walk instead.
  const finishAndMoveOn = () => {
    if (!nextItemId) {
      onFinishQueue();

      return;
    }
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx

    onFinishItem(() => navigateToQueue(nextItem.id));
=======
    onFinishItem(() => navigateToQueue(nextItemId));
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
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
      {(isNavigating || stepIsStale) && (
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
          disabled={!previousItemId || isNavigating || stepIsStale}
          onClick={() => {
            if (previousItemId) void navigateToQueue(previousItemId);
          }}
        >
          <ChevronLeft /> Previous
        </Button>
        <Text whiteSpace="nowrap">
          {position} of {total}
        </Text>
        <Spacer />
        {isTraceAvailable ? (
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/annotation-queue-walker.tsx
          <TraceAvailableActions
            canEditTrace={canEditTrace}
            currentQueueItem={currentQueueItem}
            handoffWanted={handoffWanted}
            isFinishing={isFinishing}
            isNavigating={isNavigating}
            nextItem={nextItem}
            sessionCount={sessionCount}
            onEditTrace={editTrace}
            onFinish={finishAndMoveOn}
            onHandoffWantedChange={onHandoffWantedChange}
          />
        ) : (
          <UnavailableQueueAction
            isNavigating={isNavigating}
            nextItem={nextItem}
            onNavigate={() => {
              if (nextItem) void navigateToQueue(nextItem.id);
=======
          <>
            <Checkbox
              checked={handoffWanted}
              // With nothing counted there is nothing to decide about, so the
              // switch has nothing to switch.
              disabled={sessionCount === 0}
              onCheckedChange={(event) =>
                onHandoffWantedChange(!!event.checked)
              }
            >
              {datasetToggleLabel(sessionCount)}
            </Checkbox>
            {canEditTrace && (
              <Button
                variant="outline"
                disabled={isNavigating || stepIsStale}
                onClick={editTrace}
              >
                <LuPencil /> Edit trace
              </Button>
            )}
            <Button
              colorPalette="blue"
              disabled={
                currentQueueItem.doneAt !== null ||
                isFinishing ||
                isNavigating ||
                stepIsStale
              }
              onClick={finishAndMoveOn}
            >
              {nextItemId ? (
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
            disabled={!nextItemId || isNavigating || stepIsStale}
            onClick={() => {
              if (stepIsStale || !nextItemId) return;
              void navigateToQueue(nextItemId);
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/my-queue.tsx
            }}
          />
        )}
      </HStack>
    </Box>
  );
};

const TraceAvailableActions = ({
  canEditTrace,
  currentQueueItem,
  handoffWanted,
  isFinishing,
  isNavigating,
  nextItem,
  sessionCount,
  onEditTrace,
  onFinish,
  onHandoffWantedChange,
}: {
  canEditTrace: boolean;
  currentQueueItem: AssignedQueueItem;
  handoffWanted: boolean;
  isFinishing: boolean;
  isNavigating: boolean;
  nextItem: AssignedQueueItem | undefined;
  sessionCount: number;
  onEditTrace: () => void;
  onFinish: () => void;
  onHandoffWantedChange: (wanted: boolean) => void;
}) => (
  <>
    <Checkbox
      checked={handoffWanted}
      disabled={sessionCount === 0}
      onCheckedChange={(event) => onHandoffWantedChange(!!event.checked)}
    >
      {datasetToggleLabel(sessionCount)}
    </Checkbox>
    {canEditTrace && (
      <Button variant="outline" disabled={isNavigating} onClick={onEditTrace}>
        <Pencil /> Edit trace
      </Button>
    )}
    <Button
      colorPalette="blue"
      disabled={currentQueueItem.doneAt !== null || isFinishing || isNavigating}
      onClick={onFinish}
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
);

const UnavailableQueueAction = ({
  isNavigating,
  nextItem,
  onNavigate,
}: {
  isNavigating: boolean;
  nextItem: AssignedQueueItem | undefined;
  onNavigate: () => void;
}) => (
  <Button variant="outline" disabled={!nextItem || isNavigating} onClick={onNavigate}>
    Next <ChevronRight />
  </Button>
);

/**
 * The walker, inside the trace host its conversation view asks for.
 */
export default function TraceAnnotations() {
  return (
    <QueueTraceHost>
      <QueueWalker />
    </QueueTraceHost>
  );
}
