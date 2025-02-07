import { DownloadIcon } from "@chakra-ui/icons";
import { Link } from "@chakra-ui/next-js";
import {
  Avatar,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
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
} from "@chakra-ui/react";
import Parse from "papaparse";

import { useEffect } from "react";
import { Edit, HelpCircle, ThumbsDown, ThumbsUp } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { FilterToggle } from "~/components/filters/FilterToggle";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import { api } from "~/utils/api";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useRouter } from "next/router";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";
import type { AppRouter } from "../../../../server/api/root";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCClientErrorLike } from "@trpc/client";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";

import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useSession } from "next-auth/react";
export default function Annotations() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, isDrawerOpen } = useDrawer();
  const router = useRouter();

  const session = useSession();
  const userId = session.data?.user?.id;
  const { id } = router.query;

  const isUser = userId === id;

  const { filterParams, queryOpts, nonEmptyFilters } = useFilterParams();
  const {
    assignedQueueItemsWithTraces,

    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces?.filter((item) => item.userId === id) ??
      []),
  ];

  const hasAnyFilters = nonEmptyFilters.length > 0;
  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      query: getSingleQueryParam(router.query.query),
      groupBy: "none",
      pageOffset: 0,
      pageSize: 10000,
      sortBy: getSingleQueryParam(router.query.sortBy),
      sortDirection: getSingleQueryParam(router.query.orderBy),
    },
    queryOpts
  );

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  let annotations;

  if (hasAnyFilters) {
    const traceIds =
      traceGroups.data?.groups.flatMap((group) =>
        group.map((trace) => trace.trace_id)
      ) ?? [];

    annotations = api.annotation.getByTraceIds.useQuery(
      { projectId: project?.id ?? "", traceIds },
      {
        enabled: project?.id !== undefined,
      }
    );
  } else {
    annotations = api.annotation.getAll.useQuery(
      { projectId: project?.id ?? "", startDate, endDate },
      {
        enabled: !!project,
      }
    );
  }

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      selectedTab: "annotations",
    });
  };

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 320px)"} padding={6}>
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
          Annotations
        </Heading>
        <Heading as={"h4"} size="md" fontWeight="normal">
          Inbox
        </Heading>

        {/* <Spacer />
          <Button
            colorScheme="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => downloadCSV()}
          >
            Export all <DownloadIcon marginLeft={2} />
          </Button>
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
          <FilterToggle /> */}
        <HStack width="full" align="start" spacing={6} marginTop={6}>
          <Card flex={1}>
            <CardBody>
              {allQueueItems.length == 0 ? (
                <NoDataInfoBlock
                  title="No annotations yet"
                  description="Annotate your messages to add more context and improve your analysis."
                  docsInfo={
                    <Text>
                      To get started with annotations, please visit our{" "}
                      <Link
                        href="https://docs.langwatch.ai/features/annotations"
                        target="_blank"
                        color="orange.400"
                      >
                        documentation
                      </Link>
                      .
                    </Text>
                  }
                  icon={<Edit />}
                />
              ) : (
                <TableContainer>
                  <Table variant="simple">
                    <Thead>
                      <Tr>
                        <Th>Date Queued</Th>
                        <Th>Input</Th>
                        <Th>Output</Th>
                        <Th>Trace Date</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {queuesLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <Tr key={i}>
                            {Array.from({ length: 4 }).map((_, i) => (
                              <Td key={i}>
                                <Skeleton height="20px" />
                              </Td>
                            ))}
                          </Tr>
                        ))
                      ) : allQueueItems.length > 0 ? (
                        allQueueItems.map((item) => (
                          <Tr
                            cursor="pointer"
                            key={item.id}
                            onClick={() => openTraceDrawer(item.traceId)}
                          >
                            <Td>{item.createdAt.toLocaleDateString()}</Td>

                            <Td>
                              <Tooltip label={item.trace?.input?.value}>
                                <Text
                                  noOfLines={2}
                                  display="block"
                                  maxWidth={450}
                                >
                                  {item.trace?.input?.value}
                                </Text>
                              </Tooltip>
                            </Td>
                            <Td>
                              <Tooltip label={item.trace?.output?.value}>
                                <Text
                                  noOfLines={2}
                                  display="block"
                                  maxWidth={550}
                                >
                                  {item.trace?.output?.value}
                                </Text>
                              </Tooltip>
                            </Td>
                            <Td>
                              {new Date(
                                item.trace?.timestamps.started_at ?? ""
                              ).toLocaleDateString()}
                            </Td>
                          </Tr>
                        ))
                      ) : (
                        <Tr>
                          <Td colSpan={5}>
                            <Text>
                              No annotations found for selected filters or
                              period.
                            </Text>
                          </Td>
                        </Tr>
                      )}
                    </Tbody>
                  </Table>
                </TableContainer>
              )}
            </CardBody>
          </Card>
          <FilterSidebar />
        </HStack>
      </Container>
    </AnnotationsLayout>
  );
}
