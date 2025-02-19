import { Box } from "@chakra-ui/react";

import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";

export default function Annotations() {
  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces ?? []),
    ...(memberAccessibleQueueItemsWithTraces ?? []),
  ];

  return (
    <AnnotationsLayout>
      <Box backgroundColor="white" width="full" overflowX="auto">
        <AnnotationsTable
          heading="Inbox"
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
          noDataTitle="Your inbox is empty"
          noDataDescription="Send messages to your annotation queue to get started."
        />
      </Box>
    </AnnotationsLayout>
  );
}
