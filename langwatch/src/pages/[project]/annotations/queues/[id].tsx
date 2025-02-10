import { Container } from "@chakra-ui/react";

import { useRouter } from "next/router";

import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
export default function Annotations() {
  const router = useRouter();

  const { id } = router.query;

  const {
    memberAccessibleQueueItemsWithTraces,

    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(memberAccessibleQueueItemsWithTraces?.filter(
      (item) => item.annotationQueueId === id
    ) ?? []),
  ];

  const queueName = memberAccessibleQueueItemsWithTraces?.find(
    (item) => item.annotationQueueId === id
  )?.queueName;

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 360px)"} padding={6}>
        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
          noDataTitle="No queued annotations for this queue"
          noDataDescription="Add a message to this queue to get started."
          heading={queueName}
        />
      </Container>
    </AnnotationsLayout>
  );
}
