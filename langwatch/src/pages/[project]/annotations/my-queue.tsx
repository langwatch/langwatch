import { Box, Button, Spacer, Text, VStack, HStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "../../../components/DashboardLayout";

import { type AnnotationQueueItem } from "@prisma/client";
import { Check, ChevronLeft, ChevronRight } from "react-feather";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEffect, useMemo, useState } from "react";
import { TasksDone } from "../../../components/icons/TasksDone";
import { Conversation } from "../../../components/messages/Conversation";

export default function TraceAnnotations() {
  const router = useRouter();
  const { "queue-item": queueItem } = router.query;
  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    queuesLoading,
  } = useAnnotationQueues();
  const { project } = useOrganizationTeamProject();

  const allQueueItems = useMemo(() => {
    const items = [
      ...(assignedQueueItemsWithTraces ?? []),
      ...(memberAccessibleQueueItemsWithTraces ?? []),
    ];
    return items.filter((item) => !item.doneAt);
  }, [assignedQueueItemsWithTraces, memberAccessibleQueueItemsWithTraces]);

  let currentQueueItem = allQueueItems
    .filter((item) => !item.doneAt)
    .find((item) => item.id === queueItem);

  if (!currentQueueItem) {
    currentQueueItem = allQueueItems[0];
  }

  const queryClient = api.useContext();

  const refetchQueueItems = async () => {
    await queryClient.annotation.getOptimizedAnnotationQueues.invalidate();
    await queryClient.annotation.getPendingItemsCount.invalidate();
    await queryClient.annotation.getAssignedItemsCount.invalidate();
    await queryClient.annotation.getQueueItemsCounts.invalidate();
  };
  const traceDetails = api.traces.getById.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: currentQueueItem?.trace?.trace_id ?? "",
    },
    { enabled: !!project?.id }
  );

  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (traceDetails.data?.metadata.thread_id) {
      setThreadId(traceDetails.data?.metadata.thread_id);
    }
  }, [traceDetails.data?.metadata.thread_id]);

  if (queuesLoading) {
    return <AnnotationsLayout />;
  }

  if (allQueueItems.length === 0 && !queuesLoading) {
    return (
      <AnnotationsLayout>
        <VStack
          height="100%"
          width="full"
          justify="center"
          backgroundColor="gray.100"
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
    <DashboardLayout>
      <VStack height="100%" width="full" padding={4}>
        <Conversation
          threadId={threadId ?? ""}
          traceId={currentQueueItem?.trace?.trace_id ?? ""}
        />
        <Spacer />
      </VStack>
      {currentQueueItem?.trace && (
        <Box
          position="sticky"
          bottom={0}
          left={0}
          right={0}
          width="100%"
          backgroundColor="white"
        >
          <AnnotationQueuePicker
            queueItems={allQueueItems}
            currentQueueItem={currentQueueItem}
            refetchQueueItems={refetchQueueItems}
          />
        </Box>
      )}
    </DashboardLayout>
  );
}

const AnnotationQueuePicker = ({
  queueItems,
  currentQueueItem,
  refetchQueueItems,
}: {
  queueItems: AnnotationQueueItem[];
  currentQueueItem: AnnotationQueueItem;
  refetchQueueItems: () => Promise<void>;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const currentQueueItemIndex = queueItems.findIndex(
    (item) => item.id === currentQueueItem.id
  );

  const navigateToQueue = (queueId: string) => {
    void router.replace(
      `/${project?.slug}/annotations/my-queue?queue-item=${queueId}`
    );
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
          await refetchQueueItems();
          const nextItem = queueItems[currentQueueItemIndex + 1];
          if (nextItem) {
            navigateToQueue(nextItem.id);
          } else {
            await router.replace(`/${project?.slug}/annotations/my-queue`);
          }
        },
      }
    );
  };

  return (
    <Box boxShadow="0px -3px 10px rgba(0, 0, 0, 0.05)" padding={5} width="full">
      <VStack>
        <HStack gap={8}>
          <HStack gap={2}>
            <Button
              variant="outline"
              disabled={currentQueueItemIndex === 0}
              onClick={() => {
                const previousItem = queueItems[currentQueueItemIndex - 1];
                if (previousItem) {
                  navigateToQueue(previousItem.id);
                }
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              disabled={currentQueueItemIndex === queueItems.length - 1}
              onClick={() => {
                const nextItem = queueItems[currentQueueItemIndex + 1];
                if (nextItem) {
                  navigateToQueue(nextItem.id);
                }
              }}
            >
              <ChevronRight />
            </Button>
          </HStack>
          <Text>
            {currentQueueItemIndex + 1} of {queueItems.length}
          </Text>
          <Button
            colorPalette="blue"
            disabled={
              currentQueueItem.doneAt !== null || markQueueItemDone.isLoading
            }
            onClick={() => {
              void markQueueItemDoneMoveToNext();
            }}
          >
            <Check /> Done
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};
