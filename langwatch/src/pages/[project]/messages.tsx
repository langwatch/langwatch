import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  Container,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  LinkBox,
  Menu,
  MenuButton,
  MenuGroup,
  MenuItem,
  MenuList,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Radio,
  Skeleton,
  Text,
  Tooltip,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { useRouter } from "next/router";
import React, { createRef, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  HelpCircle,
  Layers,
  Maximize2,
  Search,
} from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { MessageCard, type ColorMap } from "../../components/MessageCard";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import { ProjectIntegration } from "../../components/ProjectIntegration";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace, TraceCheck } from "../../server/tracer/types";
import { api } from "../../utils/api";

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
      user_id:
        typeof router.query.user_id === "string"
          ? router.query.user_id
          : undefined,
      thread_id:
        typeof router.query.thread_id === "string"
          ? router.query.thread_id
          : undefined,
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
          <FilterSelector />
          <GroupingSelector />
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </HStack>
      </VStack>
      <Container maxWidth="1440" padding={6}>
        <HStack align="start" spacing={10}>
          <VStack gap={6} width="full">
            {project && traceGroups.data && traceGroups.data.length > 0 ? (
              <ExpandableMessages
                project={project}
                traceGroups={traceGroups.data}
                checksMap={traceChecksQuery.data}
              />
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
          <TopicsSelector />
        </HStack>
      </Container>
    </DashboardLayout>
  );
}

function TopicsSelector() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { period } = usePeriodSelector(30);

  const topicCountsQuery = api.traces.getTopicCounts.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
      user_id:
        typeof router.query.user_id === "string"
          ? router.query.user_id
          : undefined,
      thread_id:
        typeof router.query.thread_id === "string"
          ? router.query.thread_id
          : undefined,
    },
    {
      enabled: !!project,
    }
  );

  return (
    <Card width="full" maxWidth="400px">
      <CardBody width="full" padding={8}>
        <Heading as="h2" size="md">
          Topics
        </Heading>
        <VStack width="full" spacing={4} paddingTop={6} align="start">
          {topicCountsQuery.isLoading ? (
            <>
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </>
          ) : topicCountsQuery.data ? (
            Object.keys(topicCountsQuery.data).length > 0 ? (
              Object.entries(topicCountsQuery.data)
                .sort((a, b) => (a[1] > b[1] ? -1 : 1))
                .map(([topic, count]) => (
                  <React.Fragment key={topic}>
                    <HStack spacing={4} width="full">
                      <Checkbox spacing={3} flexGrow={1}>
                        {topic}
                      </Checkbox>
                      <Text color="gray.500" fontSize={12}>
                        {count}
                      </Text>
                    </HStack>
                    <Divider _last={{ display: "none" }} />
                  </React.Fragment>
                ))
            ) : (
              <HStack>
                <Text>No topics found</Text>
                <Tooltip label="Topics are assigned automatically to a group of messages. If you already have enough messages, it may take a day topics to be generated">
                  <HelpCircle width="14px" />
                </Tooltip>
              </HStack>
            )
          ) : (
            <Text>No topics found</Text>
          )}
        </VStack>
      </CardBody>
    </Card>
  );
}

function ExpandableMessages({
  project,
  traceGroups,
  checksMap,
}: {
  project: Project;
  traceGroups: Trace[][];
  checksMap: Record<string, TraceCheck[]> | undefined;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>(
    {}
  );

  const toggleGroup = (index: number) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const [cardHeights, setCardHeights] = useState<Record<number, number>>({});
  const cardRefs = (traceGroups ?? []).map(() => createRef<Element>());
  const [groupBy] = useGroupBy();
  const [transitionsEnabled, setTransitionsEnabled] = useState(false);

  useEffect(() => {
    const newHeights: Record<number, number> = {};
    cardRefs.forEach((ref, index) => {
      if (ref.current) {
        newHeights[index] = ref.current.clientHeight;
      }
    });
    setCardHeights(newHeights);
    setTimeout(() => setTransitionsEnabled(true), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceGroups]);

  const colorMap = useMemo(() => topicColorMap(traceGroups), [traceGroups]);

  return traceGroups.map((traceGroup, groupIndex) => {
    const isExpanded = !!expandedGroups[groupIndex];

    return (
      <VStack
        key={traceGroup[0]?.id ?? groupIndex}
        gap={0}
        transition="all .2s linear"
        onClick={(e: React.MouseEvent<HTMLElement>) => {
          const hasCardClass = (element: HTMLElement | null): boolean => {
            if (!element) return false;
            if (
              element.classList.contains("card") ||
              element.classList.contains("group-title")
            )
              return true;
            return hasCardClass(element.parentElement);
          };
          if (isExpanded && hasCardClass(e.target as HTMLElement)) return;
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
              background: "#ECEEF200",
              className: "card-stack-content",
              marginBottom:
                traceGroup.length > 2 ? 4 : traceGroup.length > 1 ? 2 : 0,
              marginLeft:
                traceGroup.length > 2 ? -4 : traceGroup.length > 1 ? -2 : 0,
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
            paddingY={3}
          >
            <ChevronUp />
          </HStack>
        )}
        {isExpanded && groupBy === "user_id" && (
          <Box
            className="group-title"
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
            className="group-title"
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
        <VStack width="full" gap={6}>
          {traceGroup
            .slice(0, isExpanded ? traceGroup.length : 3)
            .map((trace, traceIndex) => {
              const expanded = isExpanded || traceGroup.length === 1;
              const renderContent = isExpanded || traceIndex === 0;

              return (
                <LinkBox
                  as={Card}
                  className="card"
                  key={trace.id}
                  ref={traceIndex === 0 ? cardRefs[groupIndex] : null}
                  height={
                    renderContent ? "auto" : `${cardHeights[groupIndex] ?? 0}px`
                  }
                  marginTop={
                    renderContent
                      ? "0"
                      : `-${(cardHeights[groupIndex] ?? 0) + 24}px`
                  }
                  padding={0}
                  cursor="pointer"
                  width="full"
                  transition={transitionsEnabled ? "all .2s linear" : undefined}
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
                    {renderContent && (
                      <MessageCard
                        linkActive={expanded}
                        project={project}
                        trace={trace}
                        checksMap={checksMap}
                        colorMap={colorMap}
                      />
                    )}
                  </CardBody>
                </LinkBox>
              );
            })}
        </VStack>
      </VStack>
    );
  });
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

function FilterSelector() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [threadId, setThreadId] = useState("");

  useEffect(() => {
    const query = router.query;
    if (typeof query.user_id === "string") setUserId(query.user_id);
    if (typeof query.thread_id === "string") setThreadId(query.thread_id);
  }, [router.query]);

  const applyFilters = () => {
    const query = {
      ...router.query,
      user_id: userId || undefined,
      thread_id: threadId || undefined,
    };
    void router.push({ query });
    onClose();
  };

  const getFilterLabel = () => {
    const parts = [];
    if (userId) parts.push(`User ID: ${userId}`);
    if (threadId) parts.push(`Thread ID: ${threadId}`);
    return parts.length > 0 ? parts.join(", ") : "Filter";
  };

  return (
    <Popover isOpen={isOpen} onClose={onClose} placement="bottom-end">
      <PopoverTrigger>
        <Button variant="outline" onClick={onOpen} minWidth="fit-content">
          <HStack spacing={2}>
            <Filter size={16} />
            <Text>{getFilterLabel()}</Text>
            <Box>
              <ChevronDown width={14} />
            </Box>
          </HStack>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="fit-content">
        <PopoverArrow />
        <PopoverCloseButton />
        <PopoverHeader>
          <Heading size="sm">Filter Messages</Heading>
        </PopoverHeader>
        <PopoverBody padding={4}>
          <VStack spacing={4}>
            <FormControl>
              <FormLabel>User ID</FormLabel>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Enter User ID"
              />
            </FormControl>
            <FormControl>
              <FormLabel>Thread ID</FormLabel>
              <Input
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
                placeholder="Enter Thread ID"
              />
            </FormControl>
            <Button colorScheme="orange" onClick={applyFilters} alignSelf="end">
              Apply
            </Button>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

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
    </Menu>
  );
}

const topicColorMap = (traceGroups: Trace[][]): ColorMap => {
  const allTopics = new Set(
    traceGroups.flatMap((traces) =>
      traces.flatMap((trace) =>
        trace.topics
          ? typeof trace.topics === "string"
            ? [trace.topics]
            : trace.topics
          : []
      )
    )
  );
  const colors: { background: string; color: string }[] = [
    {
      background: "blue.50",
      color: "blue.600",
    },
    {
      background: "orange.100",
      color: "orange.600",
    },
    {
      background: "green.50",
      color: "green.600",
    },
    {
      background: "yellow.100",
      color: "yellow.700",
    },
    {
      background: "purple.50",
      color: "purple.600",
    },
    {
      background: "teal.50",
      color: "teal.700",
    },
    {
      background: "cyan.50",
      color: "cyan.700",
    },
    {
      background: "pink.50",
      color: "pink.700",
    },
  ];

  const colorMap: ColorMap = {};
  for (const topic of allTopics.values()) {
    let sum = 0;
    for (let i = 0; i < topic.length; i++) {
      sum += topic.charCodeAt(i);
    }

    colorMap[topic] = colors[sum % colors.length]!;
  }

  return colorMap;
};
