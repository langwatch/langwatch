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
  List,
  Edit,
  RefreshCw,
  Shield,
} from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { Trace, TraceCheck } from "~/server/tracer/types";
import { getEvaluatorDefinitions } from "~/trace_checks/getEvaluator";
import { api } from "~/utils/api";
import { durationColor } from "~/utils/durationColor";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { useFilterParams } from "../../hooks/useFilterParams";

import Parse from "papaparse";
import { useLocalStorage } from "usehooks-ts";
import { checkStatusColorMap } from "../checks/EvaluationStatus";
import { FilterSidebar } from "../filters/FilterSidebar";
import { usePeriodSelector, PeriodSelector } from "../PeriodSelector";
import { FilterToggle } from "../filters/FilterToggle";
import { ToggleAnalytics, ToggleTableView } from "./HeaderButtons";
import { useDrawer } from "../CurrentDrawer";
import type { TraceWithGuardrail } from "./MessageCard";
import { titleCase } from "../../utils/stringCasing";
import { AddDatasetRecordDrawerV2 } from "../AddDatasetRecordDrawer";

export function MessagesTable() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const [totalHits, setTotalHits] = useState<number>(0);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const { filterParams, queryOpts } = useFilterParams();
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);

  const addDatasetModal = useDisclosure();

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
    Record<string, TraceCheck[]>
  >(traceGroups.data?.traceChecks ?? {});
  useEffect(() => {
    if (traceGroups.data?.traceChecks) {
      setPreviousTraceChecks(traceGroups.data.traceChecks);
    }
  }, [traceGroups.data]);
  const traceCheckColumnsAvailable = Object.fromEntries(
    Object.values(traceGroups.data?.traceChecks ?? previousTraceChecks ?? {}).flatMap(
      (checks: any) =>
        checks.map((check: any) => [
          `trace_checks.${check.check_id}`,
          check.check_name,
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

  const headerColumns: Record<
    string,
    {
      name: string;
      sortable: boolean;
      width?: number;
      render: (trace: TraceWithGuardrail, index: number) => React.ReactNode;
      value?: (trace: TraceWithGuardrail) => string | number | Date;
    }
  > = {
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
                onChange={() => traceSelection(trace.trace_id)}
              />
            </HStack>
          </Td>
        );
      },
      value: () => "",
    },
    "trace.timestamps.started_at": {
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
        new Date(trace.timestamps.started_at).toLocaleString(),
    },
    "trace.input.value": {
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
          <Tooltip label={trace.input.value}>
            <Text noOfLines={1} wordBreak="break-all" display="block">
              {trace.input.value}
            </Text>
          </Tooltip>
        </Td>
      ),
      value: (trace: Trace) => trace.input.value,
    },
    "trace.output.value": {
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
              {trace.output?.value ? (
                <Text noOfLines={1} display="block" maxWidth="300px">
                  {trace.output?.value}
                </Text>
              ) : trace.lastGuardrail ? (
                <Tag colorScheme="blue" paddingLeft={2}>
                  <TagLeftIcon boxSize="16px" as={Shield} />
                  <TagLabel>Blocked by Guardrail</TagLabel>
                </Tag>
              ) : (
                <Text>{"<empty>"}</Text>
              )}
            </Tooltip>
          </Td>
        ),
      value: (trace: Trace) => trace.output?.value ?? "",
    },
    "trace.metrics.first_token_ms": {
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
            color={durationColor("first_token", trace.metrics.first_token_ms)}
          >
            {trace.metrics.first_token_ms
              ? numeral(trace.metrics.first_token_ms / 1000).format("0.[0]") +
                "s"
              : "-"}
          </Text>
        </Td>
      ),
      value: (trace: Trace) => {
        return trace.metrics.first_token_ms
          ? numeral(trace.metrics.first_token_ms / 1000).format("0.[0]") + "s"
          : "-";
      },
    },
    "trace.metrics.total_time_ms": {
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
            color={durationColor("total_time", trace.metrics.total_time_ms)}
          >
            {trace.metrics.total_time_ms
              ? numeral(trace.metrics.total_time_ms / 1000).format("0.[0]") +
                "s"
              : "-"}
          </Text>
        </Td>
      ),
      value: (trace: Trace) => {
        return trace.metrics.total_time_ms
          ? numeral(trace.metrics.total_time_ms / 1000).format("0.[0]") + "s"
          : "-";
      },
    },
    "trace.metrics.completion_tokens": {
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
          {trace.metrics.completion_tokens}
        </Td>
      ),
      value: (trace: Trace) => trace.metrics.completion_tokens ?? 0,
    },
    "trace.metrics.prompt_tokens": {
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
          {trace.metrics.prompt_tokens}
        </Td>
      ),
      value: (trace: Trace) => trace.metrics.prompt_tokens ?? 0,
    },
    "trace.metrics.total_cost": {
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
          <Text>{numeral(trace.metrics.total_cost).format("$0.00[000]")}</Text>
        </Td>
      ),
      value: (trace: Trace) =>
        numeral(trace.metrics.total_cost).format("$0.00[000]"),
    },
    "trace.metadata": {
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
    "trace.contexts": {
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
    ...Object.fromEntries(
      Object.entries(traceCheckColumnsAvailable).map(
        ([columnKey, checkName]) => [
          columnKey,
          {
            name: checkName,
            sortable: true,
            render: (trace, index) => {
              const checkId = columnKey.split(".")[1];
              const traceCheck = traceGroups.data?.traceChecks?.[trace.trace_id]?.find(
                (traceCheck_) => traceCheck_.check_id === checkId
              );
              const evaluator = getEvaluatorDefinitions(
                traceCheck?.check_type ?? ""
              );

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
                      <Text color={checkStatusColorMap(traceCheck)}>
                        {evaluator?.isGuardrail
                          ? traceCheck.passed
                            ? "Passed"
                            : "Failed"
                          : traceCheck.score !== undefined
                          ? numeral(traceCheck.score).format("0.[00]")
                          : "N/A"}
                      </Text>
                    ) : (
                      <Text
                        color={
                          traceCheck ? checkStatusColorMap(traceCheck) : ""
                        }
                      >
                        {titleCase(traceCheck?.status ?? "-")}
                      </Text>
                    )}
                  </Tooltip>
                </Td>
              );
            },
            value: (trace: Trace) => {
              const checkId = columnKey.split(".")[1];
              const traceCheck = traceGroups.data?.traceChecks?.[trace.trace_id]?.find(
                (traceCheck_) => traceCheck_.check_id === checkId
              );
              return traceCheck?.status === "processed"
                ? numeral(traceCheck?.score).format("0.[00]")
                : traceCheck?.status ?? "-";
            },
          },
        ]
      )
    ),
  };

  const [localStorageHeaderColumns, setLocalStorageHeaderColumns] =
    useLocalStorage<Record<keyof typeof headerColumns, boolean> | undefined>(
      `${project?.id ?? ""}_columns`,
      undefined
    );

  const [selectedHeaderColumns, setSelectedHeaderColumns] = useState<
    Record<keyof typeof headerColumns, boolean>
  >(
    localStorageHeaderColumns
      ? localStorageHeaderColumns
      : Object.fromEntries(
          Object.keys(headerColumns).map((column) => [column, true])
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
            Object.keys(traceCheckColumnsAvailable)
              .filter(
                (key) => !Object.keys(prevSelectedHeaderColumns).includes(key)
              )
              .map((column) => [column, true])
          ),
        }));
      }
    }
  }, [traceGroups, traceCheckColumnsAvailable, localStorageHeaderColumns]);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const checkedHeaderColumnsEntries = Object.entries(
    selectedHeaderColumns
  ).filter(([_, checked]) => checked);

  const downloadCSV = (selection = false) => {
    let csv;

    if (selection) {
      csv = traceGroups.data?.groups
        .flatMap((traceGroup) =>
          traceGroup
            .filter((trace) => selectedTraceIds.includes(trace.trace_id))
            .map((trace) =>
              checkedHeaderColumnsEntries.map(
                ([column, _]) => headerColumns[column]?.value?.(trace) ?? ""
              )
            )
        )
        .filter((row) => row.some((cell) => cell !== ""));
    } else {
      csv = traceGroups.data?.groups.flatMap((traceGroup) =>
        traceGroup.map((trace) =>
          checkedHeaderColumnsEntries.map(
            ([column, _]) => headerColumns[column]?.value?.(trace) ?? ""
          )
        )
      );
    }

    const fields = checkedHeaderColumnsEntries
      .map(([columnKey, _]) => {
        return headerColumns[columnKey]?.name;
      })
      .filter((field) => field !== undefined);

    const csvBlob = Parse.unparse({
      fields: fields as string[],
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
            variant="ghost"
            onClick={() => downloadCSV()}
          >
            Export all <DownloadIcon marginLeft={2} />
          </Button>
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
                  {Object.entries(headerColumns).map(([columnKey, column]) => {
                    if (columnKey === "checked") {
                      return null;
                    }
                    return (
                      <Checkbox
                        key={columnKey}
                        isChecked={selectedHeaderColumns[columnKey]}
                        onChange={() => {
                          setSelectedHeaderColumns({
                            ...selectedHeaderColumns,
                            [columnKey]: !selectedHeaderColumns[columnKey],
                          });

                          setLocalStorageHeaderColumns({
                            ...selectedHeaderColumns,
                            [columnKey]: !selectedHeaderColumns[columnKey],
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
                        .filter(([_, checked]) => checked)
                        .map(([columnKey, _], index) => (
                          <Th key={index}>
                            <HStack spacing={1}>
                              <Text width={headerColumns[columnKey]?.width}>
                                {headerColumns[columnKey]?.name}
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
                            ([column, _], index) =>
                              headerColumns[column]?.render(trace, index)
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
              onClick={() => downloadCSV(true)}
            >
              Export <DownloadIcon marginLeft={2} />
            </Button>

            <Text>or</Text>
            <Button
              colorScheme="black"
              type="submit"
              variant="outline"
              minWidth="fit-content"
              onClick={addDatasetModal.onOpen}
            >
              Add to Dataset
            </Button>
          </HStack>
        </Box>
      )}
      <AddDatasetRecordDrawerV2
        isOpen={addDatasetModal.isOpen}
        onClose={addDatasetModal.onClose}
        selectedTraceIds={selectedTraceIds}
      />
    </>
  );
}
