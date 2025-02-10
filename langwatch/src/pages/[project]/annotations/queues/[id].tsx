import {
  Avatar,
  Box,
  Container,
  Heading,
  HStack,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";

import { useRouter } from "next/router";

import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export default function Annotations() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const { id } = router.query;

  const queue = api.annotation.getQueueById.useQuery(
    {
      queueId: id as string,
      projectId: project?.id as string,
    },
    { enabled: !!project?.id }
  );

  const {
    memberAccessibleQueueItemsWithTraces,

    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(memberAccessibleQueueItemsWithTraces?.filter(
      (item) => item.annotationQueueId === id
    ) ?? []),
  ];

  const queueMembers = queue.data?.members?.map((member) => member.user);

  const QueueHeader = () => {
    return (
      <VStack width="full" align="start">
        <Heading size="lg">{queue.data?.name}</Heading>
        <HStack>
          <Text fontSize="sm">Members: </Text>
          {queueMembers?.map((member) => {
            return (
              <Tooltip label={member.name}>
                <Avatar name={member.name ?? ""} size="xs" />
              </Tooltip>
            );
          })}
        </HStack>
      </VStack>
    );
  };

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 360px)"} padding={6}>
        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading || queue.isLoading}
          noDataTitle="No queued annotations for this queue"
          noDataDescription="Add a message to this queue to get started."
          tableHeader={<QueueHeader />}
          queueId={id as string}
        />
      </Container>
    </AnnotationsLayout>
  );
}
