import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  HStack,
  Heading,
  Spacer,
  Container,
  Button,
  Card,
  CardBody,
  Text,
  Skeleton,
  Box,
  Popover,
  PopoverTrigger,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  VStack,
  useDisclosure,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  ChakraProvider,
  Select,
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";
import { FilterSelector } from "./FilterSelector";
import { PeriodSelector, usePeriodSelector } from "./PeriodSelector";
import { useRouter } from "next/router";
import { use, useEffect, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { api } from "~/utils/api";
import { durationColor } from "~/utils/durationColor";
import numeral from "numeral";
import { getTraceCheckDefinitions } from "~/trace_checks/registry";
import { ChevronDown, List, ChevronLeft, ChevronRight } from "react-feather";
import type { Trace } from "~/server/tracer/types";
import { SpanTree } from "./traces/SpanTree";
import { TraceSummary } from "./traces/Summary";
import { useRef } from "react";
import { Maximize2, Minimize2, type Icon } from "react-feather";


export function MessagesDevMode() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [traceView, setTraceView] = useState<"span" | "full">("span");
  const [totalHits, setTotalHits] = useState<number>(0);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(10);

  const toggleView = () => {
    setTraceView((prevView) => (prevView === "span" ? "full" : "span"));
  };

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      query: getSingleQueryParam(router.query.query),
      topics: getSingleQueryParam(router.query.topics)?.split(","),
      groupBy: "none",
      user_id: getSingleQueryParam(router.query.user_id),
      thread_id: getSingleQueryParam(router.query.thread_id),
      customer_ids: getSingleQueryParam(router.query.customer_ids)?.split(","),
      labels: getSingleQueryParam(router.query.labels)?.split(","),
      pageOffset: pageOffset,
      pageSize: pageSize,
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
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

  const checksAvailable = Object.fromEntries(
    Object.values(traceChecksQuery.data ?? {}).flatMap((checks) =>
      checks.map((check) => [check.check_id, check.check_name])
    )
  );

  const headerColumns: Record<
    string,
    (trace: Trace, index: number) => React.ReactNode
  > = {
    Timestamp: (trace, index) => (
      <Td key={index}>
        {new Date(trace.timestamps.started_at).toLocaleString()}
      </Td>
    ),
    Input: (trace, index) => (
      <Td key={index}>
        <Text noOfLines={1} maxWidth="300px">
          {trace.input.value}
        </Text>
      </Td>
    ),
    Output: (trace, index) =>
      trace.error ? (
        <Td key={index}>
          <Text noOfLines={1} maxWidth="300px" color="red.400">
            {trace.error.message}
          </Text>
        </Td>
      ) : (
        <Td key={index}>
          <Text noOfLines={1} maxWidth="300px">
            {trace.output?.value}
          </Text>
        </Td>
      ),
    "First Token": (trace, index) => (
      <Td key={index} isNumeric>
        <Text
          color={durationColor("first_token", trace.metrics.first_token_ms)}
        >
          {trace.metrics.first_token_ms
            ? numeral(trace.metrics.first_token_ms / 1000).format("0.[0]") + "s"
            : "-"}
        </Text>
      </Td>
    ),
    "Completion Time": (trace, index) => (
      <Td key={index} isNumeric>
        <Text color={durationColor("total_time", trace.metrics.total_time_ms)}>
          {trace.metrics.total_time_ms
            ? numeral(trace.metrics.total_time_ms / 1000).format("0.[0]") + "s"
            : "-"}
        </Text>
      </Td>
    ),
    "Completion Token": (trace, index) => (
      <Td key={index} isNumeric>
        {trace.metrics.completion_tokens}
      </Td>
    ),
    "Prompt Tokens": (trace, index) => (
      <Td key={index} isNumeric>
        {trace.metrics.prompt_tokens}
      </Td>
    ),
    "Total Cost": (trace, index) => (
      <Td key={index} isNumeric>
        <Text>{numeral(trace.metrics.total_cost).format("$0.00[000]")}</Text>
      </Td>
    ),
    ...Object.fromEntries(
      Object.entries(checksAvailable).map(([checkId, checkName]) => [
        checkName,
        (trace, index) => {
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
      ])
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
  }

  const prevPage = () => {
    if (pageOffset > 0) {
      setPageOffset(pageOffset - pageSize);
    }
  }

  const changePageSize = (size: number) => {
    setPageSize(size);
    setPageOffset(0);
  }


  useEffect(() => {
    if (traceGroups.isFetched) {

      setTotalHits(traceGroups.data?.tracesResult.hits.total?.value);

    }
  })

  const isFirstRender = useRef(true);

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
          Object.values(checksAvailable)
            .filter(
              (key) => !Object.keys(prevSelectedHeaderColumns).includes(key)
            )
            .map((column) => [column, true])
        ),
      }));
    }
  }, [traceChecksQuery, checksAvailable]);

  const { isOpen, onOpen, onClose } = useDisclosure();

  return (
    <DashboardLayout>
      <Container maxW={'calc(100vw - 200px)'} padding={6}>
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
                  {Object.keys(headerColumns).map((column, index) => (
                    <Checkbox
                      key={index}
                      isChecked={selectedHeaderColumns[column]}
                      onChange={() => {
                        setSelectedHeaderColumns({
                          ...selectedHeaderColumns,
                          [column]: !selectedHeaderColumns[column],
                        });
                      }}
                    >
                      {column}
                    </Checkbox>
                  ))}
                </VStack>
              </PopoverBody>
            </PopoverContent>
          </Popover>

          <FilterSelector />
        </HStack>
        <Card>
          <CardBody>
            <TableContainer>
              <Table variant="simple">
                <Thead>
                  <Tr>
                    {Object.entries(selectedHeaderColumns)
                      .filter(([_, checked]) => checked)
                      .map(([column, _], index) => (
                        <Th key={index}>{column}</Th>
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
                        {Object.entries(selectedHeaderColumns)
                          .filter(([_, checked]) => checked)
                          .map(
                            ([column, _], index) =>
                              headerColumns[column]?.(trace, index)
                          )}
                      </Tr>
                    ))
                  )}
                  {traceGroups.isLoading &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <Tr key={i}>
                        {Array.from({ length: 8 }).map((_, i) => (
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

          <Select placeholder='' maxW='70px' size='sm' onChange={(e) => changePageSize(parseInt(e.target.value))} borderColor={'black'} borderRadius={'lg'}>
            <option value='10'>10</option>
            <option value='25'>25</option>
            <option value='50'>50</option>
            <option value='100'>100</option>
            <option value='250'>250</option>
          </Select>
          <Text marginLeft={'20px'}> {`${pageOffset + 1}`} - {`${(pageOffset + pageSize) > totalHits ? totalHits : pageOffset + pageSize}`} of {`${totalHits}`} items</Text>
          <Button width={10} padding={0} onClick={prevPage} isDisabled={pageOffset === 0}><ChevronLeft /></Button>
          <Button width={10} padding={0} isDisabled={(pageOffset + pageSize) >= totalHits} onClick={nextPage}><ChevronRight /></Button>
        </HStack>

      </Container>
      <Drawer
        isOpen={isDrawerOpen}
        placement="right"
        size={traceView}
        onClose={() => {
          setIsDrawerOpen(false);
          setTraceView("span");
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <HStack>
              {traceView === "span" ? (
                <Maximize2 onClick={toggleView} cursor={"pointer"} />
              ) : (
                <Minimize2 onClick={toggleView} cursor={"pointer"} />
              )}
              <Text>Trace Details</Text>
              <DrawerCloseButton />
            </HStack>
          </DrawerHeader>
          <DrawerBody>
            <TraceSummary traceId={traceId ?? ""} />
            <SpanTree traceId={traceId ?? ""} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </DashboardLayout >
  );
}
