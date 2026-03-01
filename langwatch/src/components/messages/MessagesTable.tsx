import {
  Badge,
  Box,
  Button,
  Card,
  CloseButton,
  Container,
  Heading,
  HStack,
  Icon,
  Portal,
  Progress,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Tag,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import numeral from "numeral";
import Parse from "papaparse";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, Edit, Shield } from "react-feather";
import { LuChevronsUpDown, LuList, LuRefreshCw } from "react-icons/lu";
import { useLocalStorage } from "usehooks-ts";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceUpdateListener } from "~/hooks/useTraceUpdateListener";
import { getEvaluatorDefinitions } from "~/server/evaluations/getEvaluator";
import type { ElasticSearchEvaluation, Trace } from "~/server/tracer/types";
import { api } from "~/utils/api";
import { durationColor } from "~/utils/durationColor";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { stringifyIfObject } from "~/utils/stringifyIfObject";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useMinimumSpinDuration } from "../../hooks/useMinimumSpinDuration";
import { getColorForString } from "../../utils/rotatingColors";
import { titleCase } from "../../utils/stringCasing";
import { AddAnnotationQueueDrawer } from "../AddAnnotationQueueDrawer";
import { evaluationStatusColor } from "../checks/EvaluationStatus";
import { Delayed } from "../Delayed";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle, useFilterToggle } from "../filters/FilterToggle";
import { HoverableBigText } from "../HoverableBigText";
import { NavigationFooter, useNavigationFooter } from "../NavigationFooter";
import { OverflownTextWithTooltip } from "../OverflownText";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { AddParticipants } from "../traces/AddParticipants";
import { formatEvaluationSingleValue } from "../traces/EvaluationStatusItem";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { PageLayout } from "../ui/layouts/PageLayout";
import { Link } from "../ui/link";
import { Popover } from "../ui/popover";
import { RedactedField } from "../ui/RedactedField";
import { toaster } from "../ui/toaster";
import { Tooltip } from "../ui/tooltip";
import { ToggleAnalytics, ToggleTableView } from "./HeaderButtons";
import type { TraceWithGuardrail } from "./MessageCard";

export interface MessagesTableProps {
  hideExport?: boolean;
  hideTableToggle?: boolean;
  hideAddToQueue?: boolean;
  hideAnalyticsToggle?: boolean;
}

export function MessagesTable({
  hideExport = false,
  hideTableToggle = false,
  hideAddToQueue = false,
  hideAnalyticsToggle = false,
}: MessagesTableProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const queryClient = api.useContext();

  const { filterParams, queryOpts } = useFilterParams();
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);

  const { showFilters } = useFilterToggle();

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const navigationFooter = useNavigationFooter();

  // Live endDate that gets bumped to "now" on SSE events so the query
  // window extends to include newly-arrived traces.
  const [liveEndDate, setLiveEndDate] = useState(filterParams.endDate);
  useEffect(() => {
    setLiveEndDate(filterParams.endDate);
  }, [filterParams.endDate]);

  const urlScrollId = getSingleQueryParam(router.query.scrollId);

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      endDate: liveEndDate,
      query: getSingleQueryParam(router.query.query),
      groupBy: "none",
      pageOffset: navigationFooter.pageOffset,
      pageSize: navigationFooter.pageSize,
      sortBy: getSingleQueryParam(router.query.sortBy),
      sortDirection: getSingleQueryParam(router.query.orderBy),
      scrollId: urlScrollId,
    },
    queryOpts,
  );

  navigationFooter.useUpdateTotalHits(traceGroups);

  // --- Live update state ---
  const [displayData, setDisplayData] = useState(traceGroups.data);
  const [pendingData, setPendingData] = useState<typeof traceGroups.data>(
    undefined,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [isMouseOnTable, setIsMouseOnTable] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear display data when user-driven query params change (filter/sort/page)
  // so skeletons show during loading. SSE-driven liveEndDate changes don't go through here.
  const userQueryKey = JSON.stringify({
    filterParams,
    pageOffset: navigationFooter.pageOffset,
    pageSize: navigationFooter.pageSize,
    sortBy: getSingleQueryParam(router.query.sortBy),
    sortDirection: getSingleQueryParam(router.query.orderBy),
    query: getSingleQueryParam(router.query.query),
    scrollId: urlScrollId,
  });
  const prevUserQueryKeyRef = useRef(userQueryKey);
  useEffect(() => {
    if (prevUserQueryKeyRef.current !== userQueryKey) {
      prevUserQueryKeyRef.current = userQueryKey;
      setDisplayData(undefined);
      setPendingData(undefined);
      setPendingCount(0);
      setHighlightIds(new Set());
    }
  }, [userQueryKey]);

  // Ref to access current displayData inside SSE callback without stale closures
  const displayDataRef = useRef(displayData);
  displayDataRef.current = displayData;

  // When the user clicks the "N new" pill, bypass the mouse-on-table buffer
  const bypassBufferRef = useRef(false);

  // Track when mouse last left the table so SSE handler can auto-insert
  // new traces if the user has been idle for a while
  const mouseLeftAtRef = useRef<number>(0);
  const IDLE_THRESHOLD_MS = 60_000;

  useTraceUpdateListener({
    projectId: project?.id ?? "",
    onTraceSummaryUpdated: (traceIds) => {
      const displayedIds = new Set(
        displayDataRef.current?.groups.flatMap((g) =>
          g.map((t) => t.trace_id),
        ) ?? [],
      );

      // If no traceIds in payload (defensive), fall back to full refetch
      if (traceIds.length === 0) {
        setLiveEndDate(Date.now());
        return;
      }

      const hasVisibleUpdate = traceIds.some((id) => displayedIds.has(id));
      const newCount = traceIds.filter(
        (id) => !displayedIds.has(id),
      ).length;

      if (hasVisibleUpdate) {
        // Same endDate refetch — refreshes visible trace data without pulling new traces
        void traceGroups.refetch();
      }
      if (newCount > 0) {
        const pageHasFocus = document.hasFocus();
        const mouseIdleMs = Date.now() - mouseLeftAtRef.current;
        const mouseIdleLongEnough =
          mouseLeftAtRef.current > 0 && mouseIdleMs >= IDLE_THRESHOLD_MS;

        if (!pageHasFocus || mouseIdleLongEnough) {
          // Page unfocused or mouse idle long enough — fetch and show directly
          setLiveEndDate(Date.now());
        } else {
          setPendingCount((prev) => prev + newCount);
        }
      }
    },
    enabled: !!project,
    pageOffset: navigationFooter.pageOffset,
  });

  // Decide how to display new data from the query
  useEffect(() => {
    if (!traceGroups.data) return;

    // First load — just show the data
    if (!displayData) {
      setDisplayData(traceGroups.data);
      return;
    }

    const currentIds = new Set(
      traceGroups.data.groups.flatMap((g) => g.map((t) => t.trace_id)),
    );
    const displayedIds = new Set(
      displayData.groups.flatMap((g) => g.map((t) => t.trace_id)),
    );
    const newIds = new Set(
      [...currentIds].filter((id) => !displayedIds.has(id)),
    );

    // Completely different data set (filter/sort/page change) — replace immediately
    const overlap = [...currentIds].filter((id) => displayedIds.has(id));
    if (overlap.length === 0 && displayedIds.size > 0) {
      setDisplayData(traceGroups.data);
      setPendingData(undefined);
      setPendingCount(0);
      setHighlightIds(new Set());
      return;
    }

    if (newIds.size === 0) {
      // Only updates to existing traces — swap silently
      setDisplayData(traceGroups.data);
    } else if (isMouseOnTable && !bypassBufferRef.current) {
      // New traces but user is reading — buffer
      setPendingData(traceGroups.data);
      setPendingCount(newIds.size);
    } else {
      // New traces, user not looking (or bypass active) — show with highlight
      bypassBufferRef.current = false;
      setHighlightIds(newIds);
      setDisplayData(traceGroups.data);
      setPendingCount(0);
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(
        () => setHighlightIds(new Set()),
        2000,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceGroups.data]);

  const acceptPending = () => {
    if (pendingData && displayData) {
      // We have buffered data from a visible-trace refetch that arrived
      // while the mouse was on the table — show it now.
      const displayedIds = new Set(
        displayData.groups.flatMap((g) => g.map((t) => t.trace_id)),
      );
      const freshIds = new Set(
        pendingData.groups.flatMap((g) => g.map((t) => t.trace_id)),
      );
      const newIds = new Set(
        [...freshIds].filter((id) => !displayedIds.has(id)),
      );
      setHighlightIds(newIds);
      setDisplayData(pendingData);
      setPendingData(undefined);
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(
        () => setHighlightIds(new Set()),
        2000,
      );
    }

    // Bump liveEndDate to pull new traces into the query window + refetch
    bypassBufferRef.current = true;
    setPendingCount(0);
    setLiveEndDate(Date.now());
  };

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const isRefreshing = useMinimumSpinDuration(
    traceGroups.isLoading || traceGroups.isRefetching,
  );

  const topics = api.topics.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: project?.id !== undefined,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  const downloadTraces = api.traces.getAllForDownload.useMutation();

  const [previousTraceChecks, setPreviousTraceChecks] = useState<
    Record<string, ElasticSearchEvaluation[]>
  >(traceGroups.data?.traceChecks ?? {});
  useEffect(() => {
    if (traceGroups.data?.traceChecks) {
      setPreviousTraceChecks(traceGroups.data.traceChecks);
    }
  }, [traceGroups.data]);

  const traceCheckColumnsAvailable = Object.fromEntries(
    Object.values(
      traceGroups.data?.traceChecks ?? previousTraceChecks ?? {},
    ).flatMap((checks) =>
      checks.map((check: any) => [
        `evaluations.${check.evaluator_id}`,
        check.name,
      ]),
    ),
  );

  const [scrollXPosition, setScrollXPosition] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const annotationCount = (count: number, traceId: string) => {
    return (
      <Box position="relative">
        <Tooltip
          content={`${count} ${count === 1 ? "annotation" : "annotations"}`}
        >
          <HStack
            paddingLeft={2}
            marginRight={1}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId,
                selectedTab: "messages",
              })
            }
          >
            <Edit size="18px" />
            <Box
              width="13px"
              height="13px"
              borderRadius="12px"
              background="green.500"
              position="absolute"
              top="10px"
              left="0px"
              paddingTop="1px"
              fontSize="9px"
              color="white"
              lineHeight="12px"
              textAlign="center"
            >
              {count}
            </Box>
          </HStack>
        </Tooltip>
      </Box>
    );
  };

  const traceSelection = (trace_id: string) => {
    setSelectedTraceIds((prevTraceChecks: string[]) => {
      const index = prevTraceChecks.indexOf(trace_id);
      if (index === -1) {
        return [...prevTraceChecks, trace_id];
      } else {
        const updatedTraces = [...prevTraceChecks];
        updatedTraces.splice(index, 1);
        return updatedTraces;
      }
    });
  };

  type HeaderColumn = {
    name: string;
    sortable: boolean;
    width?: number;
    render: (trace: TraceWithGuardrail, index: number) => React.ReactNode;
    value: (
      trace: TraceWithGuardrail,
      evaluations: ElasticSearchEvaluation[],
    ) => string | number | Date;
  };

  const headerColumnForEvaluation = ({
    columnKey,
    checkName,
  }: {
    columnKey: string;
    checkName: string;
  }): HeaderColumn => {
    return {
      name: checkName,
      sortable: true,
      render: (trace, index) => {
        const checkId = columnKey.split(".")[1];
        const traceCheck = displayData?.traceChecks?.[
          trace.trace_id
        ]?.find(
          (traceCheck_: ElasticSearchEvaluation) =>
            traceCheck_.evaluator_id === checkId,
        );
        const evaluator = getEvaluatorDefinitions(traceCheck?.type ?? "");

        return (
          <Table.Cell
            key={index}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            <Tooltip content={traceCheck?.details}>
              {traceCheck?.status === "processed" ? (
                <Text color={evaluationStatusColor(traceCheck)}>
                  {evaluator?.isGuardrail
                    ? traceCheck.passed
                      ? "Pass"
                      : "Fail"
                    : formatEvaluationSingleValue(traceCheck)}
                </Text>
              ) : (
                <Text
                  color={traceCheck ? evaluationStatusColor(traceCheck) : ""}
                >
                  {titleCase(traceCheck?.status ?? "-")}
                </Text>
              )}
            </Tooltip>
          </Table.Cell>
        );
      },
      value: (_trace: Trace, evaluations: ElasticSearchEvaluation[]) => {
        const checkId = columnKey.split(".")[1];
        const traceCheck = evaluations.find(
          (evaluation) => evaluation.evaluator_id === checkId,
        );
        const evaluator = getEvaluatorDefinitions(traceCheck?.type ?? "");

        return traceCheck?.status === "processed"
          ? evaluator?.isGuardrail
            ? traceCheck.passed
              ? "Pass"
              : "Fail"
            : formatEvaluationSingleValue(traceCheck)
          : (traceCheck?.status ?? "-");
      },
    };
  };

  const headerColumns: Record<string, HeaderColumn> = {
    checked: {
      name: "",
      sortable: false,
      render: (trace, index) => {
        return (
          <Table.Cell
            key={index}
            textAlign="right"
            position="sticky"
            left={0}
            transition="box-shadow 0.3s ease-in-out"
            boxShadow={
              scrollXPosition > 0
                ? "0 2px 5px rgba(0, 0, 0, 0.1)"
                : "0 0 0 rgba(0, 0, 0, 0)"
            }
            paddingX={4}
            background="bg.panel"
          >
            <HStack>
              <Checkbox
                colorPalette="blue"
                checked={selectedTraceIds.includes(trace.trace_id)}
                onCheckedChange={() => traceSelection(trace.trace_id)}
              />
              {trace.annotations?.hasAnnotation
                ? annotationCount(trace.annotations.count, trace.trace_id)
                : null}
            </HStack>
          </Table.Cell>
        );
      },
      value: () => "",
    },
    trace_id: {
      name: "ID",
      sortable: true,
      width: 100,
      render: (trace: Trace, index: number) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
          maxWidth="150px"
        >
          <OverflownTextWithTooltip>{trace.trace_id}</OverflownTextWithTooltip>
        </Table.Cell>
      ),
      value: (trace: Trace) => trace.trace_id,
    },
    "timestamps.started_at": {
      name: "Timestamp",
      sortable: true,
      width: 160,
      render: (trace: Trace, index: number) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {new Date(trace.timestamps.started_at).toLocaleString()}
        </Table.Cell>
      ),
      value: (trace: Trace) =>
        new Date(trace.timestamps.started_at).toISOString(),
    },
    "input.value": {
      name: "Input",
      sortable: false,
      width: 300,
      render: (trace, index) => {
        const safeInputValue = getSafeRenderInputValueFromTrace(trace);

        return (
          <Table.Cell
            key={index}
            maxWidth="300px"
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            {!safeInputValue && isTraceRecent(trace) ? (
              <ProcessingIndicator />
            ) : (
              <Tooltip
                content={<Box whiteSpace="pre-wrap">{safeInputValue}</Box>}
              >
                <RedactedField field="input">
                  <Text truncate display="block">
                    {safeInputValue}
                  </Text>
                </RedactedField>
              </Tooltip>
            )}
          </Table.Cell>
        );
      },
      value: (trace: Trace) => getSafeRenderInputValueFromTrace(trace),
    },
    "output.value": {
      name: "Output",
      sortable: false,
      width: 300,
      render: (trace, index) => {
        const safeOutputValue = getSafeRenderOutputValueFromTrace(trace);

        return trace.error && !trace.output?.value ? (
          <Table.Cell
            key={index}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            <OverflownTextWithTooltip color="red.400">
              {trace.error.message}
            </OverflownTextWithTooltip>
          </Table.Cell>
        ) : (
          <Table.Cell
            key={index}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            <Tooltip
              content={
                <Box whiteSpace="pre-wrap">
                  {safeOutputValue
                    ? safeOutputValue
                    : trace.lastGuardrail
                      ? [trace.lastGuardrail.name, trace.lastGuardrail.details]
                          .filter((x) => x)
                          .join(": ")
                      : undefined}
                </Box>
              }
            >
              <RedactedField field="output">
                {trace.lastGuardrail ? (
                  <Tag.Root colorPalette="blue" paddingLeft={2}>
                    <Shield size={16} />
                    <Tag.Label>Blocked by Guardrail</Tag.Label>
                  </Tag.Root>
                ) : trace.output?.value ? (
                  <Box lineClamp={1} maxWidth="300px">
                    {safeOutputValue}
                  </Box>
                ) : isTraceRecent(trace) ? (
                  <ProcessingIndicator />
                ) : (
                  <Box>{"<empty>"}</Box>
                )}
              </RedactedField>
            </Tooltip>
          </Table.Cell>
        );
      },

      value: (trace: Trace) => getSafeRenderOutputValueFromTrace(trace),
    },
    "metadata.labels": {
      name: "Labels",
      sortable: true,
      render: (trace, index) => (
        <Table.Cell key={index}>
          <HStack gap={1}>
            {(trace.metadata.labels ?? []).map((label) => (
              <Badge
                key={label}
                size="sm"
                paddingX={2}
                background={getColorForString("colors", label).background}
                color={getColorForString("colors", label).color}
                fontSize="12px"
              >
                {label}
              </Badge>
            ))}
          </HStack>
        </Table.Cell>
      ),
      value: (trace: Trace) => trace.metadata?.labels?.join(", ") ?? "",
    },
    "metrics.first_token_ms": {
      name: "First Token",
      sortable: true,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Text
            color={durationColor("first_token", trace.metrics?.first_token_ms)}
          >
            {trace.metrics?.first_token_ms
              ? numeral(trace.metrics.first_token_ms / 1000).format("0.[0]") +
                "s"
              : "-"}
          </Text>
        </Table.Cell>
      ),
      value: (trace: Trace) => {
        return trace.metrics?.first_token_ms
          ? numeral(trace.metrics.first_token_ms / 1000).format("0.[0]") + "s"
          : "-";
      },
    },
    "metrics.total_time_ms": {
      name: "Completion Time",
      sortable: true,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Text
            color={durationColor("total_time", trace.metrics?.total_time_ms)}
          >
            {trace.metrics?.total_time_ms
              ? numeral(trace.metrics.total_time_ms / 1000).format("0.[0]") +
                "s"
              : "-"}
          </Text>
        </Table.Cell>
      ),
      value: (trace: Trace) => {
        return trace.metrics?.total_time_ms
          ? numeral(trace.metrics.total_time_ms / 1000).format("0.[0]") + "s"
          : "-";
      },
    },
    "metrics.completion_tokens": {
      name: "Completion Token",
      sortable: true,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {trace.metrics?.completion_tokens}
        </Table.Cell>
      ),
      value: (trace: Trace) => trace.metrics?.completion_tokens ?? 0,
    },
    "metrics.prompt_tokens": {
      name: "Prompt Tokens",
      sortable: true,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {trace.metrics?.prompt_tokens}
        </Table.Cell>
      ),
      value: (trace: Trace) => trace.metrics?.prompt_tokens ?? 0,
    },
    "metrics.total_cost": {
      name: "Total Cost",
      sortable: true,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Text>{numeral(trace.metrics?.total_cost).format("$0.00[000]")}</Text>
        </Table.Cell>
      ),
      value: (trace: Trace) =>
        numeral(trace.metrics?.total_cost).format("$0.00[000]"),
    },
    metadata: {
      name: "Metadata",
      sortable: false,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          minWidth="300px"
          maxWidth="300px"
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <HoverableBigText lineClamp={1}>
            {JSON.stringify(trace.metadata, null, 2)}
          </HoverableBigText>
        </Table.Cell>
      ),
      value: (trace: Trace) => JSON.stringify(trace.metadata),
    },
    topic: {
      name: "Topic",
      sortable: false,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Text>
            {
              topics.data?.find((topic) => topic.id === trace.metadata.topic_id)
                ?.name
            }
          </Text>
        </Table.Cell>
      ),
      value: (trace: Trace) =>
        topics.data?.find((topic) => topic.id === trace.metadata.topic_id)
          ?.name ?? "",
    },
    subtopic: {
      name: "Subtopic",
      sortable: false,
      render: (trace, index) => (
        <Table.Cell
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Text>
            {
              topics.data?.find(
                (topic) => topic.id === trace.metadata.subtopic_id,
              )?.name
            }
          </Text>
        </Table.Cell>
      ),
      value: (trace: Trace) =>
        topics.data?.find((topic) => topic.id === trace.metadata.subtopic_id)
          ?.name ?? "",
    },
    events: {
      name: "Events",
      sortable: false,
      render: (trace, index) => (
        <Table.Cell key={index}>{trace.events?.length}</Table.Cell>
      ),
      value: (trace: Trace) => trace.events?.length ?? 0,
    },

    ...Object.fromEntries(
      Object.entries(traceCheckColumnsAvailable).map(
        ([columnKey, checkName]) => [
          columnKey,
          headerColumnForEvaluation({ columnKey, checkName }),
        ],
      ),
    ),
  };

  const [localStorageHeaderColumns, setLocalStorageHeaderColumns] =
    useLocalStorage<
      | Record<keyof typeof headerColumns, { enabled: boolean; name: string }>
      | undefined
    >(`${project?.id ?? ""}_columns.v3`, undefined);

  const [selectedHeaderColumns, setSelectedHeaderColumns] = useState<
    Record<keyof typeof headerColumns, { enabled: boolean; name: string }>
  >(
    localStorageHeaderColumns
      ? localStorageHeaderColumns
      : Object.fromEntries(
          Object.entries(headerColumns).map(([key, column]) => [
            key,
            {
              enabled: key !== "trace.trace_id",
              name: column.name,
            },
          ]),
        ),
  );

  const isFirstRender = useRef(true);

  const sortBy = (columnKey: string) => {
    const sortBy = columnKey;
    const orderBy =
      getSingleQueryParam(router.query.orderBy) === "asc" ? "desc" : "asc";

    void router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        sortBy,
        orderBy,
      },
    });
  };

  const sortButton = (columnKey: string) => {
    if (getSingleQueryParam(router.query.sortBy) === columnKey) {
      return getSingleQueryParam(router.query.orderBy) === "asc" ? (
        <Icon
          width={4}
          height={4}
          color="blue.500"
          cursor="pointer"
          onClick={() => sortBy(columnKey)}
          marginTop="-5px"
        >
          <ChevronUp />
        </Icon>
      ) : (
        <Icon
          width={4}
          height={4}
          color="blue.400"
          cursor="pointer"
          onClick={() => sortBy(columnKey)}
          marginTop="5px"
        >
          <ChevronDown />
        </Icon>
      );
    }
    return (
      <Icon
        width={4}
        height={4}
        cursor="pointer"
        onClick={() => sortBy(columnKey)}
        color="fg.subtle"
      >
        <LuChevronsUpDown />
      </Icon>
    );
  };

  useEffect(() => {
    if (
      traceGroups.isFetched &&
      !traceGroups.isFetching &&
      isFirstRender.current
    ) {
      isFirstRender.current = false;

      if (!localStorageHeaderColumns) {
        setSelectedHeaderColumns((prevSelectedHeaderColumns) => ({
          ...prevSelectedHeaderColumns,
          ...Object.fromEntries(
            Object.entries(traceCheckColumnsAvailable)
              .filter(
                ([key]) =>
                  !Object.keys(prevSelectedHeaderColumns).includes(key),
              )
              .map(([key, name]) => [key, { enabled: true, name }]),
          ),
        }));
      }
    }
  }, [traceGroups, traceCheckColumnsAvailable, localStorageHeaderColumns]);

  const { open, onOpen, onClose } = useDisclosure();
  const checkedHeaderColumnsEntries = Object.entries(
    selectedHeaderColumns,
  ).filter(([_, { enabled }]) => enabled);

  const [downloadProgress, setDownloadProgress] = useState(0);

  const fetchAllTraces = async () => {
    const allGroups = [];
    const allChecks = {};
    let currentOffset = 0;
    const batchSize = 5000;

    setDownloadProgress(10);

    const initialBatch = await downloadTraces.mutateAsync({
      ...filterParams,
      query: getSingleQueryParam(router.query.query),
      groupBy: "none",
      pageOffset: navigationFooter.pageOffset,
      pageSize: navigationFooter.pageSize,
      sortBy: getSingleQueryParam(router.query.sortBy),
      sortDirection: getSingleQueryParam(router.query.orderBy),
      includeSpans: true,
    });

    let scrollId = initialBatch.scrollId;
    allGroups.push(...initialBatch.groups);
    Object.assign(allChecks, initialBatch.traceChecks);

    const totalHits = initialBatch.totalHits;
    let processedItems = initialBatch.groups.length;
    setDownloadProgress((processedItems / totalHits) * 100);

    while (scrollId) {
      const batch = await downloadTraces.mutateAsync({
        ...filterParams,
        query: getSingleQueryParam(router.query.query),
        groupBy: "none",
        pageOffset: currentOffset,
        pageSize: batchSize,
        sortBy: getSingleQueryParam(router.query.sortBy),
        sortDirection: getSingleQueryParam(router.query.orderBy),
        includeSpans: true,
        scrollId: scrollId,
      });
      processedItems += batch.groups.length;

      setDownloadProgress((processedItems / totalHits) * 100);

      scrollId = batch.scrollId;

      if (!batch.groups.length) break;

      allGroups.push(...batch.groups);
      Object.assign(allChecks, batch.traceChecks);
      currentOffset += batchSize;
    }

    setDownloadProgress(0);

    return {
      groups: allGroups,
      traceChecks: allChecks,
    };
  };

  const downloadCSV = async (selection = false) => {
    try {
      await downloadCSV_(selection);
    } catch (error) {
      toaster.create({
        title: "Error Downloading CSV",
        description: (error as any).toString(),
        type: "error",
        meta: {
          closable: true,
        },
      });
      console.error(error);
    }
  };
  const queueItem = api.annotation.createQueueItem.useMutation();
  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    [],
  );

  const dialog = useDisclosure();
  const queueDrawerOpen = useDisclosure();

  const sendToQueue = () => {
    queueItem.mutate(
      {
        projectId: project?.id ?? "",
        traceIds: selectedTraceIds,
        annotators: annotators.map((p) => p.id),
      },
      {
        onSuccess: () => {
          // Invalidate count queries to update sidebar counts
          void queryClient.annotation.getPendingItemsCount.invalidate();
          void queryClient.annotation.getAssignedItemsCount.invalidate();
          void queryClient.annotation.getQueueItemsCounts.invalidate();

          dialog.onClose();
          toaster.create({
            title: "Trace added to annotation queue",
            description: "Successfully added traces to annotation queue",
            type: "success",
            meta: {
              closable: true,
            },
            action: {
              label: "View Queues",
              onClick: () => {
                void router.push(`/${project?.slug}/annotations/`);
              },
            },
          });
        },
      },
    );
  };

  const downloadCSV_ = async (selection = false) => {
    const traceGroups_ = selection
      ? (displayData ?? {
          groups: [],
          traceChecks: {} as Record<string, ElasticSearchEvaluation[]>,
        })
      : await fetchAllTraces();

    const checkedHeaderColumnsEntries_ = checkedHeaderColumnsEntries.filter(
      ([column, _]) => column !== "checked",
    );

    const evaluations: Record<string, ElasticSearchEvaluation[]> =
      traceGroups_.traceChecks;

    const getValueForColumn = (
      trace: TraceWithGuardrail,
      column: string,
      name: string,
    ) => {
      return (
        headerColumns[column]?.value?.(
          trace,
          evaluations[trace.trace_id] ?? [],
        ) ??
        headerColumnForEvaluation({
          columnKey: column,
          checkName: name,
        }).value(trace, evaluations[trace.trace_id] ?? [])
      );
    };

    let csv;
    if (selection) {
      csv = traceGroups_.groups
        .flatMap((traceGroup) =>
          traceGroup
            .filter((trace) => selectedTraceIds.includes(trace.trace_id))
            .map((trace) =>
              checkedHeaderColumnsEntries_.map(([column, { name }]) =>
                getValueForColumn(trace, column, name),
              ),
            ),
        )
        .filter((row) => row.some((cell) => cell !== ""));
    } else {
      csv = traceGroups_.groups.flatMap((traceGroup) =>
        traceGroup.map((trace) =>
          checkedHeaderColumnsEntries_
            .filter(([column, _]) => column !== "checked")
            .map(([column, { name }]) =>
              getValueForColumn(trace, column, name),
            ),
        ),
      );
    }

    const fields = checkedHeaderColumnsEntries_
      .map(([_, { name }]) => {
        return name;
      })
      .filter((field) => field !== undefined);

    const csvBlob = Parse.unparse({
      fields: fields,
      data: csv ?? [],
    });

    const url = window.URL.createObjectURL(new Blob([csvBlob]));

    const link = document.createElement("a");
    link.href = url;
    const today = new Date();
    const formattedDate = today.toISOString().split("T")[0];
    const fileName = `Traces - ${formattedDate}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const toggleAllTraces = () => {
    if (selectedTraceIds.length === displayData?.groups.length) {
      setSelectedTraceIds([]);
    } else {
      setSelectedTraceIds(
        displayData?.groups.flatMap((traceGroup) =>
          traceGroup.map((trace) => trace.trace_id),
        ) ?? [],
      );
    }
  };

  return (
    <>
      <style>{`
        @keyframes trace-highlight-fade {
          from { background-color: rgba(59, 130, 246, 0.10); }
          to { background-color: transparent; }
        }
        .trace-highlight-new td {
          animation: trace-highlight-fade 2s ease-out;
        }
      `}</style>
      <PageLayout.Header>
        <PageLayout.Heading>Traces</PageLayout.Heading>
        <Tooltip content="Refresh">
          <PageLayout.HeaderButton
            variant="ghost"
            onClick={() => setLiveEndDate(Date.now())}
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
        {pendingCount > 0 && (
          <Button
            size="xs"
            variant="subtle"
            colorPalette="blue"
            onClick={acceptPending}
          >
            {pendingCount} new
          </Button>
        )}
        <Spacer />
        {!hideExport && (
          <Tooltip
            disabled={navigationFooter.totalHits < 10_000}
            content={
              navigationFooter.totalHits >= 10_000 ? "Up to 10.000 items" : ""
            }
          >
            <PageLayout.HeaderButton
              variant={downloadTraces.isPending ? "ghost" : "outline"}
              onClick={() => void downloadCSV()}
              loading={downloadTraces.isPending}
              loadingText="Downloading..."
            >
              <Download size={16} />
              Export all
            </PageLayout.HeaderButton>
          </Tooltip>
        )}
        {!hideTableToggle && <ToggleTableView />}

        {/** Column selector - start */}
        <Popover.Root
          open={open}
          onOpenChange={({ open }) => (open ? onOpen() : onClose())}
        >
          <Popover.Trigger asChild>
            <PageLayout.HeaderButton>
              <HStack gap={2}>
                <LuList />
                <Text>Columns</Text>
                <Box>
                  <ChevronDown />
                </Box>
              </HStack>
            </PageLayout.HeaderButton>
          </Popover.Trigger>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.CloseTrigger />
            <Popover.Header>
              <Heading size="sm">Filter Traces</Heading>
            </Popover.Header>
            <Popover.Body padding={4}>
              <VStack align="start" gap={2}>
                {Object.entries({
                  ...headerColumns,
                  ...selectedHeaderColumns,
                }).map(([columnKey, column]) => {
                  if (columnKey === "checked") return null;
                  return (
                    <Checkbox
                      key={columnKey}
                      checked={selectedHeaderColumns[columnKey]?.enabled}
                      onChange={() => {
                        setSelectedHeaderColumns({
                          ...selectedHeaderColumns,
                          [columnKey]: {
                            enabled: !selectedHeaderColumns[columnKey]?.enabled,
                            name: column.name,
                          },
                        });

                        setLocalStorageHeaderColumns({
                          ...selectedHeaderColumns,
                          [columnKey]: {
                            enabled: !selectedHeaderColumns[columnKey]?.enabled,
                            name: column.name,
                          },
                        });
                      }}
                    >
                      {column.name}
                    </Checkbox>
                  );
                })}
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Root>
        {/** Column selector - end */}

        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <FilterToggle />
        {!hideAnalyticsToggle && <ToggleAnalytics />}
      </PageLayout.Header>
      <HStack align="top" gap={8}>
        <Box
          flex="1"
          minWidth="0"
          onMouseEnter={() => {
            setIsMouseOnTable(true);
            mouseLeftAtRef.current = 0;
          }}
          onMouseLeave={() => {
            setIsMouseOnTable(false);
            mouseLeftAtRef.current = Date.now();
            if (pendingCount > 0 || pendingData) acceptPending();
          }}
        >
          <VStack
            gap={0}
            align="start"
            width="full"
            maxWidth={
              showFilters ? "calc(100vw - 550px)" : "calc(100vw - 200px)"
            }
          >
            {downloadProgress > 0 && (
              <Progress.Root
                colorPalette="orange"
                value={downloadProgress}
                size="xs"
                width="full"
                boxShadow="none"
              >
                <Progress.Track boxShadow="none" background="none">
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            )}
            {checkedHeaderColumnsEntries.length === 0 && (
              <Text>No columns selected</Text>
            )}
            <Table.ScrollArea
              ref={scrollRef}
              onScroll={() => {
                if (scrollRef.current) {
                  setScrollXPosition(scrollRef.current.scrollLeft);
                }
              }}
              minHeight="calc(100vh - 188px)"
            >
              <Table.Root size="sm" height="fit-content" variant="line">
                <Table.Header>
                  <Table.Row background="transparent">
                    {checkedHeaderColumnsEntries
                      .filter(([_, { enabled }]) => enabled)
                      .map(([columnKey, { name }], index) => (
                        <Table.ColumnHeader
                          key={index}
                          paddingX={4}
                          paddingY={4}
                          background="bg.panel"
                          borderRadius="4px 0 0 0"
                          {...(columnKey === "checked"
                            ? {
                                position: "sticky",
                                left: 0,
                                transition: "box-shadow 0.3s ease-in-out",
                                boxShadow:
                                  scrollXPosition > 0
                                    ? "0 2px 5px rgba(0, 0, 0, 0.1)"
                                    : "0 0 0 rgba(0, 0, 0, 0)",
                              }
                            : {})}
                        >
                          {columnKey === "checked" ? (
                            <HStack width="full">
                              <Checkbox
                                checked={
                                  selectedTraceIds.length ===
                                  displayData?.groups.length
                                }
                                onCheckedChange={() => toggleAllTraces()}
                              />
                            </HStack>
                          ) : (
                            <HStack gap={1}>
                              <Text
                                minWidth={headerColumns[columnKey]?.width}
                                width="full"
                              >
                                {name}
                              </Text>
                              {headerColumns[columnKey]?.sortable &&
                                sortButton(columnKey)}
                            </HStack>
                          )}
                        </Table.ColumnHeader>
                      ))}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {displayData?.groups.flatMap((traceGroup) =>
                    traceGroup.map((trace) => (
                      <Table.Row
                        key={trace.trace_id}
                        role="button"
                        cursor="pointer"
                        className={
                          highlightIds.has(trace.trace_id)
                            ? "trace-highlight-new"
                            : undefined
                        }
                      >
                        {checkedHeaderColumnsEntries.map(
                          ([column, { name }], index) =>
                            headerColumns[column]?.render(trace, index) ??
                            headerColumnForEvaluation({
                              columnKey: column,
                              checkName: name,
                            })?.render(trace, index),
                        )}
                      </Table.Row>
                    )),
                  )}
                  {!displayData &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <Table.Row key={i}>
                        {Array.from({
                          length: checkedHeaderColumnsEntries.length,
                        }).map((_, i) => (
                          <Table.Cell key={i}>
                            <Delayed key={1} takeSpace>
                              <Skeleton height="16px" />
                            </Delayed>
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))}
                  {traceGroups.isFetched &&
                    displayData?.groups.length === 0 && (
                      <Table.Row>
                        <Table.Cell />
                        <Table.Cell
                          colSpan={checkedHeaderColumnsEntries.length}
                        >
                          No messages found, try selecting different filters and
                          dates
                        </Table.Cell>
                      </Table.Row>
                    )}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
            <NavigationFooter
              {...navigationFooter}
              scrollId={traceGroups.data?.scrollId}
            />
          </VStack>
        </Box>

        {showFilters && (
          <Box paddingRight={4}>
            <FilterSidebar />
          </Box>
        )}
      </HStack>
      {selectedTraceIds.length > 0 && (
        <Box
          position="fixed"
          bottom={10}
          left="50%"
          transform="translateX(-50%)"
          backgroundColor="#ffffff"
          padding="8px"
          paddingX="16px"
          border="1px solid #ccc"
          boxShadow="0 0 15px rgba(0, 0, 0, 0.2)"
          borderRadius="md"
        >
          <HStack gap={3}>
            <Text whiteSpace="nowrap">
              {selectedTraceIds.length}{" "}
              {selectedTraceIds.length === 1 ? "trace" : "traces"} selected
            </Text>
            {!hideExport && (
              <>
                <Button
                  colorPalette="black"
                  minWidth="fit-content"
                  variant="outline"
                  onClick={() => void downloadCSV(true)}
                >
                  Export <Download size={16} style={{ marginLeft: 8 }} />
                </Button>
                <Text>or</Text>
              </>
            )}

            <Button
              colorPalette="black"
              type="submit"
              variant="outline"
              minWidth="fit-content"
              onClick={() => {
                openDrawer("addDatasetRecord", {
                  selectedTraceIds,
                });
              }}
            >
              Add to Dataset
            </Button>
            {!hideAddToQueue && (
              <Dialog.Root
                open={dialog.open}
                onOpenChange={(e) =>
                  e.open ? dialog.onOpen() : dialog.onClose()
                }
              >
                <Dialog.Trigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => dialog.onOpen()}
                  >
                    Add to Queue
                  </Button>
                </Dialog.Trigger>
                <Portal>
                  <Dialog.Content>
                    <Dialog.Header>
                      <Dialog.Title>Add to Queue</Dialog.Title>
                    </Dialog.Header>
                    <Dialog.Body>
                      <Dialog.Description mb="4">
                        Add selected traces to an annotation queue
                      </Dialog.Description>
                      <AddParticipants
                        annotators={annotators}
                        setAnnotators={setAnnotators}
                        queueDrawerOpen={queueDrawerOpen}
                        sendToQueue={sendToQueue}
                        isLoading={queueItem.isLoading}
                      />
                    </Dialog.Body>

                    <Dialog.CloseTrigger asChild>
                      <CloseButton size="sm" onClick={() => dialog.onClose()} />
                    </Dialog.CloseTrigger>
                  </Dialog.Content>
                  <AddAnnotationQueueDrawer
                    open={queueDrawerOpen.open}
                    onClose={queueDrawerOpen.onClose}
                  />
                </Portal>
              </Dialog.Root>
            )}
          </HStack>
        </Box>
      )}
    </>
  );
}

function getSafeRenderInputValueFromTrace(trace: Trace): string {
  return stringifyIfObject(trace.input?.value);
}

function getSafeRenderOutputValueFromTrace(trace: Trace): string {
  return stringifyIfObject(trace.output?.value);
}

function isTraceRecent(trace: Trace): boolean {
  return trace.timestamps.started_at > Date.now() - 20_000;
}

function ProcessingIndicator() {
  return (
    <HStack gap={2} color="fg.muted">
      <Spinner size="xs" />
      <Text fontSize="sm">processing</Text>
    </HStack>
  );
}
