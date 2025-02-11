import { Container } from "@chakra-ui/react";

import { useSession } from "next-auth/react";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";

export default function Annotations() {
  const session = useSession();

  const {
    assignedQueueItemsWithTraces,

    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces?.filter(
      (item) => item.userId === session.data?.user.id
    ) ?? []),
  ];

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 360px)"} padding={6}>
        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
          noDataTitle="No queued annotations for you"
          noDataDescription="You have no annotations assigned to you."
          heading="My Queue"
        />
      </Container>
    </AnnotationsLayout>
  );
}
