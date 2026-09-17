import { findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";

/**
 * Fires nurturing calls when a team member is invited.
 */
export function fireTeamMemberInvited({
  userId,
  teamMemberCount,
  role,
}: {
  userId: string;
  teamMemberCount: number;
  role: string;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({ userId, traits: { team_member_count: teamMemberCount } })
    .catch(reportFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "team_member_invited",
      properties: {
        role,
      },
    })
    .catch(reportFailure);
}

/**
 * Fires nurturing calls when a workflow is created.
 */
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
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({ userId, traits: { workflow_count: workflowCount } })
    .catch(reportFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "workflow_created",
      properties: {
        workflow_id: workflowId,
        project_id: projectId,
      },
    })
    .catch(reportFailure);
}

/**
 * Fires nurturing calls when a scenario is created.
 */
export function fireScenarioCreated({
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
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({ userId, traits: { scenario_count: scenarioCount } })
    .catch(reportFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "scenario_created",
      properties: {
        scenario_id: scenarioId,
        project_id: projectId,
      },
    })
    .catch(reportFailure);
}

/**
 * Fires nurturing event when an experiment is run.
 *
 * Fire-and-forget.
 */
export function fireExperimentRan({
  userId,
  experimentId,
  projectId,
}: {
  userId: string;
  experimentId?: string;
  projectId: string;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .trackEvent({
      userId,
      event: "experiment_ran",
      properties: {
        experiment_id: experimentId,
        project_id: projectId,
      },
    })
    .catch(reportFailure);
}
