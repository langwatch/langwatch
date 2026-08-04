import {
  Box,
  Button,
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
import { toaster } from "~/components/ui/toaster";
import { useDrawerStore } from "~/features/traces-v2/stores/drawerStore";
import { enterTraceEditMode } from "~/features/traces-v2/utils/traceEditMode";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { TasksDone } from "../../../components/icons/TasksDone";
import { Conversation } from "../../../components/messages/Conversation";

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
    await queryClient.annotation.getOptimizedAnnotationQueues.invalidate();
    await queryClient.annotation.getMarkedForDatasetItems.invalidate();
    await queryClient.annotation.getPendingItemsCount.invalidate();
    await queryClient.annotation.getAssignedItemsCount.invalidate();
    await queryClient.annotation.getQueueItemsCounts.invalidate();
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

  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (traceDetails.data?.metadata.thread_id) {
      setThreadId(traceDetails.data?.metadata.thread_id);
    } else {
      setThreadId(null);
    }
  }, [traceDetails.data?.metadata.thread_id, currentQueueItem?.id]);

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
  const handoffDue =
    !queuesLoading &&
    !markedItemsQuery.isLoading &&
    pendingQueueItems.length === 0 &&
    markedTraceIds.length > 0;

  useEffect(() => {
    if (!handoffDue || !projectId) return;
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
    handoffDue,
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
        <Box
          flex="1"
          overflowY="auto"
          padding={4}
          paddingBottom={currentQueueItem?.trace ? "100px" : 4}
          position="relative"
        >
          <Conversation
            key={currentQueueItem?.trace?.trace_id ?? currentQueueItem?.id}
            threadId={threadId ?? ""}
            traceId={currentQueueItem?.trace?.trace_id ?? ""}
          />
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
        onError: () => {
          setMarkAnswers((answers) => ({
            ...answers,
            [currentQueueItem.id]: !marked,
          }));
          toaster.create({
            title: marked
              ? "Could not mark this item for the dataset"
              : "Could not remove the mark from this item",
            description: "Please try again.",
            type: "error",
            meta: { closable: true },
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
    // The drawer store carries the trace before the URL does, so the drawer
    // renders on the right trace from the first frame. Opening a trace leaves
    // edit mode, so editing is entered after it.
    useDrawerStore.getState().openTrace(traceId, occurredAtMs);
    enterTraceEditMode(traceId);
    openDrawer("traceV2Details", {
      traceId,
      ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
    });
  };

  return (
    <Box shadow="md" padding={5} width="full" position="relative">
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
