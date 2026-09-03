import { reportNurturingFailure, tryNurturingSink } from "./nurturing-sink";

/**
 * Fires nurturing calls when a team member is invited.
 *
 * Updates the user's team_member_count trait and tracks the event.
 * All calls are fire-and-forget.
 */
export function fireTeamMemberInvitedNurturing({
  userId,
  teamMemberCount,
  role,
}: {
  userId: string;
  teamMemberCount: number;
  role: string;
}): void {
  const nurturing = tryNurturingSink();
  if (!nurturing) return;

  void nurturing
    .identifyUser({ userId, traits: { team_member_count: teamMemberCount } })
    .catch(reportNurturingFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "team_member_invited",
      properties: {
        role,
      },
    })
    .catch(reportNurturingFailure);
}

/**
 * Fires nurturing calls when a workflow is created.
 *
 * Updates the user's workflow_count trait and tracks the event.
 * All calls are fire-and-forget.
 */
export function fireWorkflowCreatedNurturing({
  userId,
  workflowCount,
  workflowId,
  projectId,
}: {
  userId: string;
  workflowCount: number;
  workflowId: string;
  projectId: string;
}): void {
  const nurturing = tryNurturingSink();
  if (!nurturing) return;

  void nurturing
    .identifyUser({ userId, traits: { workflow_count: workflowCount } })
    .catch(reportNurturingFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "workflow_created",
      properties: {
        workflow_id: workflowId,
        project_id: projectId,
      },
    })
    .catch(reportNurturingFailure);
}

/**
 * Fires nurturing calls when a scenario is created.
 *
 * Updates the user's scenario_count trait and tracks the event.
 * All calls are fire-and-forget.
 */
export function fireScenarioCreatedNurturing({
  userId,
  scenarioCount,
  scenarioId,
  projectId,
}: {
  userId: string;
  scenarioCount: number;
  scenarioId: string;
  projectId: string;
}): void {
  const nurturing = tryNurturingSink();
  if (!nurturing) return;

  void nurturing
    .identifyUser({ userId, traits: { scenario_count: scenarioCount } })
    .catch(reportNurturingFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "scenario_created",
      properties: {
        scenario_id: scenarioId,
        project_id: projectId,
      },
    })
    .catch(reportNurturingFailure);
}

/**
 * Fires nurturing event when an experiment is run.
 *
 * Fire-and-forget.
 */
export function fireExperimentRanNurturing({
  userId,
  experimentId,
  projectId,
}: {
  userId: string;
  experimentId?: string;
  projectId: string;
}): void {
  const nurturing = tryNurturingSink();
  if (!nurturing) return;

  void nurturing
    .trackEvent({
      userId,
      event: "experiment_ran",
      properties: {
        experiment_id: experimentId,
        project_id: projectId,
      },
    })
    .catch(reportNurturingFailure);
}
