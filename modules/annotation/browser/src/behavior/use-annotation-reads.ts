/** The reads the annotation screens share, one hook per procedure. */

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
}: {
  projectId: string | undefined;
  startDate: AnnotationPeriodMoment;
  endDate: AnnotationPeriodMoment;
}) {
  return annotationApi.annotation.getAll.useQuery(
    { projectId: projectId ?? "", startDate, endDate },
    { enabled: !!projectId },
  );
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
