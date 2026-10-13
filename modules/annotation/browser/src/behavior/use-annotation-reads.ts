/** The reads the annotation screens share, one hook per procedure. */

import { useMemo } from "react";

import type { AnnotationPeriodMoment } from "../model/annotation-period.ts";
import { annotationApi } from "./annotation-api.ts";

/** The reviewer's sidebar: pending and assigned totals plus the per-queue badges. */
export function useAnnotationSidebarCounts({ projectId }: { projectId: string | undefined }) {
  const input = { projectId: projectId ?? "" };
  const options = { enabled: !!projectId };
  const pending = annotationApi.annotation.getPendingItemsCount.useQuery(input, options);
  const assigned = annotationApi.annotation.getAssignedItemsCount.useQuery(input, options);
  const queueBadges = annotationApi.annotation.getQueueItemsCounts.useQuery(input, options);
  return {
    pendingCount: pending.data?.count,
    assignedCount: assigned.data?.count,
    queues: queueBadges.data ?? [],
  };
}

/** One queue, named by the slug the router captured or by its id. */
export function useAnnotationQueue({
  projectId,
  slug,
  queueId,
}: {
  projectId: string | undefined;
  slug?: string | undefined;
  queueId?: string | undefined;
}) {
  return annotationApi.annotation.getQueueBySlugOrId.useQuery(
    { projectId: projectId ?? "", ...(slug ? { slug } : {}), ...(queueId ? { queueId } : {}) },
    { enabled: !!projectId && (!!slug || !!queueId) },
  );
}

/** The queues the project has, as the send-to-queue picker lists them. */
export function useAnnotationQueueList({ projectId }: { projectId: string | undefined }) {
  return annotationApi.annotation.getQueues.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}

/** The score types a queue may collect. */
export function useActiveScoreTypes({ projectId }: { projectId: string | undefined }) {
  return annotationApi.annotationScore.getAllActive.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}

/** Every score type of the project, active or not. */
export function useScoreTypes({ projectId }: { projectId: string | undefined }) {
  return annotationApi.annotationScore.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}

/** The organization's members and their teams, for the participants picker. */
export function useOrganizationMembers({ organizationId }: { organizationId: string | undefined }) {
  return annotationApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );
}

/** Every annotation of the project inside the period. */
export function useAllAnnotations({
  projectId,
  startDate,
  endDate,
  enabled = true,
}: {
  projectId: string | undefined;
  startDate: AnnotationPeriodMoment;
  endDate: AnnotationPeriodMoment;
  enabled?: boolean;
}) {
  return annotationApi.annotation.getAll.useQuery(
    { projectId: projectId ?? "", startDate, endDate },
    { enabled: enabled && !!projectId },
  );
}

/** Trace ids per request: queries travel as GET, so a long id list must split. */
const TRACE_ID_CHUNK = 50;

/** Everything said about a set of traces, anchored comments included, in URL-safe chunks. */
export function useAnnotationsByTraceIds({
  projectId,
  traceIds,
  enabled,
}: {
  projectId: string | undefined;
  traceIds: readonly string[];
  enabled: boolean;
}) {
  const chunks = useMemo(() => {
    const unique = [...new Set(traceIds)].toSorted();
    const out: string[][] = [];
    for (let at = 0; at < unique.length; at += TRACE_ID_CHUNK) {
      out.push(unique.slice(at, at + TRACE_ID_CHUNK));
    }
    return out;
  }, [traceIds]);

  const results = annotationApi.useQueries((t) =>
    chunks.map((ids) =>
      t.annotation.getByTraceIds(
        { projectId: projectId ?? "", traceIds: ids, anchor: "all" },
        { enabled: enabled && !!projectId },
      ),
    ),
  );

  // useQueries answers a new array every render; the data changes only with a chunk or an answer.
  const answeredAt = results.map((result) => result.dataUpdatedAt).join(",");
  const flattened = results.flatMap((result) => result.data ?? []);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on what the answers are
  const data = useMemo(() => flattened, [chunks, answeredAt]);

  return {
    data,
    isLoading: enabled && results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
  };
}

/** The traces behind a set of annotations. */
export function useAnnotationTraces({
  projectId,
  traceIds,
}: {
  projectId: string | undefined;
  traceIds: string[];
}) {
  return annotationApi.traces.getTracesWithSpans.useQuery(
    { projectId: projectId ?? "", traceIds },
    { enabled: !!projectId },
  );
}
