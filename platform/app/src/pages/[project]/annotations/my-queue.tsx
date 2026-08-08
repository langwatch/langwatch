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
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Link } from "~/components/ui/link";
import { showErrorToast } from "~/features/errors";
import { ConversationView } from "~/features/traces-v2/components/TraceDrawer/conversationView";
import { useShikiAdapter } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";
import { legacyTraceToTurn } from "~/features/traces-v2/utils/legacyTraceToTurn";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { TasksDone } from "../../../components/icons/TasksDone";

type AssignedQueueItem =
  RouterOutputs["annotation"]["getOptimizedAnnotationQueues"]["assignedQueueItems"][number];

/** A trace timestamp is only useful to the drawer when it is a real number. */
const partitionHint = (startedAt: unknown): number | null =>
  typeof startedAt === "number" && Number.isFinite(startedAt)
    ? startedAt
    : null;

export default function TraceAnnotations() {
  const router = useRouter();
  const { "queue-item": queueItem } = router.query;
  // Only what is still waiting: this read resolves the trace behind every item
  // it returns, so widening it to a whole review history is a page load the
  // reviewer pays for on every visit. The marks are read separately.
  const { assignedQueueItems, queuesLoading } = useAnnotationQueues({
    showQueueAndUser: true,
    allQueueItems: true,
  });
  const { project } = useOrganizationTeamProject();
  const queryClient = api.useContext();
  const { openDrawer, setFlowCallbacks } = useDrawer();

  const pendingQueueItems = useMemo(
    () => (assignedQueueItems ?? []).filter((item) => !item.doneAt),
    [assignedQueueItems],
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
    // Five independent reads, so they go together: one queue action should not
    // cost five sequential round trips.
    await Promise.all([
      queryClient.annotation.getOptimizedAnnotationQueues.invalidate(),
      queryClient.annotation.getMarkedForDatasetItems.invalidate(),
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

  // A trace that belongs to no thread has no conversation to query, so it is
  // handed over as the conversation's only turn.
  const fallbackTrace = traceDetails.data ?? currentQueueItem?.trace ?? null;
  const fallbackTurns = useMemo(
    () =>
      conversationId || !fallbackTrace
        ? undefined
        : [legacyTraceToTurn(fallbackTrace)],
    [conversationId, fallbackTrace],
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

  // ── End-of-queue dataset hand-off ─────────────────────────────────────
  // Marked items keep their mark after they are done, so this set spans the
  // whole queue walk and not only what is still waiting. It carries marks and
  // trace ids alone, without the traces themselves.
  const markedItemsQuery = api.annotation.getMarkedForDatasetItems.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    },
  );
  const markedItems = useMemo(
    () => markedItemsQuery.data ?? [],
    [markedItemsQuery.data],
  );
  const markedTraceIds = useMemo(
    () => Array.from(new Set(markedItems.map((item) => item.traceId))),
    [markedItems],
  );
  const markedItemIds = useMemo(
    () => markedItems.map((item) => item.id),
    [markedItems],
  );
  // Dismissing the drawer is an answer. The hand-off is offered once per set of
  // marks, and asking again waits for that set to change.
  const markSignature = markedItemIds.join(",");
  const offeredHandoffFor = useRef<string | null>(null);
  const clearDatasetMarks = api.annotation.clearDatasetMarks.useMutation();
  const clearMarks = clearDatasetMarks.mutate;

  const projectId = project?.id;
  // The hand-off waits for a queue that has been read, walked to its end, and
  // still has marks to answer for.
  const isHandoffDue =
    !queuesLoading &&
    !markedItemsQuery.isLoading &&
    pendingQueueItems.length === 0 &&
    markedTraceIds.length > 0;

  useEffect(() => {
    if (!isHandoffDue || !projectId) return;
    if (offeredHandoffFor.current === markSignature) return;

    offeredHandoffFor.current = markSignature;
    const handedOverItemIds = [...markedItemIds];
    setFlowCallbacks("addDatasetRecord", {
      onSuccess: () => {
        clearMarks(
          { projectId, queueItemIds: handedOverItemIds },
          { onSuccess: () => void refetchQueueItems() },
        );
      },
    });
    openDrawer("addDatasetRecord", { selectedTraceIds: markedTraceIds });
  }, [
    isHandoffDue,
    markSignature,
    markedTraceIds,
    markedItemIds,
    projectId,
    openDrawer,
    setFlowCallbacks,
    clearMarks,
    refetchQueueItems,
  ]);

  if (queuesLoading) {
    return <AnnotationsLayout />;
  }

  if (pendingQueueItems.length === 0 && !queuesLoading) {
    return (
      <AnnotationsLayout>
        <VStack
          height="100%"
          width="full"
          justify="center"
          backgroundColor="bg.muted"
          marginTop="-48px"
        >
          <TasksDone />
          <Text fontSize="xl" fontWeight="500">
            All tasks complete
          </Text>
          <Text>Nice work!</Text>
        </VStack>
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
          paddingBottom={currentQueueItem?.trace ? "100px" : 0}
        >
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
                  conversationId={conversationId}
                  currentTraceId={currentTraceId}
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
        </Box>
        {currentQueueItem?.trace && (
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
              markedItemIds={markedItemIds}
              refetchQueueItems={refetchQueueItems}
            />
          </Box>
        )}
      </VStack>
    </DashboardLayout>
  );
}

const AnnotationQueuePicker = ({
  queueItems,
  currentQueueItem,
  markedItemIds,
  refetchQueueItems,
}: {
  queueItems: AssignedQueueItem[];
  currentQueueItem: AssignedQueueItem;
  markedItemIds: string[];
  refetchQueueItems: () => Promise<void>;
}) => {
  const router = useRouter();
  const { project, hasPermission } = useOrganizationTeamProject();
  const canEditTrace = hasPermission("annotations:update");
  const { openDrawer } = useDrawer();
  const [isNavigating, setIsNavigating] = useState(false);
  // Whichever way the reviewer last answered the checkbox, until the queue is
  // read back. Keyed by item so moving on never carries an answer along.
  const [markAnswers, setMarkAnswers] = useState<Record<string, boolean>>({});

  const currentQueueItemIndex = queueItems.findIndex(
    (item) => item.id === currentQueueItem.id,
  );

  const navigateToQueue = async (queueId: string, traceId?: string) => {
    setIsNavigating(true);
    const url = traceId
      ? `/${project?.slug}/annotations/my-queue?queue-item=${queueId}&trace=${traceId}`
      : `/${project?.slug}/annotations/my-queue?queue-item=${queueId}`;

    await router.push(url);
    // Add a small delay to ensure the route has fully updated
    setTimeout(() => setIsNavigating(false), 100);
  };

  const markQueueItemDone = api.annotation.markQueueItemDone.useMutation();
  const markQueueItemForDataset =
    api.annotation.markQueueItemForDataset.useMutation();

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
            setTimeout(() => setIsNavigating(false), 100);
          }
        },
      },
    );
  };

  const isMarkedForDataset =
    markAnswers[currentQueueItem.id] ??
    markedItemIds.includes(currentQueueItem.id);

  const toggleDatasetMark = (marked: boolean) => {
    setMarkAnswers((answers) => ({
      ...answers,
      [currentQueueItem.id]: marked,
    }));
    markQueueItemForDataset.mutate(
      {
        queueItemId: currentQueueItem.id,
        projectId: project?.id ?? "",
        marked,
      },
      {
        onSuccess: () => void refetchQueueItems(),
        onError: (error) => {
          setMarkAnswers((answers) => ({
            ...answers,
            [currentQueueItem.id]: !marked,
          }));
          showErrorToast({
            error,
            fallbackTitle: marked
              ? "Couldn't mark this item for the dataset"
              : "Couldn't remove the mark from this item",
          });
        },
      },
    );
  };

  const editTrace = () => {
    const traceId =
      currentQueueItem.trace?.trace_id ?? currentQueueItem.traceId;
    const occurredAtMs = partitionHint(
      currentQueueItem.trace?.timestamps?.started_at,
    );
    // The link states the whole intent — which trace, and that it opens for
    // editing — and the drawer's URL hydrator opens it. Seeding the drawer
    // store here instead would mount the drawer a frame before the URL names
    // it, and the hydrator reads that frame as "the URL has no drawer, close
    // it", which fights the sync that is writing the URL.
    openDrawer("traceV2Details", {
      traceId,
      ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
      urlParams: { edit: "1" },
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
        <Checkbox
          checked={isMarkedForDataset}
          onCheckedChange={(event) => toggleDatasetMark(!!event.checked)}
        >
          Add to dataset at the end
        </Checkbox>
        {canEditTrace && (
          <Button variant="outline" disabled={isNavigating} onClick={editTrace}>
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
      </HStack>
    </Box>
  );
};
