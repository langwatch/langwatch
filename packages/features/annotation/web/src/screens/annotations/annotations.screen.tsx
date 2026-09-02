/**
 * Every annotation list in one screen, told which one it is.
 *
 * FOUR PAGE KEYS, ONE SCREEN. `platform/app` had four page files —
 * `annotations.tsx`, `annotations/all.tsx`, `annotations/me.tsx` and
 * `annotations/[slug].tsx` — whose bodies differed only in the props they handed
 * one table. The route table already gives each address its own page key, so
 * `apps/ui` maps a key to a view and the screen never reads the address to learn
 * what the router already knew. That is the automations family's tab-as-prop
 * shape; here it is a view rather than a tab, and it is why the host port
 * carries no pathname.
 *
 * THE FIFTH KEY, `annotations/my-queue`, DID NOT MOVE, and the reason is
 * measured rather than asserted: it mounts `ConversationView`, four thousand
 * lines of `platform/app/src/features/traces-v2` that reach the transcript, the
 * turn ledger, the annotation rail and the drawer's own navigation. That belongs
 * to the traces family and `@langwatch/trace-web` publishes no surface for it,
 * so a placeholder would not be a recorded gap — it would be deleting the review
 * surface the queue exists for. It stays where it is, and so do the four
 * platform modules it still needs.
 *
 * WHAT EACH VIEW IS:
 *
 * - `inbox`  — every queue the reviewer is a member of, plus their own items.
 * - `mine`   — the reviewer's own queue. Moving a selection elsewhere starts
 *              from them being on it, which is what `pageQueue` says.
 * - `all`    — every annotation in the project inside a date range, grouped by
 *              trace, with an export that carries all of them rather than the
 *              page on screen.
 * - `queue`  — one named queue, read from the `:slug` route parameter, with its
 *              name and members as the title.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { Box, Flex, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useMemo } from "react";
import { annotationApi } from "../../behavior/annotation-api";
import { downloadCsv } from "../../behavior/download-csv";
import { useAnnotationPeriod } from "../../behavior/use-annotation-period";
import { allAnnotationsExport, csvFileName } from "../../model/annotation-export";
import { useAnnotationHost } from "../../model/annotation-host";
import type { AnnotationHostPort } from "../../model/annotation-host";
import {
  closedQueueEditorAddress,
  queueEditorAddress,
  readQueueEditor,
} from "../../model/annotation-overlay-address";
import {
  groupedAnnotationsToRows,
  type AnnotationRow,
  type AnnotationTrace,
  type AnnotationWithUser,
} from "../../model/annotation-row";
import type { AnnotationView } from "../../model/annotation-view";
import { AnnotationList, type PageQueue } from "../../ui/sections/annotation-list";
import { AnnotationQueueEditor } from "../../ui/sections/annotation-queue-editor";
import { AnnotationSidebar } from "../../ui/sections/annotation-sidebar";
import { ReviewerAvatar } from "../../ui/elements/reviewer-avatar";

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
        pendingCount={pendingCount.data}
        assignedCount={assignedCount.data}
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

/**
 * Every annotation the project holds inside the range, grouped by trace.
 *
 * THE FILTERED MODE DID NOT TRAVEL, and it is this move's one feature loss.
 * The platform page asked `useFilterParams` whether the address carried any
 * trace filter, and if it did it queried the matching traces first and then the
 * annotations on them. That hook reaches `~/server/filters/registry`,
 * `~/server/filters/types` and `~/server/analytics/utils`, none of which a
 * browser package may name, and the registry is a vocabulary with nothing to
 * narrow a copy of it — the automations family hit the same wall on the same
 * three modules. Nothing in the product links here with a filter on the address:
 * the annotations pages render no filter control, so the mode was reachable only
 * by a hand-made URL or by the saved-view fallback the hook reads out of the
 * browser's own key-value store. That fallback is the visible half of the
 * change — a reviewer with a saved trace view selected used to see this page
 * silently narrowed to it, and now sees every annotation in the range.
 */
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
