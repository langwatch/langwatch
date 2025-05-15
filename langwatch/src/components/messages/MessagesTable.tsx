import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  HStack,
  Heading,
  Icon,
  Progress,
  Skeleton,
  Spacer,
  Table,
  Tag,
  Text,
  VStack,
  useDisclosure,
  Portal,
  CloseButton,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Edit,
  List,
  RefreshCw,
  Shield,
} from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getEvaluatorDefinitions } from "~/server/evaluations/getEvaluator";
import type { ElasticSearchEvaluation, Trace } from "~/server/tracer/types";
import { api } from "~/utils/api";
import { durationColor } from "~/utils/durationColor";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { useFilterParams } from "../../hooks/useFilterParams";

import Parse from "papaparse";
import { LuChevronsUpDown } from "react-icons/lu";
import { useLocalStorage } from "usehooks-ts";
import { getColorForString } from "../../utils/rotatingColors";
import { titleCase } from "../../utils/stringCasing";
import { useDrawer } from "../CurrentDrawer";
import { Delayed } from "../Delayed";
import { HoverableBigText } from "../HoverableBigText";
import { OverflownTextWithTooltip } from "../OverflownText";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { evaluationStatusColor } from "../checks/EvaluationStatus";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle, useFilterToggle } from "../filters/FilterToggle";
import { formatEvaluationSingleValue } from "../traces/EvaluationStatusItem";
import { Checkbox } from "../ui/checkbox";
import { Popover } from "../ui/popover";
import { toaster } from "../ui/toaster";
import { Tooltip } from "../ui/tooltip";
import { Dialog } from "../ui/dialog";
import { Link } from "../ui/link";
import { ToggleAnalytics, ToggleTableView } from "./HeaderButtons";
import type { TraceWithGuardrail } from "./MessageCard";
import {
  MessagesNavigationFooter,
  useMessagesNavigationFooter,
} from "./MessagesNavigationFooter";

import { AddParticipants } from "../traces/AddParticipants";
import { AddAnnotationQueueDrawer } from "../AddAnnotationQueueDrawer";
import { RedactedField } from "../ui/RedactedField";

export interface MessagesTableProps {
  hideExport?: boolean;
  hideTableToggle?: boolean;
  hideAddToQueue?: boolean;
}

export function MessagesTable({
  hideExport = false,
  hideTableToggle = false,
  hideAddToQueue = false,
}: MessagesTableProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const { filterParams, queryOpts } = useFilterParams();
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);

  const { showFilters } = useFilterToggle();

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const navigationFooter = useMessagesNavigationFooter();

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      query: getSingleQueryParam(router.query.query),
      groupBy: "none",
      pageOffset: navigationFooter.pageOffset,
      pageSize: navigationFooter.pageSize,
      sortBy: getSingleQueryParam(router.query.sortBy),
      sortDirection: getSingleQueryParam(router.query.orderBy),
    },
    queryOpts
  );

  navigationFooter.useUpdateTotalHits(traceGroups);

  const topics = api.topics.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: project?.id !== undefined,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );

  const downloadTraces = api.traces.getAllForDownload.useMutation();

  const traceIds =
    traceGroups.data?.groups.flatMap((group) =>
      group.map((trace) => trace.trace_id)
    ) ?? [];

  const getAnnotations = api.annotation.getByTraceIds.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled: project?.id !== undefined,
      refetchOnWindowFocus: false,
    }
  );

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
      traceGroups.data?.traceChecks ?? previousTraceChecks ?? {}
    ).flatMap((checks) =>
      checks.map((check: any) => [
        `evaluations.${check.evaluator_id}`,
        check.name,
      ])
    )
  );

  const [scrollXPosition, setScrollXPosition] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const annotationCount = (traceId: string) => {
    if (getAnnotations.isLoading) {
      return;
    }
    const annotations = getAnnotations.data?.filter(
      (annotation) => annotation.traceId === traceId
    );
    if (annotations?.length === 0) {
      return null;
    }
    return (
      <Box position="relative">
        <Tooltip
          content={`${annotations?.length} ${
            annotations?.length === 1 ? "annotation" : "annotations"
          }`}
        >
          <HStack
            paddingLeft={2}
            marginRight={1}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: traceId,
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
              {annotations?.length}
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
      evaluations: ElasticSearchEvaluation[]
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
        const traceCheck = traceGroups.data?.traceChecks?.[
          trace.trace_id
        ]?.find(
          (traceCheck_: ElasticSearchEvaluation) =>
            traceCheck_.evaluator_id === checkId
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
          (evaluation) => evaluation.evaluator_id === checkId
        );
        const evaluator = getEvaluatorDefinitions(traceCheck?.type ?? "");

        return traceCheck?.status === "processed"
          ? evaluator?.isGuardrail
            ? traceCheck.passed
              ? "Pass"
              : "Fail"
            : formatEvaluationSingleValue(traceCheck)
          : traceCheck?.status ?? "-";
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
            background="white"
          >
            <HStack>
              <Checkbox
                colorPalette="blue"
                checked={selectedTraceIds.includes(trace.trace_id)}
                onCheckedChange={() => traceSelection(trace.trace_id)}
              />
              {annotationCount(trace.trace_id)}
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
      render: (trace, index) => (
        <Table.Cell
          key={index}
          maxWidth="300px"
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Tooltip
            content={
              <Box whiteSpace="pre-wrap">{trace.input?.value ?? ""}</Box>
            }
          >
            <RedactedField field="input">
              <Text truncate display="block">
                {trace.input?.value ? trace.input?.value : "<empty>"}
              </Text>
            </RedactedField>
          </Tooltip>
        </Table.Cell>
      ),
      value: (trace: Trace) => trace.input?.value ?? "",
    },
    "output.value": {
      name: "Output",
      sortable: false,
      width: 300,
      render: (trace, index) =>
        trace.error && !trace.output?.value ? (
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
                  {trace.output?.value
                    ? trace.output?.value
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
                    {trace.output?.value}
                  </Box>
                ) : (
                  <Box>{"<empty>"}</Box>
                )}
              </RedactedField>
            </Tooltip>
          </Table.Cell>
        ),
      value: (trace: Trace) => trace.output?.value ?? "",
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
      sortable: true,
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
            {trace.contexts
              ? JSON.stringify(trace.metadata, null, 2)
              : JSON.stringify(trace.metadata)}
          </HoverableBigText>
        </Table.Cell>
      ),
      value: (trace: Trace) => JSON.stringify(trace.metadata),
    },
    contexts: {
      name: "Contexts",
      sortable: true,
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
          <HoverableBigText
            lineClamp={1}
            expandedVersion={JSON.stringify(trace.contexts, null, 2)}
          >
            {trace.contexts
              ? JSON.stringify(trace.contexts.map((c) => c.content))
              : ""}
          </HoverableBigText>
        </Table.Cell>
      ),
      value: (trace: Trace) => JSON.stringify(trace.contexts),
    },
    topic: {
      name: "Topic",
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
          <Text>
            {
              topics.data?.find(
                (topic) => topic.id === trace.metadata.subtopic_id
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
      sortable: true,
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
        ]
      )
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
          ])
        )
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
        color="gray.400"
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
                ([key]) => !Object.keys(prevSelectedHeaderColumns).includes(key)
              )
              .map(([key, name]) => [key, { enabled: true, name }])
          ),
        }));
      }
    }
  }, [traceGroups, traceCheckColumnsAvailable, localStorageHeaderColumns]);

  const { open, onOpen, onClose } = useDisclosure();
  const checkedHeaderColumnsEntries = Object.entries(
    selectedHeaderColumns
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
      includeContexts: checkedHeaderColumnsEntries.some(
        ([column]) => column === "contexts"
      ),
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
        includeContexts: checkedHeaderColumnsEntries.some(
          ([column]) => column === "contexts"
        ),
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
        placement: "top-end",
      });
      console.error(error);
    }
  };
  const queueItem = api.annotation.createQueueItem.useMutation();
  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    []
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
          dialog.onClose();
          toaster.create({
            title: "Trace added to annotation queue",
            description: (
              <>
                <Link
                  href={`/${project?.slug}/annotations/`}
                  textDecoration="underline"
                >
                  View Queues
                </Link>
              </>
            ),
            type: "success",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
      }
    );
  };

  const downloadCSV_ = async (selection = false) => {
    const traceGroups_ = selection
      ? traceGroups.data ?? {
          groups: [],
          traceChecks: {} as Record<string, ElasticSearchEvaluation[]>,
        }
      : await fetchAllTraces();

    const checkedHeaderColumnsEntries_ = checkedHeaderColumnsEntries.filter(
      ([column, _]) => column !== "checked"
    );

    const evaluations: Record<string, ElasticSearchEvaluation[]> =
      traceGroups_.traceChecks;

    const getValueForColumn = (
      trace: TraceWithGuardrail,
      column: string,
      name: string
    ) => {
      return (
        headerColumns[column]?.value?.(
          trace,
          evaluations[trace.trace_id] ?? []
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
                getValueForColumn(trace, column, name)
              )
            )
        )
        .filter((row) => row.some((cell) => cell !== ""));
    } else {
      csv = traceGroups_.groups.flatMap((traceGroup) =>
        traceGroup.map((trace) =>
          checkedHeaderColumnsEntries_
            .filter(([column, _]) => column !== "checked")
            .map(([column, { name }]) => getValueForColumn(trace, column, name))
        )
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
    const fileName = `Messages - ${formattedDate}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const toggleAllTraces = () => {
    if (selectedTraceIds.length === traceGroups.data?.groups.length) {
      setSelectedTraceIds([]);
    } else {
      setSelectedTraceIds(
        traceGroups.data?.groups.flatMap((traceGroup) =>
          traceGroup.map((trace) => trace.trace_id)
        ) ?? []
      );
    }
  };

  return (
    <>
      <Container maxWidth="calc(100vw - 50px)" padding={6}>
        <HStack width="full" align="top" paddingBottom={6}>
          <HStack align="center" gap={6}>
            <Heading as="h1" size="lg" paddingTop={1}>
              Messages
            </Heading>
            <ToggleAnalytics />
            <Tooltip content="Refresh">
              <Button
                variant="outline"
                minWidth={0}
                height="32px"
                padding={2}
                marginTop={2}
                onClick={() => void traceGroups.refetch()}
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
          <HStack gap={1} marginBottom="-8px">
            {!hideTableToggle && <ToggleTableView />}
            {!hideExport && (
              <Tooltip
                disabled={navigationFooter.totalHits < 10_000}
                content={
                  navigationFooter.totalHits >= 10_000
                    ? "Up to 10.000 items"
                    : ""
                }
              >
                <Button
                  colorPalette="black"
                  variant={downloadTraces.isLoading ? "outline" : "ghost"}
                  onClick={() => void downloadCSV()}
                  loading={downloadTraces.isLoading}
                  loadingText="Downloading..."
                >
                  <Download size={16} />
                  Export all
                </Button>
              </Tooltip>
            )}

            {/** Column selector - start */}
            <Popover.Root
              open={open}
              onOpenChange={({ open }) => (open ? onOpen() : onClose())}
            >
              <Popover.Trigger asChild>
                <Button variant="ghost" minWidth="fit-content">
                  <HStack gap={2}>
                    <List size={16} />
                    <Text>Columns</Text>
                    <Box>
                      <ChevronDown />
                    </Box>
                  </HStack>
                </Button>
              </Popover.Trigger>
              <Popover.Content>
                <Popover.Arrow />
                <Popover.CloseTrigger />
                <Popover.Header>
                  <Heading size="sm">Filter Messages</Heading>
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
                                enabled:
                                  !selectedHeaderColumns[columnKey]?.enabled,
                                name: column.name,
                              },
                            });

                            setLocalStorageHeaderColumns({
                              ...selectedHeaderColumns,
                              [columnKey]: {
                                enabled:
                                  !selectedHeaderColumns[columnKey]?.enabled,
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

            <PeriodSelector
              period={{ startDate, endDate }}
              setPeriod={setPeriod}
            />
            <FilterToggle />
          </HStack>
        </HStack>

        <HStack align="top" gap={8}>
          <Box flex="1" minWidth="0">
            <VStack gap={0} align="start">
              <Card.Root height="fit-content" width="full">
                <Card.Body
                  padding={0}
                  width="full"
                  maxWidth={
                    showFilters ? "calc(100vw - 450px)" : "calc(100vw - 130px)"
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
                                background="white"
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
                                        traceGroups.data?.groups.length
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
                        {traceGroups.data?.groups.flatMap((traceGroup) =>
                          traceGroup.map((trace) => (
                            <Table.Row
                              key={trace.trace_id}
                              role="button"
                              cursor="pointer"
                            >
                              {checkedHeaderColumnsEntries.map(
                                ([column, { name }], index) =>
                                  headerColumns[column]?.render(trace, index) ??
                                  headerColumnForEvaluation({
                                    columnKey: column,
                                    checkName: name,
                                  })?.render(trace, index)
                              )}
                            </Table.Row>
                          ))
                        )}
                        {traceGroups.isLoading &&
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
                          traceGroups.data?.groups.length === 0 && (
                            <Table.Row>
                              <Table.Cell />
                              <Table.Cell
                                colSpan={checkedHeaderColumnsEntries.length}
                              >
                                No messages found, try selecting different
                                filters and dates
                              </Table.Cell>
                            </Table.Row>
                          )}
                      </Table.Body>
                    </Table.Root>
                  </Table.ScrollArea>
                </Card.Body>
              </Card.Root>
              <MessagesNavigationFooter {...navigationFooter} />
            </VStack>
          </Box>

          <FilterSidebar />
        </HStack>
      </Container>
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
                  <Dialog.Backdrop />

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
