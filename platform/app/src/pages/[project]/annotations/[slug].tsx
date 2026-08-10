import { Box, Flex, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

export default function Annotations() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const { slug } = router.query;

  const queue = api.annotation.getQueueBySlugOrId.useQuery(
    {
      projectId: project?.id ?? "",
      slug: slug as string,
    },
    { enabled: !!project?.id && typeof slug === "string" && !!slug },
  );

  const queueMembers = queue.data?.members?.map((member) => member.user);

  const queueHeader = queue.data ? (
    <VStack align="start" minWidth={0}>
      <Heading size="lg">{queue.data.name}</Heading>
      <HStack>
        <Text fontSize="sm">Members: </Text>
        {queueMembers?.map((member) => (
          <Tooltip key={member.id} content={member.name}>
            <Box display="inline-flex">
              <RandomColorAvatar
                size="xs"
                name={member.name ?? ""}
                image={member.image}
              />
            </Box>
          </Tooltip>
        ))}
      </HStack>
    </VStack>
  ) : null;

  return (
    <AnnotationsLayout>
      <Flex direction="column" flex={1} minWidth={0} height="full">
        <AnnotationsTable
          noDataTitle="No queued annotations for this queue"
          noDataDescription="Add a message to this queue to get started."
          titleContent={queueHeader}
          dateColumnLabel="Date queued"
          showStatusFilter={true}
          rowTarget="queueItem"
          queueId={queue.data?.id ?? ""}
          // The page is this queue, so moving a selection elsewhere starts
          // from the queue the rows are already on.
          pageQueue={
            queue.data
              ? { annotatorId: `queue-${queue.data.id}`, name: queue.data.name }
              : undefined
          }
        />
      </Flex>
    </AnnotationsLayout>
  );
}
