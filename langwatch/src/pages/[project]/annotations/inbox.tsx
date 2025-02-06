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
import type { AppRouter } from "../../server/api/root";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCClientErrorLike } from "@trpc/client";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";

import AnnotationsLayout from "~/components/AnnotationsLayout";

export default function Annotations() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, isDrawerOpen } = useDrawer();
  const router = useRouter();
  const { filterParams, queryOpts, nonEmptyFilters } = useFilterParams();

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

  type RouterOutput = inferRouterOutputs<AppRouter>;
  type AnnotationsQuery = UseTRPCQueryResult<
    | RouterOutput["annotation"]["getAll"]
    | RouterOutput["annotation"]["getByTraceIds"],
    TRPCClientErrorLike<AppRouter>
  >;

  let annotations: AnnotationsQuery;

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

  const scoreOptions = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      selectedTab: "annotations",
    });
  };

  const isAnnotationDrawerOpen = isDrawerOpen("annotation");
  const isTraceDrawerOpen = isDrawerOpen("traceDetails");

  useEffect(() => {
    void annotations.refetch();
  }, [isAnnotationDrawerOpen, isTraceDrawerOpen]);

  interface ScoreOption {
    value: string;
    reason?: string;
  }

  const annotationScoreValues = (
    scoreOptions: Record<string, ScoreOption>,
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && scoreOptions) {
      return scoreOptionsIDArray.map((id) => (
        <Td key={id}>
          <HStack>
            <Text>{scoreOptions[id]?.value}</Text>
            {scoreOptions[id]?.reason && (
              <Tooltip label={scoreOptions[id]?.reason}>
                <HelpCircle width={16} height={16} />
              </Tooltip>
            )}
          </HStack>
        </Td>
      ));
    } else {
      if (scoreOptionsIDArray.length > 0) {
        return scoreOptionsIDArray.map((_, i) => <Td key={i}></Td>);
      }
      return <Td></Td>;
    }
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
              {annotations.data &&
              annotations.data.length == 0 &&
              scoreOptions.data &&
              scoreOptions.data.length == 0 ? (
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
                        <Th>User</Th>
                        <Th>Comment</Th>
                        <Th>Trace ID</Th>
                        <Th>Rating</Th>

                        {scoreOptions.data &&
                          scoreOptions.data.length > 0 &&
                          scoreOptions.data?.map((key) => (
                            <Th key={key.id}>{key.name}</Th>
                          ))}
                        <Th>Created At</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {annotations.isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <Tr key={i}>
                            {Array.from({ length: 4 }).map((_, i) => (
                              <Td key={i}>
                                <Skeleton height="20px" />
                              </Td>
                            ))}
                          </Tr>
                        ))
                      ) : annotations.data && annotations.data.length > 0 ? (
                        annotations.data?.map((annotation) => (
                          <Tr
                            cursor="pointer"
                            key={annotation.id}
                            onClick={() => openTraceDrawer(annotation.traceId)}
                          >
                            <Td>
                              <Avatar
                                name={annotation.user?.name ?? undefined}
                                backgroundColor={"orange.400"}
                                color="white"
                                size="sm"
                              />
                            </Td>
                            <Td>
                              <Tooltip label={annotation.comment}>
                                <Text
                                  noOfLines={2}
                                  display="block"
                                  maxWidth={450}
                                >
                                  {annotation.comment}
                                </Text>
                              </Tooltip>
                            </Td>
                            <Td>{annotation.traceId}</Td>
                            <Td>
                              {annotation.isThumbsUp === true ? (
                                <ThumbsUp />
                              ) : annotation.isThumbsUp === false ? (
                                <ThumbsDown />
                              ) : null}
                            </Td>
                            {scoreOptions.data &&
                              scoreOptions.data.length > 0 &&
                              annotationScoreValues(
                                annotation.scoreOptions as unknown as Record<
                                  string,
                                  ScoreOption
                                >,
                                scoreOptionsIDArray
                              )}
                            <Td>{annotation.createdAt.toLocaleString()}</Td>
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
