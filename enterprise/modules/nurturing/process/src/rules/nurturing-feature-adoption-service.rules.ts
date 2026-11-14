import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

/** Decides the calls a team member invite raises. */
export function fireTeamMemberInvited({
  userId,
  teamMemberCount,
  role,
}: {
  userId: string;
  teamMemberCount: number;
  role: string;
}): CioBatchCall[] {
  return [
    { type: "identify", userId, traits: { team_member_count: teamMemberCount } },
    { type: "track", userId, event: "team_member_invited", properties: { role } },
  ];
}

/** Decides the calls a created workflow raises. */
export function fireWorkflowCreated({
  userId,
  workflowCount,
  workflowId,
  projectId,
}: {
  userId: string;
  workflowCount: number;
  workflowId: string;
  projectId: string;
}): CioBatchCall[] {
  return [
    { type: "identify", userId, traits: { workflow_count: workflowCount } },
    {
      type: "track",
      userId,
      event: "workflow_created",
      properties: { workflow_id: workflowId, project_id: projectId },
    },
  ];
}

/**
 * Decides the calls a created scenario raises. scenario_count is not sent here: the
 * organization's usage traits carry it to each member, and a second writer would overwrite it.
 */
export function fireScenarioCreated({
  userId,
  scenarioId,
  projectId,
}: {
  userId: string;
  scenarioId: string;
  projectId: string;
}): CioBatchCall[] {
  return [
    {
      type: "track",
      userId,
      event: "scenario_created",
      properties: { scenario_id: scenarioId, project_id: projectId },
    },
  ];
}

/** Decides the call a finished experiment raises. */
export function fireExperimentRan({
  userId,
  experimentId,
  projectId,
}: {
  userId: string;
  experimentId?: string;
  projectId: string;
}): CioBatchCall[] {
  return [
    {
      type: "track",
      userId,
      event: "experiment_ran",
      properties: { experiment_id: experimentId, project_id: projectId },
    },
  ];
}
