import { Container, Heading } from "@chakra-ui/react";

import { useRouter } from "next/router";

import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
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

  console.log(
    "memberAccessibleQueueItemsWithTraces",
    memberAccessibleQueueItemsWithTraces
  );

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
