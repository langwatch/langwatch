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
      <Container maxWidth={"calc(100vw - 320px)"} padding={6}>
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
          Annotations
        </Heading>
        <Heading as={"h4"} size="md" fontWeight="normal">
          Inbox
        </Heading>
        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
        />
      </Container>
    </AnnotationsLayout>
  );
}
