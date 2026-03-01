import {
  Alert,
  Box,
  Card,
  Container,
  HStack,
  LinkBox,
  Separator,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { useRouter } from "next/router";
import React, { createRef, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Maximize2 } from "react-feather";
import { LuLayers, LuRefreshCw } from "react-icons/lu";
import { formatMilliseconds } from "~/utils/formatMilliseconds";
import { Menu } from "../../components/ui/menu";
import { Radio, RadioGroup } from "../../components/ui/radio";
import { Tooltip } from "../../components/ui/tooltip";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useMinimumSpinDuration } from "../../hooks/useMinimumSpinDuration";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceUpdateListener } from "../../hooks/useTraceUpdateListener";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { getSingleQueryParam } from "../../utils/getSingleQueryParam";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle } from "../filters/FilterToggle";
import { NavigationFooter, useNavigationFooter } from "../NavigationFooter";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { PageLayout } from "../ui/layouts/PageLayout";
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
  const navigationFooter = useNavigationFooter();

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      query: getSingleQueryParam(router.query.query),
      groupBy,
      pageOffset: navigationFooter.pageOffset,
      pageSize: navigationFooter.pageSize,
    },
    queryOpts,
  );
  navigationFooter.useUpdateTotalHits(traceGroups);

  const isRefreshing = useMinimumSpinDuration(
    traceGroups.isLoading || traceGroups.isRefetching,
  );

  const traceIds =
    traceGroups.data?.groups.flatMap((group) =>
      group.map((trace) => trace.trace_id),
    ) ?? [];
  const evaluations = api.traces.getEvaluationsMultiple.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled: traceIds.length > 0,
      refetchInterval: evaluationsCheckInterval,
      refetchOnWindowFocus: false,
    },
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
              new Date().getTime() - 1000 * 60 * 60 * 1,
        );
      if (pendingEvaluations.length > 0) {
        setEvaluationsCheckInterval(5000);
      } else {
        setEvaluationsCheckInterval(undefined);
      }
    }
  }, [evaluations.data]);

  useTraceUpdateListener({
    projectId: project?.id ?? "",
    refetch: () => {
      void traceGroups.refetch();
      void evaluations.refetch();
    },
    enabled: !!project,
    pageOffset: navigationFooter.pageOffset,
  });

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Traces</PageLayout.Heading>
        <Tooltip content="Refresh">
          <PageLayout.HeaderButton
            variant="ghost"
            onClick={() => {
              void traceGroups.refetch();
              void evaluations.refetch();
            }}
          >
            <LuRefreshCw
              className={
                isRefreshing
                  ? "refresh-icon animation-spinning"
                  : "refresh-icon"
              }
            />
          </PageLayout.HeaderButton>
        </Tooltip>
        <Spacer />
        <ToggleTableView />
        <GroupingSelector />
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <FilterToggle defaultShowFilters={true} />
        <ToggleAnalytics />
      </PageLayout.Header>
      <Container maxW={"calc(min(1440px, 100vw - 200px))"} padding={6}>
        <HStack align="start" gap={8}>
          <VStack gap={6} width="full">
            {project &&
            traceGroups.data &&
            traceGroups.data.groups.length > 0 ? (
              <ExpandableMessages
                project={project}
                traceGroups={traceGroups.data.groups}
                checksMap={evaluations.data}
              />
            ) : traceGroups.data ? (
              <Alert.Root status="info">
                <Alert.Indicator />
                <Alert.Content>No messages found</Alert.Content>
              </Alert.Root>
            ) : traceGroups.isError ? (
              <Alert.Root status="error">
                <Alert.Indicator />
                <Alert.Content>
                  An error has occurred trying to load the messages
                </Alert.Content>
              </Alert.Root>
            ) : (
              <>
                <MessageSkeleton />
                <MessageSkeleton />
                <MessageSkeleton />
              </>
            )}
            <NavigationFooter {...navigationFooter} />
          </VStack>
          <FilterSidebar defaultShowFilters={true} />
        </HStack>
      </Container>
    </>
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
    const cardRefs = (traceGroups ?? []).map(() => createRef<HTMLDivElement>());
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
      const zIndex = 1000 + traceGroups.length - groupIndex;

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
                background: "bg.muted",
                borderRadius: "10px",
                padding: "40px",
                width: "calc(100% + 80px)",
                cursor: "n-resize",
              }
            : {
                background: "transparent",
                className: "card-stack-content",
                marginBottom:
                  traceGroup.length > 2 ? 4 : traceGroup.length > 1 ? 2 : 0,
                marginLeft:
                  traceGroup.length > 2 ? -4 : traceGroup.length > 1 ? -2 : 0,
                cursor: "pointer",
                width: "full",
                _hover: {
                  transform: "scale(1.04)",
                  zIndex,
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
              fontSize="13px"
              fontWeight={600}
              color="fg.muted"
              cursor="default"
            >
              <HStack gap={1}>
                <Text flexShrink={0}>User ID: </Text>
                <Text>{traceGroup[0]?.metadata.user_id ?? "null"}</Text>
                <Separator orientation="vertical" height="20px" />
              </HStack>
            </Box>
          )}
          {isExpanded && groupBy === "thread_id" && (
            <>
              <Box
                className="group-title"
                position="absolute"
                left="64px"
                marginTop="-22px"
                fontSize="13px"
                fontWeight={600}
                color="fg.muted"
                cursor="default"
              >
                <HStack gap={1}>
                  <Text>Thread ID:</Text>
                  <Text>{traceGroup[0]?.metadata.thread_id ?? "null"}</Text>
                </HStack>
              </Box>
              <Box
                className="group-title"
                position="absolute"
                right="64px"
                marginTop="-22px"
                fontSize="13px"
                fontWeight={600}
                color="fg.muted"
                cursor="default"
              >
                <HStack gap={1}>
                  <Text>Thread duration:</Text>
                  <Text>
                    {(() => {
                      const t1 = traceGroup[0]?.timestamps.updated_at;
                      const t2 = traceGroup.at(-1)?.timestamps.updated_at;

                      if (!t1 || !t2) return "N/A";

                      const [start, end] = t1 < t2 ? [t1, t2] : [t2, t1];

                      return formatMilliseconds(end - start);
                    })()}
                  </Text>
                </HStack>
              </Box>
            </>
          )}
          <VStack width="full" gap={6}>
            {traceGroup
              .slice(0, isExpanded ? traceGroup.length : 3)
              .toReversed()
              .map((trace, traceIndex) => {
                const expanded = isExpanded || traceGroup.length === 1;
                const renderContent = isExpanded || traceIndex === 0;

                return (
                  <LinkBox asChild key={trace.trace_id}>
                    <Card.Root
                      key={trace.trace_id}
                      variant="elevated"
                      className="card"
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
                      _hover={
                        expanded
                          ? {
                              transform: "scale(1.04)",
                            }
                          : {}
                      }
                      boxShadow="lg"
                      borderRadius="xl"
                    >
                      {!expanded && (
                        <Box position="absolute" right={6} top={6}>
                          <Maximize2 />
                        </Box>
                      )}
                      <Card.Body padding={7} width="fill">
                        {renderContent && (
                          <MessageCard
                            linkActive={expanded}
                            project={project}
                            trace={trace}
                            checksMap={checksMap}
                          />
                        )}
                      </Card.Body>
                    </Card.Root>
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
  },
);

function MessageSkeleton() {
  return (
    <Card.Root width="full" padding={0} variant="elevated">
      <Card.Body padding={8}>
        <VStack alignItems="flex-start" gap={4}>
          <HStack gap={12} width="full">
            <Box fontSize="24px" fontWeight="bold" width="full">
              <Skeleton width="50%" height="20px" />
            </Box>
          </HStack>
          <VStack gap={4} width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

const groups = {
  thread_id: "Thread ID",
  user_id: "User ID",
  none: "None",
};

const useGroupBy = () => {
  const router = useRouter();

  const groupBy =
    (router.query.group_by as keyof typeof groups | undefined) ?? "thread_id";

  const setGroupBy = (group: keyof typeof groups) => {
    void router.push(
      {
        query: {
          ...router.query,
          group_by: group,
        },
      },
      undefined,
      { shallow: true },
    );
  };

  return [groupBy, setGroupBy] as [typeof groupBy, typeof setGroupBy];
};

function GroupingSelector() {
  const [groupBy, setGroupBy] = useGroupBy();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <PageLayout.HeaderButton>
          <HStack gap={2}>
            <LuLayers />
            <Box>{groups[groupBy]}</Box>
            <Box>
              <ChevronDown />
            </Box>
          </HStack>
        </PageLayout.HeaderButton>
      </Menu.Trigger>
      <Menu.Content>
        <Box paddingX={3} paddingY={2} fontWeight="medium" color="fg.muted">
          Group by
        </Box>
        <RadioGroup
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as keyof typeof groups)}
        >
          {Object.entries(groups).map(([key, value]) => (
            <Menu.Item
              key={key}
              value={key}
              onClick={() => setGroupBy(key as keyof typeof groups)}
            >
              <HStack gap={2}>
                <Radio value={key} />
                <Text>{value}</Text>
              </HStack>
            </Menu.Item>
          ))}
        </RadioGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
