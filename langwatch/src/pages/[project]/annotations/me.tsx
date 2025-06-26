import { Container } from "@chakra-ui/react";

import { useSession } from "next-auth/react";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";

export default function Annotations() {
  const { assignedQueueItemsWithTraces, queuesLoading } = useAnnotationQueues();

  return (
    <AnnotationsLayout>
      <Container
        maxWidth={"calc(100vw - 330px)"}
        padding={0}
        margin={0}
        backgroundColor="white"
      >
        <AnnotationsTable
          allQueueItems={assignedQueueItemsWithTraces}
          queuesLoading={queuesLoading}
          noDataTitle="No queued annotations for you"
          noDataDescription="You have no annotations assigned to you."
          heading="My Queue"
        />
      </Container>
    </AnnotationsLayout>
  );
}
