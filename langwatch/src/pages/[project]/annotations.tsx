import { Container } from "@chakra-ui/react";

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
      <Container maxWidth={"calc(100vw - 360px)"} padding={6}>
        <AnnotationsTable
          heading="Inbox"
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
          noDataTitle="Your inbox is empty"
          noDataDescription="Send messages to your annotation queue to get started."
        />
      </Container>
    </AnnotationsLayout>
  );
}
