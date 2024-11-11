import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
} from "@chakra-ui/icons";
import {
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  Container,
  HStack,
  Heading,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Select,
  Skeleton,
  Spacer,
  Table,
  TableContainer,
  Tag,
  TagLabel,
  TagLeftIcon,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit,
  List,
  RefreshCw,
  Shield,
  CheckSquare,
} from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { Trace, ElasticSearchEvaluation } from "~/server/tracer/types";
import { getEvaluatorDefinitions } from "~/server/evaluations/getEvaluator";
import { api } from "~/utils/api";
import { durationColor } from "~/utils/durationColor";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { useFilterParams } from "../../hooks/useFilterParams";

import Parse from "papaparse";
import { useLocalStorage } from "usehooks-ts";
import { titleCase } from "../../utils/stringCasing";
import { useDrawer } from "../CurrentDrawer";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { evaluationStatusColor } from "../checks/EvaluationStatus";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle } from "../filters/FilterToggle";
import { ToggleAnalytics, ToggleTableView } from "./HeaderButtons";
import type { TraceWithGuardrail } from "./MessageCard";

export function MessagesTable() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const [totalHits, setTotalHits] = useState<number>(0);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const { filterParams, queryOpts } = useFilterParams();
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      query: getSingleQueryParam(router.query.query),
      groupBy: "none",
      pageOffset: pageOffset,
      pageSize: pageSize,
      sortBy: getSingleQueryParam(router.query.sortBy),
      sortDirection: getSingleQueryParam(router.query.orderBy),
    },
    queryOpts
  );

  const topics = api.topics.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: project?.id !== undefined,
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
      <Tooltip label={`${annotations?.length} annotations`}>
        <HStack
          marginRight={1}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: traceId,
              annotationTab: true,
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
          <Td
            key={index}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            <Tooltip label={traceCheck?.details}>
              {traceCheck?.status === "processed" ? (
                <Text color={evaluationStatusColor(traceCheck)}>
                  {evaluator?.isGuardrail
                    ? traceCheck.passed
                      ? "Passed"
                      : "Failed"
                    : traceCheck.label !== undefined
                    ? traceCheck.label
                    : traceCheck.score !== undefined
                    ? numeral(traceCheck.score).format("0.[00]")
                    : "N/A"}
                </Text>
              ) : (
                <Text
                  color={traceCheck ? evaluationStatusColor(traceCheck) : ""}
                >
                  {titleCase(traceCheck?.status ?? "-")}
                </Text>
              )}
            </Tooltip>
          </Td>
        );
      },
      value: (_trace: Trace, evaluations: ElasticSearchEvaluation[]) => {
        const checkId = columnKey.split(".")[1];
        const traceCheck = evaluations.find(
          (evaluation) => evaluation.evaluator_id === checkId
        );
        return traceCheck?.status === "processed"
          ? numeral(traceCheck?.score).format("0.[00]")
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
          <Td key={index} textAlign="right">
            <HStack position="relative" align="right">
              <Spacer />
              {annotationCount(trace.trace_id)}
              <Checkbox
                colorScheme="blue"
                isChecked={selectedTraceIds.includes(trace.trace_id)}
                onChange={() => traceSelection(trace.trace_id)}
              />
            </HStack>
          </Td>
        );
      },
      value: () => "",
    },
    trace_id: {
      name: "ID",
      sortable: true,
      render: (trace: Trace, index: number) => (
        <Td
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {trace.trace_id}
        </Td>
      ),
      value: (trace: Trace) => trace.trace_id,
    },
    "timestamps.started_at": {
      name: "Timestamp",
      sortable: true,
      render: (trace: Trace, index: number) => (
        <Td
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {new Date(trace.timestamps.started_at).toLocaleString()}
        </Td>
      ),
      value: (trace: Trace) =>
        new Date(trace.timestamps.started_at).toISOString(),
    },
    "input.value": {
      name: "Input",
      sortable: false,
      width: 300,
      render: (trace, index) => (
        <Td
          key={index}
          maxWidth="300px"
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Tooltip label={trace.input?.value ?? ""}>
            <Text noOfLines={1} wordBreak="break-all" display="block">
              {trace.input?.value ? trace.input?.value : "<empty>"}
            </Text>
          </Tooltip>
        </Td>
      ),
      value: (trace: Trace) => trace.input?.value ?? "",
    },
    "output.value": {
      name: "Output",
      sortable: false,
      width: 300,
      render: (trace, index) =>
        trace.error ? (
          <Td
            key={index}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            <Text
              noOfLines={1}
              maxWidth="300px"
              display="block"
              color="red.400"
            >
              {trace.error.message}
            </Text>
          </Td>
        ) : (
          <Td
            key={index}
            onClick={() =>
              openDrawer("traceDetails", {
                traceId: trace.trace_id,
              })
            }
          >
            <Tooltip
              label={
                trace.output?.value
                  ? trace.output?.value
                  : trace.lastGuardrail
                  ? [trace.lastGuardrail.name, trace.lastGuardrail.details]
                      .filter((x) => x)
                      .join(": ")
                  : undefined
              }
            >
              {trace.lastGuardrail ? (
                <Tag colorScheme="blue" paddingLeft={2}>
                  <TagLeftIcon boxSize="16px" as={Shield} />
                  <TagLabel>Blocked by Guardrail</TagLabel>
                </Tag>
              ) : trace.output?.value ? (
                <Text noOfLines={1} display="block" maxWidth="300px">
                  {trace.output?.value}
                </Text>
              ) : (
                <Text>{"<empty>"}</Text>
              )}
            </Tooltip>
          </Td>
        ),
      value: (trace: Trace) => trace.output?.value ?? "",
    },
    "metrics.first_token_ms": {
      name: "First Token",
      sortable: true,
      render: (trace, index) => (
        <Td
          key={index}
          isNumeric
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
        </Td>
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
        <Td
          key={index}
          isNumeric
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
        </Td>
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
        <Td
          key={index}
          isNumeric
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {trace.metrics?.completion_tokens}
        </Td>
      ),
      value: (trace: Trace) => trace.metrics?.completion_tokens ?? 0,
    },
    "metrics.prompt_tokens": {
      name: "Prompt Tokens",
      sortable: true,
      render: (trace, index) => (
        <Td
          key={index}
          isNumeric
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          {trace.metrics?.prompt_tokens}
        </Td>
      ),
      value: (trace: Trace) => trace.metrics?.prompt_tokens ?? 0,
    },
    "metrics.total_cost": {
      name: "Total Cost",
      sortable: true,
      render: (trace, index) => (
        <Td
          key={index}
          isNumeric
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Text>{numeral(trace.metrics?.total_cost).format("$0.00[000]")}</Text>
        </Td>
      ),
      value: (trace: Trace) =>
        numeral(trace.metrics?.total_cost).format("$0.00[000]"),
    },
    metadata: {
      name: "Metadata",
      sortable: true,
      render: (trace, index) => (
        <Td
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Tooltip label={JSON.stringify(trace.metadata)}>
            <Text noOfLines={1} display="block" maxWidth="300px">
              {JSON.stringify(trace.metadata) === "{}"
                ? ""
                : JSON.stringify(trace.metadata)}
            </Text>
          </Tooltip>
        </Td>
      ),
      value: (trace: Trace) => JSON.stringify(trace.metadata),
    },
    contexts: {
      name: "Contexts",
      sortable: true,
      render: (trace, index) => (
        <Td
          key={index}
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            })
          }
        >
          <Tooltip label={JSON.stringify(trace.contexts)}>
            <Text noOfLines={1} display="block" maxWidth="300px">
              {JSON.stringify(trace.contexts) === "[]"
                ? ""
                : JSON.stringify(trace.contexts)}
            </Text>
          </Tooltip>
        </Td>
      ),
      value: (trace: Trace) => JSON.stringify(trace.contexts),
    },
    topic: {
      name: "Topic",
      sortable: true,
      render: (trace, index) => (
        <Td
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
        </Td>
      ),
      value: (trace: Trace) =>
        topics.data?.find((topic) => topic.id === trace.metadata.topic_id)
          ?.name ?? "",
    },
    subtopic: {
      name: "Subtopic",
      sortable: true,
      render: (trace, index) => (
        <Td
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
        </Td>
      ),
      value: (trace: Trace) =>
        topics.data?.find((topic) => topic.id === trace.metadata.subtopic_id)
          ?.name ?? "",
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

  useEffect(() => {
    if (traceGroups.isFetched) {
      const totalHits: number = traceGroups.data?.totalHits ?? 0;

      setTotalHits(totalHits);
    }
  }, [traceGroups.data?.totalHits, traceGroups.isFetched]);

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
        <ChevronUpIcon
          width={5}
          height={5}
          color={"blue.500"}
          cursor={"pointer"}
          onClick={() => sortBy(columnKey)}
        />
      ) : (
        <ChevronDownIcon
          width={5}
          height={5}
          color={"blue.500"}
          cursor={"pointer"}
          onClick={() => sortBy(columnKey)}
        />
      );
    }
    return (
      <ArrowUpDownIcon
        cursor={"pointer"}
        marginLeft={1}
        color={"gray.400"}
        onClick={() => sortBy(columnKey)}
      />
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

  const { isOpen, onOpen, onClose } = useDisclosure();
  const checkedHeaderColumnsEntries = Object.entries(
    selectedHeaderColumns
  ).filter(([_, { enabled }]) => enabled);

  const fetchAllTraces = async () => {
    const allGroups = [];
    const allChecks = {};
    let currentOffset = 0;
    const batchSize = 5000;
    const maxResults = 50_000;

    while (currentOffset < maxResults) {
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
      });

      if (!batch.groups.length) break;

      allGroups.push(...batch.groups);
      Object.assign(allChecks, batch.traceChecks);
      currentOffset += batchSize;
    }

    return {
      groups: allGroups,
      traceChecks: allChecks,
    };
  };

  const downloadCSV = async (selection = false) => {
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

  const selectAllTraces = () => {
    setSelectedTraceIds(
      traceGroups.data?.groups.flatMap((traceGroup) =>
        traceGroup.map((trace) => trace.trace_id)
      ) ?? []
    );
  };

  return (
    <>
      <Container maxW={"calc(100vw - 200px)"} padding={6}>
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
          <Button
            colorScheme="black"
            minWidth="fit-content"
            variant={"ghost"}
            padding={0}
            onClick={() => selectAllTraces()}
            rightIcon={<CheckSquare size={17} />}
          >
            Select all
          </Button>
          <Tooltip label={totalHits >= 10_000 ? "Up to 10.000 items" : ""}>
            <Button
              colorScheme="black"
              minWidth="fit-content"
              variant={downloadTraces.isLoading ? "outline" : "ghost"}
              onClick={() => void downloadCSV()}
              isLoading={downloadTraces.isLoading}
              loadingText="Downloading..."
            >
              Export all <DownloadIcon marginLeft={2} />
            </Button>
          </Tooltip>
          <ToggleTableView />

          <Popover isOpen={isOpen} onClose={onClose} placement="bottom-end">
            <PopoverTrigger>
              <Button variant="outline" onClick={onOpen} minWidth="fit-content">
                <HStack spacing={2}>
                  <List size={16} />
                  <Text>Columns</Text>
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
                <VStack align="start" spacing={2}>
                  {Object.entries({
                    ...headerColumns,
                    ...selectedHeaderColumns,
                  }).map(([columnKey, column]) => {
                    if (columnKey === "checked") {
                      return null;
                    }
                    return (
                      <Checkbox
                        key={columnKey}
                        isChecked={selectedHeaderColumns[columnKey]?.enabled}
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
              </PopoverBody>
            </PopoverContent>
          </Popover>
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
          <FilterToggle />
        </HStack>

        <HStack align={"top"} gap={8}>
          <Card>
            <CardBody>
              {checkedHeaderColumnsEntries.length === 0 && (
                <Text>No columns selected</Text>
              )}
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      {checkedHeaderColumnsEntries
                        .filter(([_, { enabled }]) => enabled)
                        .map(([columnKey, { name }], index) => (
                          <Th key={index}>
                            <HStack spacing={1}>
                              <Text width={headerColumns[columnKey]?.width}>
                                {name}
                              </Text>
                              {headerColumns[columnKey]?.sortable &&
                                sortButton(columnKey)}
                            </HStack>
                          </Th>
                        ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {traceGroups.data?.groups.flatMap((traceGroup) =>
                      traceGroup.map((trace) => (
                        <Tr key={trace.trace_id} role="button" cursor="pointer">
                          {checkedHeaderColumnsEntries.map(
                            ([column, { name }], index) =>
                              headerColumns[column]?.render(trace, index) ??
                              headerColumnForEvaluation({
                                columnKey: column,
                                checkName: name,
                              })?.render(trace, index)
                          )}
                        </Tr>
                      ))
                    )}
                    {traceGroups.isLoading &&
                      Array.from({ length: 3 }).map((_, i) => (
                        <Tr key={i}>
                          {Array.from({
                            length: checkedHeaderColumnsEntries.length,
                          }).map((_, i) => (
                            <Td key={i}>
                              <Skeleton height="20px" />
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    {traceGroups.isFetched &&
                      traceGroups.data?.groups.length === 0 && (
                        <Tr>
                          <Td />
                          <Td colSpan={checkedHeaderColumnsEntries.length}>
                            No messages found, try selecting different filters
                            and dates
                          </Td>
                        </Tr>
                      )}
                  </Tbody>
                </Table>
              </TableContainer>
            </CardBody>
          </Card>
          <FilterSidebar />
        </HStack>

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
      </Container>
      {selectedTraceIds.length > 0 && (
        <Box
          position="fixed"
          bottom={6}
          left="50%"
          transform="translateX(-50%)"
          backgroundColor="#ffffff"
          padding="8px"
          paddingX="16px"
          border="1px solid #ccc"
          boxShadow="base"
          borderRadius={"md"}
        >
          <HStack gap={3}>
            <Text>{selectedTraceIds.length} Traces selected</Text>
            <Button
              colorScheme="black"
              minWidth="fit-content"
              variant="outline"
              onClick={() => void downloadCSV(true)}
            >
              Export <DownloadIcon marginLeft={2} />
            </Button>

            <Text>or</Text>
            <Button
              colorScheme="black"
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
          </HStack>
        </Box>
      )}
    </>
  );
}
