/**
 * What an automation card reads as the VIEWER, through the reads the Automations page already
 * uses: the automation as it is now (a pause answers with only its name and state), when it next
 * acts, and the Slack connections that name its destination. Never a procedure of its own.
 */
import type { WireOf } from "@langwatch/api/web";
import type { NextFiring } from "@langwatch/automation-contract";
import { type SlackConnection } from "@langwatch/slack-browser-kit";

import { api } from "../../../behavior/langy-api.ts";
import { slackApi } from "../../../behavior/slack-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import {
  type LangyAutomationRecord,
  readAutomations,
} from "../model/logic/langy-automation-summary.ts";

/** The Slack connections this project can use, as the viewer sees them. */
export function useLangySlackConnections(): {
  connections: SlackConnection[] | undefined;
  canAdd: boolean;
  isLoading: boolean;
  isError: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const list = slackApi.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: true },
  );
  return {
    connections: list.data?.connections,
    canAdd: !!list.data?.canManageProject || !!list.data?.canManageOrganization,
    isLoading: list.isLoading,
    isError: list.isError,
  };
}

/** The automation as it is now, and when it next acts. */
export function useLangyAutomationNow({ automationId }: { automationId: string }): {
  fresh: LangyAutomationRecord | undefined;
  nextFiring: WireOf<NextFiring> | undefined;
} {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const input = { projectId, triggerId: automationId };
  // Every card re-reads on mount, and a read in flight is not trusted: a card for "pause that
  // alert" must not show the state an earlier card cached.
  const enabled = !!projectId;
  const current = api.automation.getTriggerById.useQuery(input, {
    enabled,
    refetchOnMount: "always",
  });
  const next = api.automation.getNextFiring.useQuery(input, { enabled, refetchOnMount: "always" });
  const [fresh] = current.isFetching ? [] : readAutomations(current.data);
  return { fresh, nextFiring: next.isFetching ? undefined : next.data };
}
