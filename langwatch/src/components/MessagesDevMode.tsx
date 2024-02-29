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
import { ArrowUpDownIcon } from "@chakra-ui/icons";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, List } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { Trace } from "~/server/tracer/types";
import { getTraceCheckDefinitions } from "~/trace_checks/registry";
import { api } from "~/utils/api";
import { durationColor } from "~/utils/durationColor";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { useFilterParams } from "../hooks/useFilterParams";
import { DashboardLayout } from "./DashboardLayout";
import { FilterToggle } from "./filters/FilterToggle";
import { PeriodSelector, usePeriodSelector } from "./PeriodSelector";

import { TraceDeatilsDrawer } from "~/components/TraceDeatilsDrawer";

export function MessagesDevMode() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [totalHits, setTotalHits] = useState<number>(0);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const { filterParams, queryOpts } = useFilterParams();

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
      orderBy: getSingleQueryParam(router.query.orderBy),
    },
    queryOpts
  );

  const traceIds =
    traceGroups.data?.groups.flatMap((group) =>
      group.map((trace) => trace.trace_id)
    ) ?? [];

  const traceChecksQuery = api.traces.getTraceChecks.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled: traceIds.length > 0,
      refetchInterval: undefined,
      refetchOnWindowFocus: false,
    }
  );

  const traceCheckColumnsAvailable = Object.fromEntries(
    Object.values(traceChecksQuery.data ?? {}).flatMap((checks) =>
      checks.map((check) => [
        `trace_checks.${check.check_id}`,
        check.check_name,
      ])
    )
  );

  console.log(traceCheckColumnsAvailable);

  const headerColumns: Record<
    string,
    {
      name: string;
      sortable: boolean;
      render: (trace: Trace, index: number) => React.ReactNode;
    }
  > = {
    "trace.timestamps.started_at": {
      name: "Timestamp",
      sortable: true,
      render: (trace, index) => (
        <Td key={index}>
          {new Date(trace.timestamps.started_at).toLocaleString()}
        </Td>
      ),
    },
    "trace.input.value": {
      name: "Input",
      sortable: false,
      render: (trace, index) => (
        <Td key={index} maxWidth="300px">
          <Tooltip label={trace.input.value}>
            <Text noOfLines={1} wordBreak="break-all" display="block">
              {trace.input.value}
            </Text>
          </Tooltip>
        </Td>
      ),
    },
    "trace.output.value": {
      name: "Output",
      sortable: false,
      render: (trace, index) =>
        trace.error ? (
          <Td key={index}>
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
          <Td key={index}>
            <Tooltip label={trace.output?.value}>
              <Text noOfLines={1} display="block" maxWidth="300px">
                {trace.output?.value}
              </Text>
            </Tooltip>
          </Td>
        ),
    },
    "trace.metrics.first_token_ms": {
      name: "First Token",
      sortable: true,
      render: (trace, index) => (
        <Td key={index} isNumeric>
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
    },
    "trace.metrics.total_time_ms": {
      name: "Completion Time",
      sortable: true,
      render: (trace, index) => (
        <Td key={index} isNumeric>
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
    },
    "trace.metrics.completion_tokens": {
      name: "Completion Token",
      sortable: true,
      render: (trace, index) => (
        <Td key={index} isNumeric>
          {trace.metrics.completion_tokens}
        </Td>
      ),
    },
    "trace.metrics.prompt_tokens": {
      name: "Prompt Tokens",
      sortable: true,
      render: (trace, index) => (
        <Td key={index} isNumeric>
          {trace.metrics.prompt_tokens}
        </Td>
      ),
    },
    "trace.metrics.total_cost": {
      name: "Total Cost",
      sortable: true,
      render: (trace, index) => (
        <Td key={index} isNumeric>
          <Text>{numeral(trace.metrics.total_cost).format("$0.00[000]")}</Text>
        </Td>
      ),
    },
    ...Object.fromEntries(
      Object.entries(traceCheckColumnsAvailable).map(
        ([columnKey, checkName]) => [
          columnKey,
          {
            name: checkName,
            sortable: false,
            render: (trace, index) => {
              const checkId = columnKey.split(".")[1];
              const traceCheck = traceChecksQuery.data?.[trace.trace_id]?.find(
                (traceCheck_) => traceCheck_.check_id === checkId
              );
              const checkDefinition = getTraceCheckDefinitions(
                traceCheck?.check_type ?? ""
              );

              return (
                <Td key={index}>
                  {traceCheck?.status === "failed" ? (
                    <Text color="red.400">
                      {checkDefinition?.valueDisplayType == "boolean"
                        ? "Fail"
                        : numeral(traceCheck?.value).format("0.[00]") ?? 0}
                    </Text>
                  ) : traceCheck?.status === "succeeded" ? (
                    <Text color="green.400">
                      {checkDefinition?.valueDisplayType == "boolean"
                        ? "Pass"
                        : numeral(traceCheck?.value).format("0.[00]") ?? 0}
                    </Text>
                  ) : (
                    <Text>{traceCheck?.status ?? "-"}</Text>
                  )}
                </Td>
              );
            },
          },
        ]
      )
    ),
  };

  const [selectedHeaderColumns, setSelectedHeaderColumns] = useState<
    Record<keyof typeof headerColumns, boolean>
  >(
    Object.fromEntries(
      Object.keys(headerColumns).map((column) => [column, true])
    )
  );

  const nextPage = () => {
    setPageOffset(pageOffset + pageSize);
    //setPageSize(pageSize);
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

  useEffect(() => {
    if (
      traceChecksQuery.isFetched &&
      !traceChecksQuery.isFetching &&
      isFirstRender.current
    ) {
      isFirstRender.current = false;

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
  }, [traceChecksQuery, traceCheckColumnsAvailable]);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const checkedHeaderColumnsEntries = Object.entries(
    selectedHeaderColumns
  ).filter(([_, checked]) => checked);

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Messages
          </Heading>
          <Spacer />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
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
                  {Object.entries(headerColumns).map(([columnKey, column]) => (
                    <Checkbox
                      key={columnKey}
                      isChecked={selectedHeaderColumns[columnKey]}
                      onChange={() => {
                        setSelectedHeaderColumns({
                          ...selectedHeaderColumns,
                          [columnKey]: !selectedHeaderColumns[columnKey],
                        });
                      }}
                    >
                      {column.name}
                    </Checkbox>
                  ))}
                </VStack>
              </PopoverBody>
            </PopoverContent>
          </Popover>

          <FilterToggle />
        </HStack>
        <Card>
          <CardBody>
            <TableContainer>
              <Table variant="simple">
                <Thead>
                  <Tr>
                    {checkedHeaderColumnsEntries
                      .filter(([_, checked]) => checked)
                      .map(([columnKey, _], index) => (
                        <Th key={index}>
                          <HStack spacing={1}>
                            <Text>{headerColumns[columnKey]?.name}</Text>
                            {headerColumns[columnKey]?.sortable && (
                              <ArrowUpDownIcon
                                onClick={() => sortBy(columnKey)}
                              />
                            )}
                          </HStack>
                        </Th>
                      ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {traceGroups.data?.groups.flatMap((traceGroup) =>
                    traceGroup.map((trace) => (
                      <Tr
                        key={trace.trace_id}
                        role="button"
                        cursor="pointer"
                        onClick={() => {
                          setTraceId(trace.trace_id);
                          setIsDrawerOpen(true);
                        }}
                      >
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
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>

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
      {traceId && (
        <TraceDeatilsDrawer
          isDrawerOpen={isDrawerOpen}
          traceId={traceId}
          traceChecksQuery={traceChecksQuery}
          setIsDrawerOpen={setIsDrawerOpen}
        />
      )}
    </DashboardLayout>
  );
}
