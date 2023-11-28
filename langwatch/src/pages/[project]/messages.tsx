import { Link } from "@chakra-ui/next-js";
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Input,
  Menu,
  MenuButton,
  MenuGroup,
  MenuItem,
  MenuList,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  Radio,
  Skeleton,
  Spacer,
  Tag,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/router";
import numeral from "numeral";
import React, { createRef, useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  HelpCircle,
  Layers,
  Maximize2,
  Search,
  XCircle,
} from "react-feather";
import Markdown from "react-markdown";
import {
  getSlicedInput,
  getSlicedOutput,
  getTotalTokensDisplay,
} from "~/mappers/trace";
import { CheckPassing } from "../../components/CheckPassing";
import { DashboardLayout } from "../../components/DashboardLayout";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import { ProjectIntegration } from "../../components/ProjectIntegration";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace, TraceCheck } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";

export default function MessagesOrIntegrationGuide() {
  const { project } = useOrganizationTeamProject();

  if (project && !project.firstMessage) {
    return <ProjectIntegration />;
  }

  return <Messages />;
}

function Messages() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { period, setPeriod } = usePeriodSelector(30);
  const [tracesCheckInterval, setTracesCheckInterval] = useState<
    number | undefined
  >();
  const [groupBy] = useGroupBy();

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
      query: typeof router.query.query === "string" ? router.query.query : "",
      groupBy,
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false, // there is a manual refetch on the useEffect below
    }
  );
  const traceIds =
    traceGroups.data?.flatMap((group) => group.map((trace) => trace.id)) ?? [];
  const traceChecksQuery = api.traces.getTraceChecks.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled: traceIds.length > 0,
      refetchInterval: tracesCheckInterval,
      refetchOnWindowFocus: false,
    }
  );

  useEffect(() => {
    if (traceChecksQuery.data) {
      const pendingChecks = Object.values(traceChecksQuery.data)
        .flatMap((checks) => checks)
        .filter(
          (check) =>
            (check.status == "scheduled" || check.status == "in_progress") &&
            (check.timestamps.inserted_at ?? 0) >
              new Date().getTime() - 1000 * 60 * 60 * 1
        );
      if (pendingChecks.length > 0) {
        setTracesCheckInterval(5000);
      } else {
        setTracesCheckInterval(undefined);
      }
    }
  }, [traceChecksQuery.data]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hasFocus()) {
        void traceGroups.refetch();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [traceGroups]);

  // Card Expansion

  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>(
    {}
  );

  useEffect(() => {
    if (!traceGroups.data) {
      setExpandedGroups({});
    }
  }, [traceGroups.data]);

  const toggleGroup = (index: number) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const [cardHeights, setCardHeights] = useState<Record<number, number>>({});
  const cardRefs = (traceGroups.data ?? []).map(() => createRef<Element>());

  useEffect(() => {
    const newHeights: Record<number, number> = {};
    cardRefs.forEach((ref, index) => {
      if (ref.current) {
        newHeights[index] = ref.current.clientHeight;
      }
    });
    setCardHeights(newHeights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceGroups.data]);

  return (
    <DashboardLayout>
      <VStack
        width="full"
        spacing={0}
        position="sticky"
        top={0}
        zIndex={3}
        background="white"
      >
        <HStack
          position="relative"
          width="full"
          borderBottom="1px solid #E5E5E5"
          paddingX={4}
        >
          <Box position="absolute" top={6} left={6}>
            <Search size={16} />
          </Box>
          <SearchInput />
          <GroupingSelector />
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </HStack>
      </VStack>
      <Container maxWidth="1200" padding={6}>
        <VStack gap={6}>
          {traceGroups.data && traceGroups.data.length > 0 ? (
            traceGroups.data.map((traceGroup, groupIndex) => {
              const isExpanded = !!expandedGroups[groupIndex];

              return (
                <VStack
                  key={groupIndex}
                  gap={6}
                  transition="all 0.2s ease-in-out"
                  onClick={(e: React.MouseEvent<HTMLElement>) => {
                    if (isExpanded && e.target !== e.currentTarget) return;
                    if (traceGroup.length === 1) return;

                    toggleGroup(groupIndex);
                  }}
                  {...(isExpanded
                    ? {
                        className: "card-stack-content expanded",
                        background: "#ECEEF2",
                        borderRadius: "10px",
                        padding: "40px",
                        width: "calc(100% + 80px)",
                        cursor: "n-resize",
                      }
                    : {
                        className: "card-stack-content",
                        marginBottom:
                          traceGroup.length > 2
                            ? -8
                            : traceGroup.length > 1
                            ? -6
                            : 0,
                        marginLeft:
                          traceGroup.length > 2
                            ? -4
                            : traceGroup.length > 1
                            ? -2
                            : 0,
                        cursor: "pointer",
                        width: "full",
                        _hover: {
                          transform: "scale(1.04)",
                        },
                      })}
                >
                  {isExpanded && (
                    <HStack
                      width="full"
                      cursor="n-resize"
                      justify="center"
                      marginTop="-40px"
                      marginBottom="-24px"
                      paddingY={3}
                      onClick={() => toggleGroup(groupIndex)}
                    >
                      <ChevronUp />
                    </HStack>
                  )}
                  {isExpanded && groupBy === "user_id" && (
                    <Box
                      position="absolute"
                      left="64px"
                      marginTop="-22px"
                      fontSize={13}
                      fontWeight={600}
                      color="gray.500"
                      cursor="default"
                    >
                      User ID: {traceGroup[0]?.user_id ?? "null"}
                    </Box>
                  )}
                  {isExpanded && groupBy === "thread_id" && (
                    <Box
                      position="absolute"
                      left="64px"
                      marginTop="-22px"
                      fontSize={13}
                      fontWeight={600}
                      color="gray.500"
                      cursor="default"
                    >
                      Thread ID: {traceGroup[0]?.thread_id ?? "null"}
                    </Box>
                  )}
                  {traceGroup
                    .slice(0, isExpanded ? traceGroup.length : 3)
                    .map((trace, traceIndex) => (
                      <Message
                        key={trace.id}
                        ref={traceIndex === 0 ? cardRefs[groupIndex] : null}
                        project={project}
                        trace={trace}
                        checksMap={traceChecksQuery.data}
                        marginTop={
                          isExpanded || traceIndex === 0
                            ? "0"
                            : `-${
                                (cardHeights[groupIndex] ?? 0) + 24 * traceIndex
                              }px`
                        }
                        height={
                          isExpanded || traceIndex === 0
                            ? "auto"
                            : `${cardHeights[groupIndex] ?? 0}px`
                        }
                        renderContent={traceIndex === 0 || isExpanded}
                        expanded={isExpanded || traceGroup.length === 1}
                      />
                    ))}
                </VStack>
              );
            })
          ) : traceGroups.data ? (
            <Alert status="info">
              <AlertIcon />
              No messages found
            </Alert>
          ) : traceGroups.isError ? (
            <Alert status="error">
              <AlertIcon />
              An error has occurred trying to load the messages
            </Alert>
          ) : (
            <>
              <MessageSkeleton />
              <MessageSkeleton />
              <MessageSkeleton />
            </>
          )}
        </VStack>
      </Container>
    </DashboardLayout>
  );
}

function SearchInput() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    setQuery((router.query.query as string) ?? "");
  }, [router.query.query]);

  return (
    <form
      style={{ width: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        void router.push({
          query: {
            ...router.query,
            query: query ? query : undefined,
          },
        });
      }}
    >
      <Input
        variant="unstyled"
        placeholder={"Search"}
        padding={5}
        paddingLeft={12}
        borderRadius={0}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={!!router.query.query}
      />
    </form>
  );
}

const Message = React.forwardRef(function Message(
  {
    project,
    trace,
    checksMap,
    marginTop,
    height,
    renderContent,
    expanded,
  }: {
    project: Project | undefined;
    trace: Trace;
    checksMap: Record<string, TraceCheck[]> | undefined;
    marginTop: string;
    height: string;
    renderContent: boolean;
    expanded: boolean;
  },
  ref
) {
  return (
    <Link
      className="card"
      width="full"
      href={`/${project?.slug}/messages/${trace.id}`}
      display="block"
      _hover={{ textDecoration: "none" }}
      onClick={(e) => {
        if (!expanded) e.preventDefault();
      }}
    >
      <Card
        ref={ref as any}
        height={height}
        marginTop={marginTop}
        padding={0}
        cursor="pointer"
        width="full"
        transition="all 0.2s ease-in-out"
        border="1px solid"
        borderColor="gray.300"
        _hover={
          expanded
            ? {
                transform: "scale(1.04)",
              }
            : {}
        }
      >
        {!expanded && (
          <Box position="absolute" right={5} top={5}>
            <Maximize2 />
          </Box>
        )}
        <CardBody padding={8} width="fill">
          {renderContent && <CardContent trace={trace} checksMap={checksMap} />}
        </CardBody>
      </Card>
    </Link>
  );
});

function CardContent({
  trace,
  checksMap,
}: {
  trace: Trace;
  checksMap: Record<string, TraceCheck[]> | undefined;
}) {
  const traceChecks = checksMap ? checksMap[trace.id] ?? [] : [];
  const checksDone = traceChecks.every(
    (check) => check.status == "succeeded" || check.status == "failed"
  );
  const checkPasses = traceChecks.filter(
    (check) => check.status == "succeeded"
  ).length;
  const totalChecks = traceChecks.length;

  return (
    <VStack alignItems="flex-start" spacing={4} width="fill">
      <VStack alignItems="flex-start" spacing={8}>
        <VStack alignItems="flex-start" spacing={2}>
          <Box
            fontSize={11}
            color="gray.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Input
          </Box>
          <Box fontWeight="bold">{getSlicedInput(trace)}</Box>
        </VStack>
        {trace.error && !trace.output?.value ? (
          <VStack alignItems="flex-start" spacing={2}>
            <Box
              fontSize={11}
              color="red.400"
              textTransform="uppercase"
              fontWeight="bold"
            >
              Exception
            </Box>
            <Text color="red.900">{trace.error.message}</Text>
          </VStack>
        ) : (
          <VStack alignItems="flex-start" spacing={2}>
            <Box
              fontSize={11}
              color="gray.400"
              textTransform="uppercase"
              fontWeight="bold"
            >
              Generated
            </Box>
            <Box>
              {trace.output?.value ? (
                <Markdown className="markdown">
                  {getSlicedOutput(trace)}
                </Markdown>
              ) : (
                <Text>{"<empty>"}</Text>
              )}
            </Box>
          </VStack>
        )}
      </VStack>
      <Spacer />
      <HStack width="full" alignItems="flex-end">
        <VStack gap={4} alignItems="flex-start">
          <HStack spacing={2}>
            {/* TODO: loop over models used */}
            {/* <Tag background="blue.50" color="blue.600">
                    vendor/model
                  </Tag> */}
          </HStack>
          <HStack fontSize={12} color="gray.400">
            <Tooltip
              label={new Date(trace.timestamps.started_at).toLocaleString()}
            >
              <Text
                borderBottomWidth="1px"
                borderBottomColor="gray.300"
                borderBottomStyle="dashed"
              >
                {formatDistanceToNow(new Date(trace.timestamps.started_at), {
                  addSuffix: true,
                })}
              </Text>
            </Tooltip>
            {(!!trace.metrics.completion_tokens ||
              !!trace.metrics.prompt_tokens) && (
              <>
                <Text>·</Text>
                <HStack>
                  <Box>{getTotalTokensDisplay(trace)}</Box>
                  {trace.metrics.tokens_estimated && (
                    <Tooltip label="token count is calculated by LangWatch when not available from the trace data">
                      <HelpCircle width="14px" />
                    </Tooltip>
                  )}
                </HStack>
              </>
            )}
            {!!trace.metrics.total_cost && (
              <>
                <Text>·</Text>
                <Box>
                  {trace.metrics.total_cost > 0.01
                    ? numeral(trace.metrics.total_cost).format("$0.00a")
                    : "< $0.01"}{" "}
                  cost
                </Box>
              </>
            )}
            {!!trace.metrics.first_token_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.first_token_ms)} to first
                  token
                </Box>
              </>
            )}
            {!!trace.metrics.total_time_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.total_time_ms)} completion
                  time
                </Box>
              </>
            )}
            {!!trace.error && trace.output?.value && (
              <>
                <Text>·</Text>
                <HStack>
                  <Box
                    width={2}
                    height={2}
                    background="red.400"
                    borderRadius="100%"
                  ></Box>
                  <Text>Exception ocurred</Text>
                </HStack>
              </>
            )}
          </HStack>
        </VStack>
        <Spacer />
        {!checksMap && <Skeleton width={100} height="1em" />}
        {checksMap && totalChecks > 0 && (
          <Popover trigger="hover">
            <PopoverTrigger>
              <Tag
                variant="outline"
                boxShadow="#DEDEDE 0px 0px 0px 1px inset"
                color={
                  !checksDone
                    ? "yellow.600"
                    : checkPasses == totalChecks
                    ? "green.600"
                    : "red.600"
                }
                paddingY={1}
                paddingX={2}
              >
                <Box paddingRight={2}>
                  {!checksDone ? (
                    <Clock />
                  ) : checkPasses == totalChecks ? (
                    <CheckCircle />
                  ) : (
                    <XCircle />
                  )}
                </Box>
                {checkPasses}/{totalChecks} checks
              </Tag>
            </PopoverTrigger>
            <Portal>
              <Box zIndex="popover">
                <PopoverContent zIndex={2} width="fit-content">
                  <PopoverArrow />
                  <PopoverHeader>Trace Checks</PopoverHeader>
                  <PopoverBody>
                    <VStack align="start" spacing={2}>
                      {traceChecks.map((check) => (
                        <CheckPassing key={check.id} check={check} />
                      ))}
                    </VStack>
                  </PopoverBody>
                </PopoverContent>
              </Box>
            </Portal>
          </Popover>
        )}
      </HStack>
    </VStack>
  );
}

function MessageSkeleton() {
  return (
    <Card width="full" padding={0}>
      <CardBody padding={8}>
        <VStack alignItems="flex-start" spacing={4}>
          <HStack spacing={12} width="full">
            <Box fontSize={24} fontWeight="bold" width="full">
              <Skeleton width="50%" height="20px" />
            </Box>
          </HStack>
          <VStack gap={4} width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        </VStack>
      </CardBody>
    </Card>
  );
}

const groups = {
  input: "Input",
  output: "Output",
  user_id: "User ID",
  thread_id: "Thread ID",
  none: "None",
};

const useGroupBy = () => {
  const router = useRouter();

  const groupBy =
    (router.query.group_by as keyof typeof groups | undefined) ?? "input";

  const setGroupBy = (group: keyof typeof groups) => {
    void router.push(
      {
        query: {
          ...router.query,
          group_by: group,
        },
      },
      undefined,
      { shallow: true }
    );
  };

  return [groupBy, setGroupBy] as [typeof groupBy, typeof setGroupBy];
};

function GroupingSelector() {
  const ref = useRef<HTMLDivElement>(null);

  const [groupBy, setGroupBy] = useGroupBy();

  return (
    <Menu initialFocusRef={ref}>
      <MenuButton as={Button} variant="outline" minWidth="fit-content">
        <HStack spacing={2}>
          <Layers size={16} />
          <Box>{groups[groupBy]}</Box>
          <Box>
            <ChevronDown width={14} />
          </Box>
        </HStack>
      </MenuButton>
      <Portal>
        <Box zIndex="popover" padding={0}>
          <MenuList>
            <MenuGroup title="Group by">
              {Object.entries(groups).map(([key, value]) => (
                <MenuItem
                  key={key}
                  onClick={() => setGroupBy(key as keyof typeof groups)}
                  {...(groupBy === key ? { ref: ref as any } : {})}
                >
                  <HStack spacing={2}>
                    <Radio isChecked={groupBy === key} />
                    <Text>{value}</Text>
                  </HStack>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuList>
        </Box>
      </Portal>
    </Menu>
  );
}
