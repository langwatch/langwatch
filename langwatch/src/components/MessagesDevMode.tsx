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
import { ChevronDown, List } from "react-feather";
import type { Trace } from "~/server/tracer/types";
import { SpanTree } from "./traces/SpanTree";
import { TraceSummary } from "./traces/Summary";
import { useTraceDetailsState } from "~/hooks/useTraceDetailsState";
import { useRef } from "react";

export function MessagesDevMode() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openTab } = useTraceDetailsState();
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
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const traceIds =
    traceGroups.data?.flatMap((group) =>
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

  const isFirstRender = useRef(true); // Create a ref to track the first render

  useEffect(() => {
    if (
      traceChecksQuery.isFetched &&
      !traceChecksQuery.isFetching &&
      isFirstRender.current
    ) {
      isFirstRender.current = false; // Set the flag to false after the first render

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
      <Container maxWidth="1600" padding="6">
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
                  {traceGroups.data?.flatMap((traceGroup) =>
                    traceGroup.map((trace) => (
                      <Tr
                        key={trace.trace_id}
                        role="button"
                        cursor="pointer"
                        onClick={() => {
                          void router.replace(
                            `/${project?.slug}/messages/${trace.trace_id}/spans`
                          );
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
                  {traceGroups.isFetching &&
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
      </Container>
      <Drawer
        isOpen={openTab === "spans"}
        placement="right"
        size={"span"}
        onClose={() => {
          void router.replace(`/${project?.slug}/messages`);
        }}
      >
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>Message Info</DrawerHeader>
          <DrawerBody>
            <TraceSummary />
            {openTab === "spans" && <SpanTree />}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </DashboardLayout>
  );
}
