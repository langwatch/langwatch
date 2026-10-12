import { Flex } from "@chakra-ui/react";
import { useMemo } from "react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import {
  type AnnotationWithUser,
  annotationRatingExportLabel,
  groupedAnnotationsToRows,
  suggestionExportLine,
} from "~/components/annotations/annotationRow";
import { usePeriodSelector } from "~/components/PeriodSelector";
import type { Annotation } from "~/generated/prisma/client";
import { useAnnotationsByTraceIds } from "~/hooks/useAnnotationsByTraceIds";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceIdsAcrossPages } from "~/hooks/useTraceIdsAcrossPages";
import { MAX_TRACE_LIST_PAGE_SIZE } from "~/server/api/routers/traces.schemas";
import type { Trace } from "~/server/tracer/types";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { csvFileName, downloadCsv } from "~/utils/downloadCsv";
import { getSingleQueryParam } from "~/utils/getSingleQueryParam";

type GroupedAnnotation = {
  traceId: string;
  trace?: Trace;
  annotations: AnnotationWithUser[];
};

// Keeps the old 10 000-trace ceiling while every request stays at the page cap (#8479).
const MAX_ANNOTATION_TRACE_PAGES = 10;

export default function Annotations() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { filterParams, queryOpts, nonEmptyFilters } = useFilterParams();

  const hasAnyFilters = Object.keys(nonEmptyFilters).length > 0;
  const traceQueryInput = {
    ...filterParams,
    query: getSingleQueryParam(router.query.query),
    groupBy: "none",
    pageOffset: 0,
    pageSize: MAX_TRACE_LIST_PAGE_SIZE,
    sortBy: getSingleQueryParam(router.query.sortBy),
    sortDirection: getSingleQueryParam(router.query.orderBy),
  };
  const {
    traceIds: filteredTraceIds,
    isLoading: tracePagesLoading,
    isError: tracePagesFailed,
  } = useTraceIdsAcrossPages({
    input: traceQueryInput,
    // Unfiltered mode reads allAnnotations, so walking trace pages there would
    // be wasted reads (#8479).
    queryOpts: {
      ...queryOpts,
      enabled: (queryOpts.enabled ?? true) && hasAnyFilters,
    },
    maxPages: MAX_ANNOTATION_TRACE_PAGES,
  });
  // A failed page leaves no ids, which would otherwise read as "no annotations".
  const showTraceWalkError = hasAnyFilters && tracePagesFailed;

  const {
    period: { startDate, endDate },
  } = usePeriodSelector();

  // Everything said about these traces, anchored comments included: this page
  // lists the annotations themselves rather than answering a question about each
  // trace as a whole, so a comment left on one span is one of its rows.
  const filteredAnnotations = useAnnotationsByTraceIds({
    projectId: project?.id ?? "",
    traceIds: filteredTraceIds,
    enabled: hasAnyFilters && project?.id !== undefined,
    anchor: "all",
  });

  const allAnnotations = api.annotation.getAll.useQuery(
    { projectId: project?.id ?? "", startDate, endDate },
    { enabled: !hasAnyFilters && !!project },
  );

  const annotations = hasAnyFilters ? filteredAnnotations : allAnnotations;
  // In filtered mode the ids come from the trace pages, so their load must count
  // toward the table's loading state — otherwise the table flashes an empty
  // state before the ids (and then the annotations) arrive.
  const annotationsLoading = hasAnyFilters
    ? tracePagesLoading || filteredAnnotations.isLoading
    : allAnnotations.isLoading;

  const traceIds = annotations.data?.map((annotation) => annotation.traceId);

  const traces = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds ?? [],
    },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    },
  );

  const groupByTraceId = (dataArray: Annotation[]): GroupedAnnotation[] => {
    const grouped = dataArray.reduce(
      (acc: Record<string, GroupedAnnotation>, item) => {
        if (!acc[item.traceId]) {
          acc[item.traceId] = {
            traceId: item.traceId,
            annotations: [],
            trace: traces.data?.find(
              (trace) => trace.trace_id === item.traceId,
            ),
          };
        }

        const annotationWithUser: AnnotationWithUser = {
          ...item,
          user: (item as AnnotationWithUser).user,
        };

        const groupedAnnotation = acc[item.traceId];
        if (groupedAnnotation) {
          groupedAnnotation.annotations.push(annotationWithUser);
        }

        return acc;
      },
      {},
    );

    return Object.values(grouped);
  };

  const rows = useMemo(
    () => groupedAnnotationsToRows(groupByTraceId(annotations.data ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [annotations.data, traces.data],
  );

  const exportAll = () => {
    const fields = [
      "User",
      "Input",
      "Output",
      "Suggestions",
      "Comment",
      "Trace ID",
      "Rating",
      "Scoring",
      "Created at",
    ];

    const data =
      annotations?.data?.map((annotation) => {
        const trace = traces.data?.find(
          (trace) => trace.trace_id === annotation.traceId,
        );

        return [
          annotation.user?.name ?? "",
          trace?.input?.value ?? "",
          trace?.output?.value ?? "",
          suggestionExportLine({ annotation, traceId: annotation.traceId }),
          annotation.comment ?? "",
          annotation.traceId ?? "",
          annotationRatingExportLabel(annotation.isThumbsUp),
          JSON.stringify(annotation.scoreOptions ?? {}),
          annotation.createdAt?.toLocaleString() ?? "",
        ];
      }) ?? [];

    downloadCsv({ fields, rows: data, fileName: csvFileName("Traces") });
  };

  return (
    <AnnotationsLayout>
      <Flex direction="column" flex={1} minWidth={0} height="full">
        <AnnotationsTable
          rows={rows}
          rowsLoading={annotationsLoading || traces.isLoading}
          heading="All Annotations"
          dateColumnLabel="Date annotated"
          showStatusFilter={false}
          rowTarget="trace"
          exportLabel="Export all"
          onExport={exportAll}
          noDataTitle={
            showTraceWalkError
              ? "Couldn't load the annotations for these filters"
              : "No recent annotations yet, change the date range to see more or annotate your messages"
          }
          noDataDescription={
            showTraceWalkError
              ? "Something went wrong while loading matching traces. Reload the page to try again."
              : "Annotate your messages to add more context and improve your analysis."
          }
        />
      </Flex>
    </AnnotationsLayout>
  );
}
