import {
  Box,
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "../../../../components/DashboardLayout";

import { type AnnotationQueueItem } from "@prisma/client";
import { Check, ChevronLeft, ChevronRight } from "react-feather";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { Conversation } from "../../messages/[trace]/index";

export default function TraceAnnotations() {
  const router = useRouter();
  const { "queue-item": queueItem } = router.query;

  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    queuesLoading,
  } = useAnnotationQueues();

  let allQueueItems = [
    ...(assignedQueueItemsWithTraces ?? []),
    ...(memberAccessibleQueueItemsWithTraces ?? []),
  ];

  allQueueItems = allQueueItems.filter((item) => !item.doneAt);
  if (allQueueItems.length === 0 && !queuesLoading) {
    return (
      <AnnotationsLayout>
        <VStack height="100%" width="full" justify="center">
          <Image src="/images/tasks-done.png" alt="All Done" />
          <Text fontSize="xl" fontWeight="500">
            All tasks complete
          </Text>
          <Text>Nice work!</Text>
        </VStack>
      </AnnotationsLayout>
    );
  }

  let currentQueueItem = allQueueItems
    .filter((item) => !item.doneAt)
    .find((item) => item.id === queueItem);

  if (!currentQueueItem) {
    currentQueueItem = allQueueItems[0];
  }

  return (
    <DashboardLayout backgroundColor="white">
      <VStack height="100%" width="full">
        <Conversation traceId={currentQueueItem?.trace?.trace_id ?? ""} />
        <Spacer />
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
}: {
  queueItems: AnnotationQueueItem[];
  currentQueueItem: AnnotationQueueItem;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const queryClient = api.useContext();

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
          const nextItem = queueItems[currentQueueItemIndex + 1];
          if (nextItem) {
            navigateToQueue(nextItem.id);
          } else {
            void router.replace(`/${project?.slug}/annotations/my-queue`);
            // .then(() => {
            //   router.reload();
            // });
          }
          await queryClient.annotation.getQueueItems.invalidate();
        },
      }
    );
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
            isDisabled={
              currentQueueItem.doneAt !== null || markQueueItemDone.isLoading
            }
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
