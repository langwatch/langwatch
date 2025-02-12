import {
  Avatar,
  Button,
  Card,
  CardBody,
  Heading,
  HStack,
  Link,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Radio,
  RadioGroup,
  Skeleton,
  Spacer,
  StackDivider,
  Table,
  TableContainer,
  Tag,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@chakra-ui/react";

import { useRouter } from "next/router";
import { Edit, MessageCircle, MoreVertical } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { ChevronDownIcon } from "@chakra-ui/icons";
import type { Annotation } from "@prisma/client";
import { useState } from "react";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "../CurrentDrawer";
import { NoDataInfoBlock } from "../NoDataInfoBlock";

export const AnnotationsTable = ({
  allQueueItems,
  queuesLoading,
  isDone,
  noDataTitle,
  noDataDescription,
  heading,
  tableHeader,
  queueId,
}: {
  allQueueItems: any[];
  queuesLoading: boolean;
  isDone?: boolean;
  noDataTitle?: string;
  noDataDescription?: string;
  heading?: string;
  tableHeader?: React.ReactNode;
  queueId?: string;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { scoreOptions } = useAnnotationQueues();
  const { openDrawer, isDrawerOpen } = useDrawer();

  const openAnnotationQueue = (queueItemId: string) => {
    void router.push(
      `/${project?.slug}/annotations/my-queue?queue-item=${queueItemId}`
    );
  };

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      view: "table",
    });
  };

  const handleTraceClick = (
    traceId: string,
    queueItemId: string,
    doneAt: Date | null
  ) => {
    if (isDone || doneAt) {
      openTraceDrawer(traceId);
    } else {
      openAnnotationQueue(queueItemId);
    }
  };

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  type ScoreOption = {
    [key: string]: {
      value: string | string[];
      reason?: string | null;
    };
  };

  const [selectedAnnotations, setSelectedAnnotations] = useState<string[]>([
    "pending",
  ]);

  const annotationScoreValues = (
    annotations: Record<string, ScoreOption>[],
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && annotations.length > 0) {
      return scoreOptionsIDArray.map((id) => (
        <Td key={id} minWidth={200}>
          <VStack
            divider={<StackDivider color="red" />}
            width="full"
            align="start"
            spacing={2}
          >
            {annotations.map((annotation) =>
              annotation.scoreOptions?.[id]?.value ? (
                <>
                  <HStack spacing={0}>
                    {Array.isArray(annotation.scoreOptions?.[id]?.value) ? (
                      <HStack spacing={1} wrap="wrap">
                        {(annotation.scoreOptions?.[id]?.value as string[]).map(
                          (val, index) => (
                            <Tag key={index}>{val}</Tag>
                          )
                        )}
                      </HStack>
                    ) : (
                      <Tag>{annotation.scoreOptions?.[id]?.value}</Tag>
                    )}
                    {annotation.scoreOptions?.[id]?.reason && (
                      <Tooltip label={annotation.scoreOptions[id]?.reason}>
                        <MessageCircle width={16} height={16} />
                      </Tooltip>
                    )}
                  </HStack>
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

  const handleEditQueue = () => {
    openDrawer("addAnnotationQueue", {
      queueId: queueId,
    });
  };

  const queueItemsFiltered = allQueueItems.filter((item) => {
    if (selectedAnnotations.includes("all")) {
      return true;
    }
    if (selectedAnnotations.includes("completed")) {
      return item.doneAt;
    }
    if (selectedAnnotations.includes("pending")) {
      return !item.doneAt;
    }
    return true;
  });
  if (queuesLoading) {
    return (
      <VStack align="start" marginTop={4} width="full">
        <HStack width="full" paddingBottom={4} alignItems="flex-end">
          <Skeleton height="32px" width="200px" />
          <Spacer />
          <Skeleton height="32px" width="100px" />
        </HStack>
        <Card flex={1} width="full" overflowX="auto">
          <CardBody padding={0}>
            <TableContainer width="full">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Th key={i}>
                        <Skeleton height="20px" width="100px" />
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <Td key={j}>
                          <Skeleton
                            height="20px"
                            width={j === 2 || j === 3 ? "200px" : "100px"}
                          />
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>
      </VStack>
    );
  } else {
    return (
      <VStack align="start" marginTop={4} width="full">
        <HStack width="full" paddingBottom={4} alignItems="flex-end">
          {tableHeader ? (
            tableHeader
          ) : (
            <Heading as={"h1"} size="lg">
              {heading}
            </Heading>
          )}
          <Spacer />
          {!isDone && (
            <Menu>
              <MenuButton
                as={Button}
                rightIcon={<ChevronDownIcon />}
                variant="outline"
              >
                Status
              </MenuButton>
              <MenuList>
                <RadioGroup
                  defaultValue="pending"
                  onChange={(value) => setSelectedAnnotations([value])}
                >
                  <VStack align="start" padding={2}>
                    <Radio value="pending">Pending</Radio>
                    <Radio value="all">All Annotations</Radio>
                    <Radio value="completed">Completed</Radio>
                  </VStack>
                </RadioGroup>
              </MenuList>
            </Menu>
          )}
          {queueId && (
            <Menu>
              <MenuButton as={Button} variant={"outline"} minWidth={0}>
                <MoreVertical size={16} />
              </MenuButton>
              <MenuList>
                <MenuItem
                  icon={<Edit size={16} />}
                  onClick={() => handleEditQueue()}
                >
                  Edit queue
                </MenuItem>
              </MenuList>
            </Menu>
          )}
        </HStack>
        <HStack align="start" spacing={6} width="full">
          <Card flex={1} overflowX="auto">
            <CardBody padding={0}>
              {!queuesLoading && allQueueItems.length == 0 ? (
                <NoDataInfoBlock
                  title={noDataTitle ?? "No annotations yet"}
                  description={
                    noDataDescription ??
                    "Annotate your messages to add more context and improve your analysis."
                  }
                  docsInfo={
                    <Text>
                      To get started with annotations, please visit our{" "}
                      <Link
                        href="https://docs.langwatch.ai/features/annotations"
                        target="_blank"
                        color="orange.400"
                      >
                        documentation
                      </Link>
                      .
                    </Text>
                  }
                  icon={<Edit />}
                />
              ) : (
                <TableContainer width="full" maxWidth="100%">
                  <Table variant="simple">
                    <Thead>
                      <Tr>
                        <Th></Th>
                        {!isDone && <Th>Date created</Th>}
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
                      ) : queueItemsFiltered.length > 0 ? (
                        queueItemsFiltered.map((item) => {
                          return (
                            <Tr
                              cursor="pointer"
                              key={item.id}
                              onClick={() =>
                                handleTraceClick(
                                  item.traceId,
                                  item.id,
                                  item.doneAt
                                )
                              }
                              backgroundColor={
                                item.doneAt ? "gray.50" : "white"
                              }
                              padding={2}
                            >
                              <Td>
                                <HStack>
                                  {item.createdByUser && (
                                    <Avatar
                                      size="sm"
                                      name={item.createdByUser?.name ?? ""}
                                      css={{
                                        border: "2px solid white",
                                        "&:not(:first-of-type)": {
                                          marginLeft: "-20px",
                                        },
                                      }}
                                    />
                                  )}
                                  {[
                                    ...(new Map(
                                      item.annotations.map(
                                        (
                                          annotation: Annotation & {
                                            user: {
                                              name: string | null;
                                              id: string;
                                            };
                                          }
                                        ) => [annotation.user.id, annotation]
                                      )
                                    ).values() as Iterable<
                                      Annotation & {
                                        user: { name: string | null };
                                      }
                                    >),
                                  ].map((annotation) => (
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
                              {!isDone && (
                                <Td>
                                  <Text>
                                    {item.createdAt
                                      ? `${item.createdAt.getDate()}/${item.createdAt.toLocaleDateString(
                                          "en-US",
                                          {
                                            month: "short",
                                          }
                                        )}`
                                      : "-"}
                                  </Text>
                                </Td>
                              )}

                              <Td>
                                <Tooltip label={item.trace?.input?.value}>
                                  <Text
                                    noOfLines={2}
                                    display="block"
                                    maxWidth={450}
                                  >
                                    {item.trace?.input?.value ?? "<empty>"}
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
                                    {item.trace?.output?.value ?? "<empty>"}
                                  </Text>
                                </Tooltip>
                              </Td>
                              <Td>
                                <VStack
                                  align="start"
                                  spacing={2}
                                  divider={<StackDivider color="red" />}
                                >
                                  {item.annotations.map(
                                    (annotation: Annotation) =>
                                      annotation.comment ? (
                                        <Text
                                          key={annotation.id}
                                          width="full"
                                          textAlign="left"
                                          whiteSpace="pre-wrap"
                                          wordBreak="break-word"
                                          minWidth={400}
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
                              No annotations found for selected filters.
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
        </HStack>
      </VStack>
    );
  }
};
