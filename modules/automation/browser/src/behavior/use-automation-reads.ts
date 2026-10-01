/** The reads the automation screens and drawers share, one hook per procedure. */

import { datasetClient } from "@langwatch/dataset-client";

import { api, automationApi } from "./automation-api.ts";
import { slackApi } from "./slack-api.ts";

type Scope = { projectId: string; enabled?: boolean };

/** The overview table's reads: rows, fire-history rollup, throttle badges, schedules, activity. */
export function useAutomationOverviewReads({ projectId }: { projectId: string }) {
  const options = { enabled: !!projectId };
  return {
    triggers: api.automation.getTriggers.useQuery({ projectId }, options),
    triggerStats: api.automation.getTriggerStats.useQuery({ projectId }, options),
    capStatus: api.automation.getDailyCapStatus.useQuery({ projectId }, options),
    reportSchedules: api.automation.getReportSchedules.useQuery({ projectId }, options),
    activity: api.automation.getRecentActivity.useQuery({ projectId }, options),
  };
}

/** One automation, by id. */
export function useAutomation({
  projectId,
  triggerId,
}: {
  projectId: string;
  triggerId: string | undefined;
}) {
  return api.automation.getTriggerById.useQuery(
    { triggerId: triggerId ?? "", projectId },
    { enabled: !!triggerId && !!projectId },
  );
}

/** The project's Slack connections; one cache entry for every row and picker. */
export function useSlackConnections({ projectId, enabled = true }: Scope) {
  return slackApi.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId && enabled },
  );
}

/** The project's datasets. */
export function useProjectDatasets({ projectId, enabled = true }: Scope) {
  return datasetClient.dataset.getAll.useQuery({ projectId }, { enabled: !!projectId && enabled });
}

/** The project's graphs. */
export function useProjectGraphs({ projectId, enabled = true }: Scope) {
  return api.graphs.getAll.useQuery({ projectId }, { enabled: !!projectId && enabled });
}

/** The project's dashboards. */
export function useProjectDashboards({ projectId, enabled = true }: Scope) {
  return api.dashboards.getAll.useQuery({ projectId }, { enabled: !!projectId && enabled });
}

/** One graph, by id; a missing one is an error, not a retry. */
export function useGraph({
  projectId,
  graphId,
  enabled = true,
}: {
  projectId: string;
  graphId: string | null | undefined;
  enabled?: boolean;
}) {
  return api.graphs.getById.useQuery(
    { projectId, id: graphId ?? "" },
    { enabled: enabled && !!graphId && !!projectId, retry: false },
  );
}

/** The plan's daily ceiling on persist actions. */
export function useDailyCap({ projectId, enabled = true }: Scope) {
  return api.automation.getDailyCap.useQuery(
    { projectId },
    { enabled: !!projectId && enabled, retry: false },
  );
}

type TraceListInput = Parameters<typeof api.traces.list.useQuery>[0];

/** A page of the traces a condition matches, for the recent-matches panel. */
export function useMatchingTraces({ input, enabled }: { input: TraceListInput; enabled: boolean }) {
  return api.traces.list.useQuery(input, { enabled, retry: false });
}

/** The match preview: keeps the last answer on screen while the next one resolves. */
export function useTracePreview({ input, enabled }: { input: TraceListInput; enabled: boolean }) {
  return api.traces.list.useQuery(input, {
    enabled,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

/** The webhook deliveries of one automation. */
export function useWebhookDeliveries({
  projectId,
  triggerId,
}: {
  projectId: string;
  triggerId: string;
}) {
  return api.automation.getWebhookDeliveries.useQuery(
    { triggerId, projectId, limit: 50 },
    { enabled: !!projectId },
  );
}

/** The fire history of one automation, a page at a time. */
export function useFireHistory({
  projectId,
  triggerId,
  limit,
}: {
  projectId: string;
  triggerId: string;
  limit: number;
}) {
  return api.automation.getFireHistory.useInfiniteQuery(
    { projectId, triggerId, limit },
    {
      enabled: !!projectId,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
}

/** The latest threshold evaluation of a graph alert. */
export function useLatestEvaluation({
  projectId,
  triggerId,
  enabled,
}: {
  projectId: string;
  triggerId: string;
  enabled: boolean;
}) {
  return api.automation.getLatestEvaluation.useQuery({ projectId, triggerId }, { enabled });
}

/** When a scheduled automation next fires. */
export function useNextFiring({ projectId, triggerId }: { projectId: string; triggerId: string }) {
  return api.automation.getNextFiring.useQuery(
    { projectId, triggerId },
    { enabled: !!projectId, retry: false },
  );
}

/** The annotation queues a participant can be picked from. */
export function useAnnotationQueues({ projectId }: { projectId: string | undefined }) {
  return api.annotation.getQueues.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}

/** The organization's members and their teams, for the participants picker. */
export function useOrganizationMembers({ organizationId }: { organizationId: string | undefined }) {
  return api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );
}

/** One team with its members, for the email recipient picker. */
export function useTeamWithMembers({
  slug,
  organizationId,
}: {
  slug: string | undefined;
  organizationId: string | undefined;
}) {
  return api.team.getTeamWithMembers.useQuery(
    { slug: slug ?? "", organizationId: organizationId ?? "" },
    { enabled: !!slug && !!organizationId },
  );
}

/** What an unsubscribe link names; an unknown or expired token is an error, not a retry. */
export function useUnsubscribeTarget({ token }: { token: string }) {
  return automationApi.emailSuppression.resolveUnsubscribeToken.useQuery(
    { token },
    { enabled: !!token, retry: false },
  );
}
