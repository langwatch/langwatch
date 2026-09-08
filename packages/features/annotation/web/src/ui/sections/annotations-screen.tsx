/** Renders the selected annotation list view. */

import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { Box, Flex, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useMemo } from "react";
import { annotationApi } from "../../behavior/annotation-api.ts";
import { downloadCsv } from "@langwatch/csv/download";
import { useAnnotationPeriod } from "../../behavior/use-annotation-period.ts";
import { allAnnotationsExport, csvFileName } from "../../model/annotation-export.ts";
import { useAnnotationHost } from "../../model/annotation-host.ts";
import type { AnnotationHostPort } from "../../model/annotation-host.ts";
import {
  closedQueueEditorAddress,
  queueEditorAddress,
  readQueueEditor,
} from "../../model/annotation-overlay-address.ts";
import {
  groupedAnnotationsToRows,
  type AnnotationRow,
  type AnnotationTrace,
} from "../../model/annotation-row.ts";
import type { AnnotationView } from "../../model/annotation-view.ts";
import { AnnotationList, type PageQueue } from "./annotation-list.tsx";
import { AnnotationQueueEditor } from "./annotation-queue-editor.tsx";
import { AnnotationSidebar } from "./annotation-sidebar.tsx";
import { ReviewerAvatar } from "../elements/reviewer-avatar.tsx";
import { NoDataInfoBlock } from "../elements/no-data-info-block.tsx";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { Inbox } from "lucide-react";

export function AnnotationsScreen({ view }: { view: AnnotationView }) {
  const host = useAnnotationHost();
  const project = host.project();
  const reviewer = host.currentUser();
  const { params, query } = host.route();
  const editor = readQueueEditor(query);

  const pendingCount = annotationApi.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const assignedCount = annotationApi.annotation.getAssignedItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const queueBadges = annotationApi.annotation.getQueueItemsCounts.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  return (
    <>
      <AnnotationSidebar
        view={view}
        projectSlug={project?.slug}
        reviewerName={reviewer?.name ?? null}
        reviewerImage={reviewer?.image ?? null}
        pendingCount={pendingCount.data?.count}
        assignedCount={assignedCount.data?.count}
        queues={queueBadges.data ?? []}
        activeQueueSlug={params.slug}
        canManageQueues={!host.isLiteMember()}
        onCreateQueue={() => host.setQuery(queueEditorAddress({ current: query }))}
        onEditQueue={(queueId) => host.setQuery(queueEditorAddress({ current: query, queueId }))}
      >
        {/* `minWidth={0}` lets the column shrink inside the sidebar row, so wide
            columns scroll inside the table instead of pushing the page sideways. */}
        <Flex direction="column" flex={1} minWidth={0} height="full">
          <AnnotationView view={view} host={host} />
        </Flex>
      </AnnotationSidebar>
      {editor && (
        <AnnotationQueueEditor
          projectId={project?.id}
          organizationId={host.organizationId()}
          queueId={editor.queueId}
          onClose={() => host.setQuery(closedQueueEditorAddress(query))}
          onSaved={(queueName) =>
            host.succeeded({
              title: editor.queueId ? "Annotation queue updated" : "Annotation queue created",
              description: `Successfully ${editor.queueId ? "updated" : "created"} ${queueName} annotation queue`,
            })
          }
          onFailed={(error) =>
            host.failed({
              error,
              fallbackTitle: editor.queueId
                ? "Couldn't update annotation queue"
                : "Couldn't create annotation queue",
            })
          }
        />
      )}
    </>
  );
}

/** The one list this address is, wired to what that view reads. */
function AnnotationView({ view, host }: { view: AnnotationView; host: AnnotationHostPort }) {
  if (view === "all") return <AllAnnotationsList host={host} />;

  if (view === "queue") return <QueueList host={host} />;

  if (view === "mine") return <MyQueueList host={host} />;

  return <AnnotationList view="inbox" host={host} />;
}

/** The reviewer's own queue: their items, and their name on the send picker. */
function MyQueueList({ host }: { host: AnnotationHostPort }) {
  const reviewer = host.currentUser();

  // This page is the reviewer's own queue, so moving a selection elsewhere
  // starts from them being on it.
  const pageQueue: PageQueue | undefined = reviewer
    ? { annotatorId: `user-${reviewer.id}`, name: reviewer.name ?? "You" }
    : void 0;

  return <AnnotationList view="mine" host={host} {...(pageQueue ? { pageQueue } : {})} />;
}

/** One named queue, read from the `:slug` the router captured. */
function QueueList({ host }: { host: AnnotationHostPort }) {
  const project = host.project();
  const slug = host.route().params.slug;

  const queue = annotationApi.annotation.getQueueBySlugOrId.useQuery(
    { projectId: project?.id ?? "", slug: slug ?? "" },
    { enabled: !!project?.id && !!slug },
  );

  if (readHandledError(queue.error)?.code === "annotation_queue_not_found") {
    return (
      <NoDataInfoBlock
        title="Annotation queue not found"
        description="It may have been deleted or you may no longer have access to it."
        icon={<Inbox />}
      />
    );
  }

  const members = queue.data?.members.map((member) => member.user);

  const titleContent = queue.data ? (
    <VStack align="start" minWidth={0}>
      <Heading size="lg">{queue.data.name}</Heading>
      <HStack>
        <Text fontSize="sm">Members: </Text>
        {members?.map((member) => (
          <Tooltip key={member.id} content={member.name}>
            <Box display="inline-flex">
              <ReviewerAvatar size="xs" name={member.name ?? ""} image={member.image} />
            </Box>
          </Tooltip>
        ))}
      </HStack>
    </VStack>
  ) : null;

  // The page IS this queue, so moving a selection elsewhere starts from the
  // queue the rows are already on.
  const pageQueue: PageQueue | undefined = queue.data
    ? { annotatorId: `queue-${queue.data.id}`, name: queue.data.name }
    : void 0;

  return (
    <AnnotationList
      view="queue"
      host={host}
      queueId={queue.data?.id ?? ""}
      {...(titleContent ? { titleContent } : {})}
      {...(pageQueue ? { pageQueue } : {})}
    />
  );
}

function AllAnnotationsList({ host }: { host: AnnotationHostPort }) {
  const project = host.project();
  const { period } = useAnnotationPeriod(host.route().query);

  const annotations = annotationApi.annotation.getAll.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: period.startDate,
      endDate: period.endDate,
    },
    { enabled: !!project?.id },
  );

  const traceIds = useMemo(
    () => Array.from(new Set((annotations.data ?? []).map((one) => one.traceId))),
    [annotations.data],
  );

  const traces = annotationApi.traces.getTracesWithSpans.useQuery(
    { projectId: project?.id ?? "", traceIds },
    { enabled: !!project?.id, refetchOnWindowFocus: false },
  );

  const rows: AnnotationRow[] = useMemo(
    () => groupedAnnotationsToRows(groupByTrace(annotations.data ?? [], traces.data ?? [])),
    [annotations.data, traces.data],
  );

  return (
    <AnnotationList
      view="all"
      host={host}
      rows={rows}
      rowsLoading={annotations.isLoading || traces.isLoading}
      exportLabel="Export all"
      onExport={() => {
        const { fields, rows: exportRows } = allAnnotationsExport({
          annotations: annotations.data ?? [],
          traces: traces.data ?? [],
        });

        downloadCsv({ fields, rows: exportRows, fileName: csvFileName("Traces") });
      }}
    />
  );
}

/**
 * One row per trace, carrying everything said about it.
 *
 * The list is of annotations rather than of traces, so a comment left on one
 * span is one of the trace's annotations rather than a row of its own — which is
 * what makes the grouping the page's job and not the server's.
 */
function groupByTrace(
  annotations: readonly AnnotationWithUser[],
  traces: readonly AnnotationTrace[],
): Array<{ traceId: string; trace?: AnnotationTrace; annotations: AnnotationWithUser[] }> {
  const traceById = new Map(traces.map((trace) => [trace.trace_id, trace]));

  const grouped = new Map<
    string,
    { traceId: string; trace?: AnnotationTrace; annotations: AnnotationWithUser[] }
  >();

  for (const annotation of annotations) {
    const existing = grouped.get(annotation.traceId);

    if (existing) {
      existing.annotations.push(annotation);
      continue;
    }

    const trace = traceById.get(annotation.traceId);

    grouped.set(annotation.traceId, {
      traceId: annotation.traceId,
      ...(trace ? { trace } : {}),
      annotations: [annotation],
    });
  }

  return [...grouped.values()];
}

export default AnnotationsScreen;
