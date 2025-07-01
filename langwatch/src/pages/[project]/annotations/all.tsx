import { Button, Container, HStack, Heading, Spacer } from "@chakra-ui/react";
import Parse from "papaparse";

import type { Annotation, User } from "@prisma/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/router";
import { Download } from "react-feather";
import {
  AnnotationsTable,
  type AnnotationWithUser,
} from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AppRouter } from "~/server/api/root";
import type { Trace } from "~/server/tracer/types";
import { api } from "~/utils/api";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";

export default function Annotations() {
  const { project } = useOrganizationTeamProject();
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

  const traceIds = annotations.data?.map((annotation) => annotation.traceId);

  const traces = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds ?? [],
    },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    }
  );

  type GroupedAnnotation = {
    traceId: string;
    trace?: Trace;
    annotations: AnnotationWithUser[];
  };

  const groupByTraceId = (dataArray: Annotation[]): GroupedAnnotation[] => {
    const grouped = dataArray.reduce(
      (acc: Record<string, GroupedAnnotation>, item) => {
        if (!acc[item.traceId]) {
          acc[item.traceId] = {
            traceId: item.traceId,
            annotations: [],
            trace: traces.data?.find(
              (trace) => trace.trace_id === item.traceId
            ),
          };
        }

        // Create a proper AnnotationWithUser object that includes all original annotation fields
        const annotationWithUser: AnnotationWithUser = {
          ...item, // Include all original annotation fields
          user: (item as any).user, // Include the user data from the query
        };

        const groupedAnnotation = acc[item.traceId];
        if (groupedAnnotation) {
          groupedAnnotation.annotations.push(annotationWithUser);
        }

        return acc;
      },
      {}
    );

    return Object.values(grouped);
  };

  const groupedAnnotations = groupByTraceId(annotations.data ?? []);

  const downloadCSV = () => {
    const fields = [
      "User",
      "Input",
      "Output",
      "Expected Output",
      "Comment",
      "Trace ID",
      "Rating",
      "Scoring",
      "Created At",
    ];

    const csv =
      annotations?.data?.map((annotation) => {
        const trace = traces.data?.find(
          (trace) => trace.trace_id === annotation.traceId
        );

        return [
          annotation.user?.name ?? "",
          trace?.input?.value ?? "",
          trace?.output?.value ?? "",
          annotation.expectedOutput ?? "",
          annotation.comment ?? "",
          annotation.traceId ?? "",
          annotation.isThumbsUp ? "Thumbs Up" : "Thumbs Down",
          JSON.stringify(annotation.scoreOptions ?? {}),
          annotation.createdAt?.toLocaleString() ?? "",
        ];
      }) ?? [];

    const csvBlob = Parse.unparse({
      fields: fields,
      data: csv,
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

  const tableHeader = (
    <HStack width="full" align="top">
      <Heading as={"h1"} size="lg" paddingTop={1}>
        All Annotations
      </Heading>
      <Spacer />
      <Button
        colorPalette="black"
        minWidth="fit-content"
        variant="ghost"
        onClick={() => downloadCSV()}
      >
        Export all <Download style={{ marginLeft: "8px" }} />
      </Button>
      <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
    </HStack>
  );
  return (
    <AnnotationsLayout>
      <Container
        maxW={"calc(100vw - 330px)"}
        padding={0}
        margin={0}
        backgroundColor="white"
      >
        <AnnotationsTable
          groupedAnnotations={groupedAnnotations}
          allAnnotationsLoading={annotations.isLoading || traces.isLoading}
          heading="Annotations"
          isDone={true}
          tableHeader={tableHeader}
          noDataTitle="No recent annotations yet, change the date range to see more or annotate your messages"
          noDataDescription="Annotate your messages to add more context and improve your analysis."
        />
      </Container>
    </AnnotationsLayout>
  );
}
