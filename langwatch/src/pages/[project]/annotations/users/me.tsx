import { Container, Heading } from "@chakra-ui/react";

import { useRouter } from "next/router";

import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useSession } from "next-auth/react";

export default function Annotations() {
  const router = useRouter();
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
          heading="Your annotations"
        />
      </Container>
    </AnnotationsLayout>
  );
}
