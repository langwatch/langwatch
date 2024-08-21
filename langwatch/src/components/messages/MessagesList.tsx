import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  LinkBox,
  Menu,
  MenuButton,
  MenuGroup,
  MenuItem,
  MenuList,
  Radio,
  Skeleton,
  Spacer,
  Text,
  Tooltip,
  VStack,
  Select,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { useRouter } from "next/router";
import React, { createRef, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Layers,
  Maximize2,
  RefreshCw,
} from "react-feather";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { getSingleQueryParam } from "../../utils/getSingleQueryParam";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle } from "../filters/FilterToggle";
import { ToggleAnalytics, ToggleTableView } from "./HeaderButtons";
import { MessageCard, type TraceWithGuardrail } from "./MessageCard";

export function MessagesList() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const [evaluationsCheckInterval, setEvaluationsCheckInterval] = useState<
    number | undefined
  >();
  const [groupBy] = useGroupBy();
  const { filterParams, queryOpts } = useFilterParams();
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const [totalHits, setTotalHits] = useState<number>(0);

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      query: getSingleQueryParam(router.query.query),
      groupBy,
      pageOffset: pageOffset,
      pageSize: pageSize,
    },
    queryOpts
  );
  const traceIds =
    traceGroups.data?.groups.flatMap((group) =>
      group.map((trace) => trace.trace_id)
    ) ?? [];
  const evaluations = api.traces.getEvaluationsMultiple.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled: traceIds.length > 0,
      refetchInterval: evaluationsCheckInterval,
      refetchOnWindowFocus: false,
    }
  );

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  useEffect(() => {
    if (evaluations.data) {
      const pendingEvaluations = Object.values(evaluations.data)
        .flatMap((checks) => checks)
        .filter(
          (check) =>
            (check.status == "scheduled" || check.status == "in_progress") &&
            (check.timestamps.inserted_at ?? 0) >
              new Date().getTime() - 1000 * 60 * 60 * 1
        );
      if (pendingEvaluations.length > 0) {
        setEvaluationsCheckInterval(5000);
      } else {
        setEvaluationsCheckInterval(undefined);
      }
    }
  }, [evaluations.data]);

  useEffect(() => {
    if (traceGroups.isFetched) {
      const totalHits: number = traceGroups.data?.totalHits ?? 0;

      setTotalHits(totalHits);
    }
  }, [traceGroups.data?.totalHits, traceGroups.isFetched]);

  useEffect(() => {
    const onFocus = () => {
      setTimeout(() => {
        void traceGroups.refetch();
      }, 500);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [traceGroups]);

  const nextPage = () => {
    setPageOffset(pageOffset + pageSize);
  };

  const prevPage = () => {
    if (pageOffset > 0) {
      setPageOffset(pageOffset - pageSize);
    }
  };

  useEffect(() => {
    setPageOffset(0);
  }, [router.query.query]);

  const changePageSize = (size: number) => {
    setPageSize(size);
    setPageOffset(0);
  };

  return (
    <Container maxW={"calc(min(1440px, 100vw - 200px))"} padding={6}>
      <HStack width="full" align="top" paddingBottom={6}>
        <HStack align="center" spacing={6}>
          <Heading as={"h1"} size="lg" paddingTop={1}>
            Messages
          </Heading>
          <ToggleAnalytics />
          <Tooltip label="Refresh">
            <Button
              variant="outline"
              minWidth={0}
              height="32px"
              padding={2}
              marginTop={2}
              onClick={() => {
                void traceGroups.refetch();
                void evaluations.refetch();
              }}
            >
              <RefreshCw
                size="16"
                className={
                  traceGroups.isLoading || traceGroups.isRefetching
                    ? "refresh-icon animation-spinning"
                    : "refresh-icon"
                }
              />
            </Button>
          </Tooltip>
        </HStack>
        <Spacer />
        <ToggleTableView />
        <GroupingSelector />
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <FilterToggle defaultShowFilters={true} />
      </HStack>
      <HStack align="start" spacing={8}>
        <VStack gap={6} width="full">
          {project && traceGroups.data && traceGroups.data.groups.length > 0 ? (
            <ExpandableMessages
              project={project}
              traceGroups={traceGroups.data.groups}
              checksMap={evaluations.data}
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
          <HStack padding={6}>
            <Text>Items per page </Text>

            <Select
              defaultValue={"25"}
              placeholder=""
              maxW="70px"
              size="sm"
              onChange={(e) => changePageSize(parseInt(e.target.value))}
              borderColor={"black"}
              borderRadius={"lg"}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </Select>

            <Text marginLeft={"20px"}>
              {" "}
              {`${pageOffset + 1}`} -{" "}
              {`${
                pageOffset + pageSize > totalHits
                  ? totalHits
                  : pageOffset + pageSize
              }`}{" "}
              of {`${totalHits}`} items
            </Text>
            <Button
              width={10}
              padding={0}
              onClick={prevPage}
              isDisabled={pageOffset === 0}
            >
              <ChevronLeft />
            </Button>
            <Button
              width={10}
              padding={0}
              isDisabled={pageOffset + pageSize >= totalHits}
              onClick={nextPage}
            >
              <ChevronRight />
            </Button>
          </HStack>
        </VStack>
        <FilterSidebar defaultShowFilters={true} />
      </HStack>
    </Container>
  );
}

const ExpandableMessages = React.memo(
  function ExpandableMessages({
    project,
    traceGroups,
    checksMap,
  }: {
    project: Project;
    traceGroups: TraceWithGuardrail[][];
    checksMap: Record<string, ElasticSearchEvaluation[]> | undefined;
  }) {
    const [expandedGroups, setExpandedGroups] = useState<
      Record<number, boolean>
    >({});

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

    return traceGroups.map((traceGroup, groupIndex) => {
      const isExpanded = !!expandedGroups[groupIndex];

      return (
        <VStack
          key={traceGroup[0]?.trace_id ?? groupIndex}
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
                zIndex: 2,
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
              User ID: {traceGroup[0]?.metadata.user_id ?? "null"}
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
              Thread ID: {traceGroup[0]?.metadata.thread_id ?? "null"}
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
                    key={trace.trace_id}
                    ref={traceIndex === 0 ? cardRefs[groupIndex] : null}
                    height={
                      renderContent
                        ? "auto"
                        : `${cardHeights[groupIndex] ?? 0}px`
                    }
                    marginTop={
                      renderContent
                        ? "0"
                        : `-${(cardHeights[groupIndex] ?? 0) + 24}px`
                    }
                    padding={0}
                    cursor="pointer"
                    width="full"
                    transition={
                      transitionsEnabled ? "all .2s linear" : undefined
                    }
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
  },
  (prevProps, nextProps) => {
    return (
      prevProps.project === nextProps.project &&
      prevProps.traceGroups
        .flatMap((group) => group.map((trace) => trace.trace_id))
        .join() ===
        nextProps.traceGroups
          .flatMap((group) => group.map((trace) => trace.trace_id))
          .join() &&
      JSON.stringify(prevProps.checksMap) ===
        JSON.stringify(nextProps.checksMap)
    );
  }
);

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
      <MenuList zIndex="popover">
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
