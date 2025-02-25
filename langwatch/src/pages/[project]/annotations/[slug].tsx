import {
  Avatar,
  Container,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";

import { useRouter } from "next/router";

import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export default function Annotations() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const { slug } = router.query;

  const queue = api.annotation.getQueueBySlugOrId.useQuery(
    {
      projectId: project?.id ?? "",
      slug: slug as string,
    },
    { enabled: !!project?.id }
  );

  const {
    memberAccessibleQueueItemsWithTraces,

    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(memberAccessibleQueueItemsWithTraces?.filter(
      (item) => item.annotationQueueId === queue.data?.id
    ) ?? []),
  ];

  const queueMembers = queue.data?.members?.map((member) => member.user);

  const QueueHeader = () => {
    if (!queue.data) return null;
    return (
      <VStack width="full" align="start">
        <Heading size="lg">{queue.data?.name}</Heading>
        <HStack>
          <Text fontSize="sm">Members: </Text>
          {queueMembers?.map((member) => {
            return (
              <Tooltip key={member.id} content={member.name}>
                <Avatar.Root size="xs">
                  <Avatar.Fallback name={member.name ?? ""} />
                </Avatar.Root>
              </Tooltip>
            );
          })}
        </HStack>
      </VStack>
    );
  };

  return (
    <AnnotationsLayout>
      <Container
        maxWidth={"calc(100vw - 330px)"}
        padding={0}
        margin={0}
        backgroundColor="white"
      >
        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading || queue.isLoading}
          noDataTitle="No queued annotations for this queue"
          noDataDescription="Add a message to this queue to get started."
          tableHeader={<QueueHeader />}
          queueId={queue.data?.id ?? ""}
        />
      </Container>
    </AnnotationsLayout>
  );
}
