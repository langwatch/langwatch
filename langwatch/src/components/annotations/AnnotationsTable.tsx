import {
  Avatar,
  Card,
  CardBody,
  HStack,
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
  VStack,
  StackDivider,
  Tag,
} from "@chakra-ui/react";

import { useRouter } from "next/router";
import { HelpCircle } from "react-feather";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "../CurrentDrawer";

export const AnnotationsTable = ({
  allQueueItems,
  queuesLoading,
  isDone,
}: {
  allQueueItems: any[];
  queuesLoading: boolean;
  isDone?: boolean;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { scoreOptions } = useAnnotationQueues();
  const { openDrawer, isDrawerOpen } = useDrawer();

  const openAnnotationQueue = (queueItemId: string) => {
    void router.push(`/${project?.slug}/annotations/queue/${queueItemId}`);
  };

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      selectedTab: "annotations",
    });
  };

  const handleTraceClick = (traceId: string, queueItemId: string) => {
    if (isDone) {
      openTraceDrawer(traceId);
    } else {
      openAnnotationQueue(queueItemId);
    }
  };

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  type ScoreOption = {
    value: string | string[];
    reason?: string | null;
  };

  const annotationScoreValues = (
    annotations: Record<string, ScoreOption>[],
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && annotations.length > 0) {
      console.log("scoreOptions", annotations);
      console.log("scoreOptionsIDArray", scoreOptionsIDArray);
      return scoreOptionsIDArray.map((id) => (
        <Td key={id} minWidth={200}>
          <VStack
            divider={<StackDivider color="red" />}
            width="full"
            align="start"
            spacing={2}
          >
            {annotations.map((annotation) =>
              annotation.scoreOptions[id]?.value ? (
                <>
                  {Array.isArray(annotation.scoreOptions[id]?.value) ? (
                    <HStack spacing={1} wrap="wrap">
                      {annotation.scoreOptions[id]?.value.map((val, index) => (
                        <Tag key={index}>{val}</Tag>
                      ))}
                    </HStack>
                  ) : (
                    <Tag>{annotation.scoreOptions[id]?.value}</Tag>
                  )}
                  {/* <Tooltip label={annotation.scoreOptions[id]?.reason}>
                    <HelpCircle width={16} height={16} />
                  </Tooltip> */}
                </>
              ) : null
            )}
          </VStack>
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
          {queuesLoading ? (
            <Skeleton height="20px" />
          ) : allQueueItems.length == 0 ? (
            <Text>All Tasks completed</Text>
          ) : (
            <TableContainer>
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th></Th>
                    <Th>Date Queued</Th>
                    <Th>Input</Th>
                    <Th>Output</Th>
                    <Th>Comments</Th>
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
                      console.log("item", item);
                      return (
                        <Tr
                          cursor="pointer"
                          key={item.id}
                          onClick={() =>
                            handleTraceClick(item.traceId, item.id)
                          }
                        >
                          <Td padding={0}>
                            <HStack>
                              {item.annotations.map((annotation) => (
                                <Avatar
                                  size="sm"
                                  name={annotation.user.name ?? ""}
                                  css={{
                                    border: "2px solid white",
                                    "&:not(:first-of-type)": {
                                      marginLeft: "-20px",
                                    },
                                  }}
                                />
                              ))}
                            </HStack>
                          </Td>
                          <Td>
                            <Text>{item.createdAt.toLocaleDateString()}</Text>
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
                          <Td>
                            <VStack
                              align="start"
                              spacing={2}
                              divider={<StackDivider color="red" />}
                            >
                              {item.annotations.map((annotation) =>
                                annotation.comment ? (
                                  <Text
                                    key={annotation.id}
                                    width="full"
                                    textAlign="left"
                                    whiteSpace="pre-wrap"
                                    wordBreak="break-word"
                                    width={"300px"}
                                  >
                                    {annotation.comment}
                                  </Text>
                                ) : null
                              )}
                            </VStack>
                          </Td>
                          {scoreOptions.data &&
                            scoreOptions.data.length > 0 &&
                            annotationScoreValues(
                              item.annotations,
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
