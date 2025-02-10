import {
  Avatar,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Skeleton,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
} from "@chakra-ui/react";

import { useRouter } from "next/router";
import { HelpCircle } from "react-feather";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";

export default function Annotations() {
  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    queuesLoading,
    scoreOptions,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces ?? []),
    ...(memberAccessibleQueueItemsWithTraces ?? []),
  ];

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  type ScoreOption = {
    value: string | string[];
    reason?: string | null;
  };
  const annotationScoreValues = (
    scoreOptions: Record<string, ScoreOption>,
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && scoreOptions) {
      return scoreOptionsIDArray.map((id) => (
        <Td key={id}>
          <HStack>
            <Text>
              {" "}
              {Array.isArray(scoreOptions[id]?.value)
                ? scoreOptions[id]?.value.join(", ")
                : scoreOptions[id]?.value}
            </Text>
            {scoreOptions[id]?.reason && (
              <Tooltip label={scoreOptions[id]?.reason}>
                <HelpCircle width={16} height={16} />
              </Tooltip>
            )}
          </HStack>
        </Td>
      ));
    } else {
      if (scoreOptionsIDArray.length > 0) {
        return scoreOptionsIDArray.map((_, i) => <Td key={i}></Td>);
      }
      return <Td></Td>;
    }
  };

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

export const AnnotationsTable = ({
  allQueueItems,
  queuesLoading,
}: {
  allQueueItems: any[];
  queuesLoading: boolean;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { scoreOptions } = useAnnotationQueues();

  const openAnnotationQueue = (queueItemId: string) => {
    void router.push(`/${project?.slug}/annotations/queue/${queueItemId}`);
  };

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  type ScoreOption = {
    value: string | string[];
    reason?: string | null;
  };

  const annotationScoreValues = (
    scoreOptions: Record<string, ScoreOption>,
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && scoreOptions) {
      return scoreOptionsIDArray.map((id) => (
        <Td key={id}>
          <HStack>
            <Text>{scoreOptions[id]?.value}</Text>
            {scoreOptions[id]?.reason && (
              <Tooltip label={scoreOptions[id]?.reason}>
                <HelpCircle width={16} height={16} />
              </Tooltip>
            )}
          </HStack>
        </Td>
      ));
    } else {
      if (scoreOptionsIDArray.length > 0) {
        return scoreOptionsIDArray.map((_, i) => <Td key={i}></Td>);
      }
      return <Td></Td>;
    }
  };
  return (
    <HStack width="full" align="start" spacing={6} marginTop={6}>
      <Card flex={1}>
        <CardBody>
          {allQueueItems.length == 0 ? (
            <Text>All Tasks completed</Text>
          ) : (
            <TableContainer>
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th>Date Queued</Th>
                    <Th>Input</Th>
                    <Th>Output</Th>
                    {scoreOptions.data &&
                      scoreOptions.data.length > 0 &&
                      scoreOptions.data?.map((key) => (
                        <Th key={key.id}>{key.name}</Th>
                      ))}
                    <Th>Trace Date</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {queuesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Tr key={i}>
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Td key={i}>
                            <Skeleton height="20px" />
                          </Td>
                        ))}
                      </Tr>
                    ))
                  ) : allQueueItems.length > 0 ? (
                    allQueueItems.map((item) => {
                      return (
                        <Tr
                          cursor="pointer"
                          key={item.id}
                          onClick={() => openAnnotationQueue(item.id)}
                        >
                          <Td>
                            <HStack>
                              <Avatar
                                size="sm"
                                name={item.createdByUser?.name ?? ""}
                              />
                              <Text>{item.createdAt.toLocaleDateString()}</Text>
                            </HStack>
                          </Td>

                          <Td>
                            <Tooltip label={item.trace?.input?.value}>
                              <Text
                                noOfLines={2}
                                display="block"
                                maxWidth={450}
                              >
                                {item.trace?.input?.value}
                              </Text>
                            </Tooltip>
                          </Td>
                          <Td>
                            <Tooltip label={item.trace?.output?.value}>
                              <Text
                                noOfLines={2}
                                display="block"
                                maxWidth={550}
                              >
                                {item.trace?.output?.value}
                              </Text>
                            </Tooltip>
                          </Td>
                          {scoreOptions.data &&
                            scoreOptions.data.length > 0 &&
                            annotationScoreValues(
                              item.annotations?.[0]
                                ?.scoreOptions as unknown as Record<
                                string,
                                ScoreOption
                              >,
                              scoreOptionsIDArray
                            )}
                          <Td>
                            {new Date(
                              item.trace?.timestamps.started_at ?? ""
                            ).toLocaleDateString()}
                          </Td>
                        </Tr>
                      );
                    })
                  ) : (
                    <Tr>
                      <Td colSpan={5}>
                        <Text>
                          No annotations found for selected filters or period.
                        </Text>
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </TableContainer>
          )}
        </CardBody>
      </Card>
      <FilterSidebar />
    </HStack>
  );
};
