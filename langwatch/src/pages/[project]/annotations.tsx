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
} from "@chakra-ui/react";
import Parse from "papaparse";

import { useEffect } from "react";
import { HelpCircle, ThumbsDown, ThumbsUp } from "react-feather";
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

  let annotations = [];

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

  const downloadCSV = () => {
    const fields = [
      "User",
      "Comment",
      "Trace ID",
      "Rating",
      "Scoring",
      "Created At",
    ];

    const csv = annotations.data?.map((annotation) => {
      return [
        annotation.user?.name,
        annotation.comment,
        annotation.traceId,
        annotation.isThumbsUp ? "Thumbs Up" : "Thumbs Down",
        JSON.stringify(annotation.scoreOptions),
        annotation.createdAt.toLocaleString(),
      ];
    });

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

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      annotationTab: true,
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
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Annotations
          </Heading>
          <Spacer />
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
          <FilterToggle />
        </HStack>
        <HStack align="start" spacing={6}>
          <Card>
            <CardBody>
              {annotations.data &&
              annotations.data.length == 0 &&
              scoreOptions.data &&
              scoreOptions.data.length == 0 ? (
                <Text>
                  No annotations found.{" "}
                  <Link
                    href="https://docs.langwatch.ai/features/annotations"
                    target="_blank"
                    textDecoration="underline"
                  >
                    Get started with annotations
                  </Link>
                  .
                </Text>
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
                            <Td>{annotation.comment}</Td>
                            <Td>{annotation.traceId}</Td>
                            <Td>
                              {annotation.isThumbsUp ? (
                                <ThumbsUp />
                              ) : (
                                <ThumbsDown />
                              )}
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
    </DashboardLayout>
  );
}
