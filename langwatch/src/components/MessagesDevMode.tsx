import {
  Table,
  Thead,
  Tbody,
  Tfoot,
  Tr,
  Th,
  Td,
  TableCaption,
  TableContainer,
  HStack,
  Heading,
  Spacer,
  Container,
  Button,
  Card,
  CardBody,
  CardHeader,
  Text,
  Skeleton,
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";
import { FilterSelector } from "./FilterSelector";
import { PeriodSelector, usePeriodSelector } from "./PeriodSelector";
import { useRouter } from "next/router";
import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import { api } from "~/utils/api";
import { formatMilliseconds } from "~/utils/formatMilliseconds";
import { durationColor } from "~/utils/durationColor";
import numeral from "numeral";

export function MessagesDevMode() {
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const router = useRouter();
  const { project } = useOrganizationTeamProject();

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

  return (
    <DashboardLayout>
      <Container maxWidth="1600" padding="6">
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Messages
          </Heading>
          <Spacer />
          <FilterSelector />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
        </HStack>
        <Card>
          <CardBody>
            <TableContainer>
              <Table variant="simple">
                <TableCaption>
                  Imperial to metric conversion factors
                </TableCaption>
                <Thead>
                  <Tr>
                    <Th>Timestamp</Th>
                    <Th>Input</Th>
                    <Th>Output</Th>
                    <Th isNumeric>First Token</Th>
                    <Th isNumeric>Completion Time</Th>
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
                          void router.push(
                            `/${project?.slug}/messages/${trace.trace_id}/spans`
                          );
                        }}
                      >
                        <Td>{trace.timestamps.started_at}</Td>
                        <Td>
                          <Text noOfLines={1} maxWidth="300px">
                            {trace.input.value}
                          </Text>
                        </Td>
                        <Td>
                          {trace.error ? (
                            <Text
                              noOfLines={1}
                              maxWidth="300px"
                              color="red.400"
                            >
                              {trace.error.message}
                            </Text>
                          ) : (
                            <Text noOfLines={1} maxWidth="300px">
                              {trace.output?.value}
                            </Text>
                          )}
                        </Td>
                        <Td
                          isNumeric
                          color={durationColor(
                            "first_token",
                            trace.metrics.first_token_ms
                          )}
                        >
                          {trace.metrics.first_token_ms
                            ? numeral(
                                trace.metrics.first_token_ms / 1000
                              ).format("0.[0]") + "s"
                            : "-"}
                        </Td>
                        <Td
                          isNumeric
                          color={durationColor(
                            "total_time",
                            trace.metrics.first_token_ms
                          )}
                        >
                          {trace.metrics.total_time_ms
                            ? numeral(
                                trace.metrics.total_time_ms / 1000
                              ).format("0.[0]") + "s"
                            : "-"}
                        </Td>
                      </Tr>
                    ))
                  )}
                  {traceGroups.isFetching &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <Tr key={i}>
                        {Array.from({ length: 5 }).map((_, i) => (
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
    </DashboardLayout>
  );
}
