import {
  Avatar,
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Link,
  Spacer,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
  Tag,
} from "@chakra-ui/react";
import { Plus, ThumbsUp } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";

import type {
  User,
  AnnotationScore,
  AnnotationQueueScores,
} from "@prisma/client";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import SettingsLayout from "../../components/SettingsLayout";
import { api } from "../../utils/api";

const AnnotationScorePage = () => {
  const { project, organization } = useOrganizationTeamProject();

  const { openDrawer } = useDrawer();

  const getAllAnnotationQueues = api.annotation.getQueues.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const getUsers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization }
    );
  console.log(getAllAnnotationQueues.data);

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="6xl"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Annotation Queues
          </Heading>
          <Spacer />
          <Button
            size="sm"
            colorScheme="orange"
            leftIcon={<Plus size={20} />}
            onClick={() => openDrawer("addAnnotationQueue", undefined)}
          >
            Add new queue
          </Button>
        </HStack>
        <Card width="full">
          <CardBody>
            {getAllAnnotationQueues.data &&
            getAllAnnotationQueues.data.length == 0 ? (
              <NoDataInfoBlock
                title="No queues setup yet"
                description="Add new queues for your annotations."
                docsInfo={
                  <Text>
                    To learn more about queues and how to use them, please visit
                    our{" "}
                    <Link
                      color="orange.400"
                      href="https://docs.langwatch.ai/features/annotations#annotation-queues"
                      target="_blank"
                    >
                      documentation
                    </Link>
                    .
                  </Text>
                }
                icon={<ThumbsUp />}
              />
            ) : (
              <Table variant="simple" width="full">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th width="40%">Members</Th>
                    <Th>Score Names</Th>
                    <Th minWidth="20%">Description</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {getAllAnnotationQueues.data?.map((queue) => (
                    <Tr key={queue.id}>
                      <Td>{queue.name}</Td>
                      <Td>
                        <ParticipantTag
                          projectUsers={
                            getUsers.data?.members.map(
                              (member) => member.user
                            ) ?? []
                          }
                          userIds={queue.members.map((member) => member.userId)}
                        />
                      </Td>
                      <Td>
                        <ScoreTypeTag
                          scoreTypes={queue.AnnotationQueueScores}
                        />
                      </Td>
                      <Td>{queue.description}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
};

export default AnnotationScorePage;

const ParticipantTag = ({
  projectUsers,
  userIds,
}: {
  projectUsers: User[];
  userIds: string[];
}) => {
  const users = projectUsers.filter((user) => userIds.includes(user.id));

  return (
    <HStack flexWrap="wrap" gap={2}>
      {users?.map((user) => (
        <HStack
          key={user.id}
          spacing={2}
          border="1px solid"
          borderColor="gray.200"
          borderRadius="50"
          paddingY={1}
          paddingX={1}
          paddingRight={2}
        >
          <Avatar name={user.name ?? ""} size="xs" />
          <Text noOfLines={1} maxWidth="120px">
            {user.name}
          </Text>
        </HStack>
      ))}
    </HStack>
  );
};

const ScoreTypeTag = ({
  scoreTypes,
}: {
  scoreTypes: (AnnotationQueueScores & { annotationScore: AnnotationScore })[];
}) => {
  return (
    <HStack flexWrap="wrap" gap={2}>
      {scoreTypes.map((score) => (
        <Tag whiteSpace="nowrap" key={score.annotationScore.id}>
          {score.annotationScore.name}
        </Tag>
      ))}
    </HStack>
  );
};
