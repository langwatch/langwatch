import { DashboardLayout } from "../../../../components/DashboardLayout";
import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";

import { Conversation } from "../../messages/[trace]/index";
import { ChevronRight, Check } from "react-feather";
import { ChevronLeft } from "react-feather";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export default function TraceAnnotations() {
  const router = useRouter();
  const traceId = router.query.id as string;

  return (
    <DashboardLayout backgroundColor="white">
      <VStack height="100%" width="full">
        <Conversation traceId={traceId} />
        <Spacer />
        <AnnotationQueuePicker />
      </VStack>
    </DashboardLayout>
  );
}

const AnnotationQueuePicker = () => {
  const { assignedQueueItemsWithTraces, memberAccessibleQueueItemsWithTraces } =
    useAnnotationQueues();

  const router = useRouter();
  const traceId = router.query.id as string;
  const { project } = useOrganizationTeamProject();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces ?? []),
    ...(memberAccessibleQueueItemsWithTraces ?? []),
  ];

  const currentQueueItem = allQueueItems.find(
    (item) => item.trace?.trace_id === traceId
  );

  const currentQueueItemIndex = allQueueItems.findIndex(
    (item) => item.trace?.trace_id === traceId
  );

  const navigateToTrace = (traceId: string) => {
    router.push(`/${project?.slug}/annotations/trace/${traceId}`);
  };

  return (
    <Box boxShadow="0px -3px 15px rgba(0, 0, 0, 0.1)" padding={4} width="full">
      <VStack>
        <HStack spacing={8}>
          <Button rightIcon={<Check />}>Done</Button>
          <Text>
            {currentQueueItemIndex + 1} of {allQueueItems.length}
          </Text>
          <HStack spacing={2}>
            <Button
              variant="outline"
              isDisabled={currentQueueItemIndex === 0}
              onClick={() => {
                const previousItem = allQueueItems[currentQueueItemIndex - 1];
                if (previousItem) {
                  navigateToTrace(previousItem.trace?.trace_id ?? "");
                }
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              isDisabled={currentQueueItemIndex === allQueueItems.length - 1}
              onClick={() => {
                const nextItem = allQueueItems[currentQueueItemIndex + 1];
                if (nextItem) {
                  navigateToTrace(nextItem.trace?.trace_id ?? "");
                }
              }}
            >
              <ChevronRight />
            </Button>
          </HStack>
        </HStack>
      </VStack>
    </Box>
  );
};
