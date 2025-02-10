import { DashboardLayout } from "../../../../components/DashboardLayout";
import {
  Box,
  Button,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";

import { Conversation } from "../../messages/[trace]/index";
import { ChevronRight, Check } from "react-feather";
import { ChevronLeft } from "react-feather";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { type AnnotationQueueItem } from "@prisma/client";
import { type Trace } from "~/server/tracer/types";
import { api } from "~/utils/api";
import { useState, useEffect } from "react";
export default function TraceAnnotations() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const queueId = router.query.id as string;
  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces ?? []),
    ...(memberAccessibleQueueItemsWithTraces ?? []),
  ];

  if (queuesLoading) {
    return (
      <DashboardLayout backgroundColor="white">
        <VStack height="100%" width="full" justify="center">
          <Spinner />
        </VStack>
      </DashboardLayout>
    );
  }

  const currentQueueItem = allQueueItems.find((item) => item.id === queueId);

  if (!currentQueueItem) {
    void router.push(`/${project?.slug}/annotations`);
  }

  console.log("allQueueItems", allQueueItems);
  console.log("currentQueueItem", currentQueueItem);

  return (
    <DashboardLayout backgroundColor="white">
      <VStack height="100%" width="full">
        <Conversation traceId={currentQueueItem?.trace?.trace_id ?? ""} />
        <Spacer />
        {currentQueueItem?.trace && (
          <AnnotationQueuePicker
            allQueueItems={allQueueItems}
            currentQueueItem={currentQueueItem}
          />
        )}
      </VStack>
    </DashboardLayout>
  );
}

const AnnotationQueuePicker = ({
  allQueueItems,
  currentQueueItem,
}: {
  allQueueItems: AnnotationQueueItem[];
  currentQueueItem: AnnotationQueueItem;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const queryClient = api.useContext();

  const currentQueueItemIndex = allQueueItems.findIndex(
    (item) => item.id === currentQueueItem.id
  );

  const [queueItem, setQueueItem] =
    useState<AnnotationQueueItem>(currentQueueItem);

  const [queueItems, setQueueItems] =
    useState<AnnotationQueueItem[]>(allQueueItems);

  useEffect(() => {
    setQueueItems(allQueueItems);
  }, [allQueueItems]);

  useEffect(() => {
    setQueueItem(currentQueueItem);
  }, [currentQueueItem]);

  //   console.log("currentQueueItemIndex", currentQueueItemIndex);
  //   console.log("allQueueItems", allQueueItems);

  const navigateToQueue = (queueId: string) => {
    void router.push(`/${project?.slug}/annotations/queue/${queueId}`);
  };

  const markQueueItemDone = api.annotation.markQueueItemDone.useMutation({
    onSuccess: async () => {
      console.log("ppppp", allQueueItems.length);
      //   if (allQueueItems.length === 0) {
      //     await router.push(`/${project?.slug}/annotations`);
      //   } else if (currentQueueItemIndex === allQueueItems.length - 1) {
      //     // go back to first one is still in the queue
      //     const firstItem = allQueueItems.find((item) => !item.doneAt);
      //     if (firstItem) {
      //       await router.push(
      //         `/${project?.slug}/annotations/queue/${firstItem.id}`
      //       );
      //       await queryClient.annotation.getQueueItems.invalidate();
      //     }
      //     await queryClient.annotation.getQueueItems.invalidate();
      //   } else if (allQueueItems[currentQueueItemIndex + 1]?.id) {
      //     navigateToQueue(allQueueItems[currentQueueItemIndex + 1]?.id ?? "");
      //     await queryClient.annotation.getQueueItems.invalidate();
      //   }
      await queryClient.annotation.getQueueItems.invalidate();
      await queryClient.annotation.getQueueItems.refetch();
      const freshQueueItems = await queryClient.annotation.getQueueItems.fetch({
        projectId: project?.id ?? "",
      });

      console.log("Fresh queue items:", freshQueueItems);

      console.log("Fresh queue items length:", freshQueueItems?.length);

      const nextItem = freshQueueItems?.find((item) => !item.doneAt);
      if (nextItem) {
        navigateToQueue(nextItem.id);
      } else {
        await router.push(`/${project?.slug}/annotations`);
      }
    },
  });

  const markQueueItemDoneMoveToNext = () => {
    markQueueItemDone.mutate({
      queueItemId: currentQueueItem.id,
      projectId: project?.id ?? "",
    });
  };

  return (
    <Box boxShadow="0px -3px 15px rgba(0, 0, 0, 0.1)" padding={4} width="full">
      <VStack>
        <HStack spacing={8}>
          <HStack spacing={2}>
            <Button
              variant="outline"
              isDisabled={currentQueueItemIndex === 0}
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
              isDisabled={currentQueueItemIndex === queueItems.length - 1}
              onClick={() => {
                const nextItem = queueItems[currentQueueItemIndex + 1];
                console.log(nextItem);
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
            rightIcon={<Check />}
            colorScheme="blue"
            isDisabled={currentQueueItem.doneAt !== null}
            onClick={() => {
              markQueueItemDoneMoveToNext();
            }}
          >
            Done
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};
