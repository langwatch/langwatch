/**
 * What an automation card reads as the VIEWER, through the reads the
 * Automations page already uses: the automation as it is now (a pause answers
 * with only its name and state), when it next acts, and the Slack connections
 * that name its destination. Never a server procedure of its own.
 */
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  type LangyAutomationRecord,
  type LangyNextFiring,
  readAutomation,
} from "../logic/langyAutomationSummary";

export interface LangySlackConnectionSummary {
  id: string;
  name: string;
  kind: "BOT" | "INCOMING_WEBHOOK";
  scopeType: "PROJECT" | "ORGANIZATION";
}

/** The Slack connections this project can use, as the viewer sees them. */
export function useLangySlackConnections(): {
  connections: LangySlackConnectionSummary[] | undefined;
  canAdd: boolean;
  isLoading: boolean;
  isError: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const list = api.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: true },
  );
  return {
    connections: list.data?.connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      scopeType: connection.scopeType,
    })),
    canAdd: !!list.data?.canManageProject || !!list.data?.canManageOrganization,
    isLoading: list.isLoading,
    isError: list.isError,
  };
}

/** The automation as it is now, and when it next acts. */
export function useLangyAutomationNow(automationId: string | null): {
  fresh: LangyAutomationRecord | null;
  nextFiring: LangyNextFiring | null;
} {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const enabled = !!projectId && !!automationId;
  const input = { projectId, triggerId: automationId ?? "" };
  // Every card re-reads on mount, and a read in flight is not trusted: a card
  // for "pause that alert" must not show the state an earlier card cached.
  const current = api.automation.getTriggerById.useQuery(input, {
    enabled,
    refetchOnMount: "always",
  });
  const next = api.automation.getNextFiring.useQuery(input, {
    enabled,
    refetchOnMount: "always",
  });
  return {
    fresh: current.isFetching ? null : readAutomation(current.data ?? null),
    nextFiring: next.isFetching ? null : (next.data ?? null),
  };
}
