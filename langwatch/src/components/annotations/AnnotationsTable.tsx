import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";

import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { Radio, RadioGroup } from "../../components/ui/radio";
import { Tooltip } from "../../components/ui/tooltip";

import { useRouter } from "next/router";
import { ChevronDown, Edit, MessageCircle, MoreVertical } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import type { Annotation } from "@prisma/client";
import { useMemo, useState } from "react";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "../CurrentDrawer";
import { NoDataInfoBlock } from "../NoDataInfoBlock";
import { RandomColorAvatar } from "../RandomColorAvatar";
import { RedactedField } from "../ui/RedactedField";

import {
  MessagesNavigationFooter,
  useMessagesNavigationFooter,
} from "../messages/MessagesNavigationFooter";

export const AnnotationsTable = ({
  isDone,
  noDataTitle,
  noDataDescription,
  heading,
  tableHeader,
  queueId,
  showQueueAndUser,
  groupedAnnotations,
  allAnnotationsLoading,
}: {
  isDone?: boolean;
  noDataTitle?: string;
  noDataDescription?: string;
  heading?: string;
  tableHeader?: React.ReactNode;
  queueId?: string;
  showQueueAndUser?: boolean;
  groupedAnnotations?: Annotation[];
  allAnnotationsLoading?: boolean;
}) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { scoreOptions } = useAnnotationQueues();
  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();

  console.log("scoreOptions", scoreOptions.data);

  const navigationFooter = useMessagesNavigationFooter();

  const [selectedAnnotations, setSelectedAnnotations] =
    useState<string>("pending");

  const { assignedQueueItems, queuesLoading, totalCount } = useAnnotationQueues(
    {
      selectedAnnotations,
      queueId,
      showQueueAndUser,
    }
  );

  const allQueueItems = groupedAnnotations
    ? groupedAnnotations
    : assignedQueueItems;

  const openAnnotationQueue = (queueItemId: string) => {
    void router.push(
      `/${project?.slug}/annotations/my-queue?queue-item=${queueItemId}`
    );
  };

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      showMessages: true,
    });
  };

  const handleTraceClick = (
    traceId: string,
    queueItemId: string,
    doneAt: Date | null
  ) => {
    if (isDone ?? doneAt) {
      openTraceDrawer(traceId);
    } else {
      openAnnotationQueue(queueItemId);
    }
  };

  const scoreOptionsIDArray = useMemo(() => {
    if (!scoreOptions.data) return [];
    return scoreOptions.data
      .filter((key) => key.active === true)
      .map((key) => key.id);
  }, [scoreOptions.data]);

  type ScoreOption = Record<
    string,
    {
      value: string | string[];
      reason?: string | null;
    }
  >;

  const annotationScoreValues = (
    annotations: Record<string, ScoreOption>[],
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && annotations.length > 0) {
      return scoreOptionsIDArray.map((id) => (
        <Table.Cell key={id} minWidth={200}>
          <VStack divideX="1px" width="full" align="start" gap={2}>
            {annotations.map((annotation) =>
              annotation.scoreOptions?.[id]?.value ? (
                <>
                  <HStack gap={0}>
                    {Array.isArray(annotation.scoreOptions?.[id]?.value) ? (
                      <HStack gap={1} wrap="wrap">
                        {(annotation.scoreOptions?.[id]?.value as string[]).map(
                          (val, index) => (
                            <Badge key={index}>{val}</Badge>
                          )
                        )}
                      </HStack>
                    ) : (
                      <Badge>{annotation.scoreOptions?.[id]?.value}</Badge>
                    )}
                    {annotation.scoreOptions?.[id]?.reason && (
                      <Tooltip content={annotation.scoreOptions[id]?.reason}>
                        <MessageCircle width={16} height={16} />
                      </Tooltip>
                    )}
                  </HStack>
                </>
              ) : null
            )}
          </VStack>
        </Table.Cell>
      ));
    } else {
      if (scoreOptionsIDArray.length > 0) {
        return scoreOptionsIDArray.map((_, i) => (
          <Table.Cell key={i} minWidth={200}></Table.Cell>
        ));
      }
      return <Table.Cell minWidth={200}></Table.Cell>;
    }
  };

  const handleEditQueue = () => {
    openDrawer("addAnnotationQueue", {
      queueId: queueId,
    });
  };

  const hasExpectedOutput = () => {
    if (groupedAnnotations) {
      return groupedAnnotations.some((annotation) => annotation.expectedOutput);
    }
    return allQueueItems.some(
      (item: any) =>
        item.annotations?.some((annotation: any) => annotation.expectedOutput)
    );
  };

  const hasComments = () => {
    if (groupedAnnotations?.some((annotation) => annotation.comment)) {
      return true;
    }
    return allQueueItems.some(
      (item: any) =>
        item.annotations?.some((annotation: any) => annotation.comment)
    );
  };

  const hasScoreOptions = () => {
    if (!scoreOptions.data || scoreOptions.data.length === 0) {
      return false;
    }

    // Check if there are any active score options
    const activeScoreOptions = scoreOptions.data.filter(
      (option) => option.active === true
    );
    if (activeScoreOptions.length > 0) {
      return true;
    }

    if (activeScoreOptions.length === 0) {
      return false;
    }

    if (groupedAnnotations) {
      const hasOptions = groupedAnnotations.some((annotation) => {
        return (
          annotation.scoreOptions &&
          Object.keys(annotation.scoreOptions).length > 0
        );
      });
      return hasOptions;
    }

    const hasOptions = allQueueItems.some((item: any) => {
      return item.annotations?.some((annotation: any) => {
        return (
          annotation.scoreOptions &&
          Object.keys(annotation.scoreOptions).length > 0
        );
      });
    });
    return hasOptions;
  };

  if (queuesLoading || allAnnotationsLoading) {
    return (
      <VStack
        align="start"
        marginTop={4}
        width="full"
        padding={6}
        maxHeight="100%"
      >
        <HStack width="full" paddingBottom={4} alignItems="flex-end">
          <Skeleton height="32px" width="200px" />
          <Spacer />
          <Skeleton height="32px" width="100px" />
        </HStack>
        <Box flex={1} width="full" overflowX="auto">
          <Table.Root variant="line" width="full">
            <Table.Header>
              <Table.Row>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Table.ColumnHeader key={i}>
                    <Skeleton height="20px" width="100px" />
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {Array.from({ length: 3 }).map((_, i) => (
                <Table.Row key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <Table.Cell key={j}>
                      <Skeleton
                        height="20px"
                        width={j === 2 || j === 3 ? "200px" : "100px"}
                      />
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </VStack>
    );
  } else {
    console.log("loading", hasScoreOptions());
    return (
      <VStack align="start" marginTop={4} width="full">
        <HStack
          width="full"
          paddingBottom={4}
          alignItems="flex-end"
          padding={6}
        >
          {tableHeader ? (
            tableHeader
          ) : (
            <Heading as={"h1"} size="lg">
              {heading}
            </Heading>
          )}
          <Spacer />
          {!isDone && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="outline">
                  Status <ChevronDown />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <RadioGroup
                  defaultValue="pending"
                  value={selectedAnnotations}
                  onValueChange={(change) =>
                    setSelectedAnnotations(change.value)
                  }
                >
                  <VStack align="start" padding={3} gap={3}>
                    <Radio value="pending">Pending</Radio>
                    <Radio value="completed">Completed</Radio>
                    <Radio value="all">All</Radio>
                  </VStack>
                </RadioGroup>
              </Menu.Content>
            </Menu.Root>
          )}
          {queueId && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="outline" minWidth={0}>
                  <MoreVertical size={16} />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item value="edit" onClick={() => handleEditQueue()}>
                  <Edit size={16} /> Edit queue
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>
        <HStack align="start" gap={6} width="full">
          <Box flex={1} overflowX="auto">
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
                      isExternal
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
              <Box width="full" maxWidth="100%" overflowX="auto">
                <Table.Root variant="line">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader></Table.ColumnHeader>
                      {!isDone && (
                        <Table.ColumnHeader>Date created</Table.ColumnHeader>
                      )}
                      <Table.ColumnHeader>Input</Table.ColumnHeader>
                      <Table.ColumnHeader>Output</Table.ColumnHeader>
                      {hasExpectedOutput() && (
                        <Table.ColumnHeader>Expected Output</Table.ColumnHeader>
                      )}
                      {hasComments() && (
                        <Table.ColumnHeader>Comments</Table.ColumnHeader>
                      )}
                      {hasScoreOptions() &&
                        scoreOptions.data &&
                        scoreOptions.data.length > 0 &&
                        scoreOptions.data
                          ?.filter((key) => key.active === true)
                          .map((key) => (
                            <Table.ColumnHeader key={key.id}>
                              {key.name}
                            </Table.ColumnHeader>
                          ))}
                      <Table.ColumnHeader>Trace Date</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {queuesLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <Table.Row key={i}>
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Table.Cell key={i}>
                              <Skeleton height="20px" />
                            </Table.Cell>
                          ))}
                        </Table.Row>
                      ))
                    ) : allQueueItems.length > 0 ? (
                      allQueueItems.map((item: any) => {
                        return (
                          <Table.Row
                            cursor="pointer"
                            key={item.id}
                            onClick={() =>
                              handleTraceClick(
                                item.traceId,
                                item.id,
                                item.doneAt
                              )
                            }
                            backgroundColor={item.doneAt ? "gray.50" : "white"}
                            padding={2}
                          >
                            <Table.Cell>
                              <Tooltip
                                content={
                                  <VStack align="start" gap={0}>
                                    {item.createdByUser && (
                                      <Text marginBottom={2}>
                                        Created by {item.createdByUser.name}
                                      </Text>
                                    )}
                                    <Text>Comments by:</Text>

                                    {item.annotations
                                      .map(
                                        (a: {
                                          user: { name: string | null };
                                        }) => a.user?.name
                                      )
                                      .filter(
                                        (
                                          name: string | null | undefined,
                                          index: number,
                                          self: (string | null | undefined)[]
                                        ) =>
                                          name && self.indexOf(name) === index
                                      )
                                      .map((name: string) => (
                                        <Text key={name}>{name}</Text>
                                      ))}
                                  </VStack>
                                }
                              >
                                <HStack>
                                  {[
                                    ...(new Map([
                                      ...(item.createdByUser
                                        ? [
                                            [
                                              item.createdByUser.id,
                                              { user: item.createdByUser },
                                            ],
                                          ]
                                        : []),
                                      ...item.annotations
                                        .map(
                                          (
                                            annotation: Annotation & {
                                              user?: {
                                                name: string | null;
                                                id: string;
                                              };
                                            }
                                          ) =>
                                            annotation.user
                                              ? [annotation.user.id, annotation]
                                              : null
                                        )
                                        .filter(Boolean),
                                    ]).values() as Iterable<
                                      | {
                                          user: {
                                            name: string | null;
                                            id: string;
                                          };
                                        }
                                      | (Annotation & {
                                          user?: { name: string | null };
                                        })
                                    >),
                                  ].map((item, index) => (
                                    <RandomColorAvatar
                                      key={index}
                                      size="2xs"
                                      name={item.user?.name ?? ""}
                                      css={{
                                        border: "2px solid white",
                                        "&:not(:first-of-type)": {
                                          marginLeft: "-20px",
                                        },
                                      }}
                                    />
                                  ))}
                                </HStack>
                              </Tooltip>
                            </Table.Cell>
                            {!isDone && (
                              <Table.Cell minWidth={150}>
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
                              </Table.Cell>
                            )}

                            <Table.Cell minWidth={350}>
                              <RedactedField field="input">
                                <Tooltip
                                  content={
                                    item.trace?.input?.value ?? "<empty>"
                                  }
                                >
                                  <Text
                                    lineClamp={2}
                                    maxWidth="350px"
                                    textOverflow="ellipsis"
                                    wordBreak="break-word"
                                  >
                                    {item.trace?.input?.value ?? "<empty>"}
                                  </Text>
                                </Tooltip>
                              </RedactedField>
                            </Table.Cell>
                            <Table.Cell minWidth={350}>
                              <RedactedField field="output">
                                <Tooltip
                                  content={
                                    item.trace?.output?.value ?? "<empty>"
                                  }
                                >
                                  <Text
                                    lineClamp={2}
                                    maxWidth="350px"
                                    textOverflow="ellipsis"
                                    wordBreak="break-word"
                                  >
                                    {item.trace?.output?.value ?? "<empty>"}
                                  </Text>
                                </Tooltip>
                              </RedactedField>
                            </Table.Cell>
                            {hasExpectedOutput() && (
                              <Table.Cell minWidth={350}>
                                <VStack align="start" gap={2} divideY="1px">
                                  {item.annotations.map(
                                    (annotation: Annotation) =>
                                      annotation.expectedOutput ? (
                                        <Text
                                          key={annotation.id}
                                          width="full"
                                          textAlign="left"
                                          whiteSpace="pre-wrap"
                                          wordBreak="break-word"
                                          minWidth={400}
                                          paddingY={2}
                                        >
                                          {annotation.expectedOutput}
                                        </Text>
                                      ) : null
                                  )}
                                </VStack>
                              </Table.Cell>
                            )}
                            {hasComments() && (
                              <Table.Cell minWidth={350}>
                                <VStack align="start" gap={2} divideY="1px">
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
                                          paddingY={2}
                                        >
                                          {annotation.comment}
                                        </Text>
                                      ) : null
                                  )}
                                </VStack>
                              </Table.Cell>
                            )}

                            {hasScoreOptions() &&
                              annotationScoreValues(
                                item.annotations,
                                scoreOptionsIDArray
                              )}
                            <Table.Cell>
                              {new Date(
                                item.trace?.timestamps.started_at ?? ""
                              ).toLocaleDateString()}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })
                    ) : (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          <Text>
                            No annotations found for selected filters.
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}
          </Box>
        </HStack>
        <MessagesNavigationFooter
          totalHits={totalCount}
          pageOffset={navigationFooter.pageOffset}
          pageSize={navigationFooter.pageSize}
          nextPage={navigationFooter.nextPage}
          prevPage={navigationFooter.prevPage}
          changePageSize={navigationFooter.changePageSize}
        />
      </VStack>
    );
  }
};
