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
      <Container
        maxWidth={"calc(100vw - 330px)"}
        padding={0}
        margin={0}
        backgroundColor="white"
      >
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
