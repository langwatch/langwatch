/**
 * What adopting a feature tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import {
  fireExperimentRan,
  fireScenarioCreated,
  fireTeamMemberInvited,
  fireWorkflowCreated,
} from "../nurturing-feature-adoption-service.rules.ts";

describe("feature adoption signals", () => {
  describe("given a person inviting a team member", () => {
    describe("when the invite is sent", () => {
      /** @scenario "Team member invite updates member count and fires event" */
      it("decides to raise the team member count and track the invitation", () => {
        const calls = fireTeamMemberInvited({
          userId: "user-1",
          teamMemberCount: 4,
          role: "member",
        });

        expect(calls).toEqual([
          { type: "identify", userId: "user-1", traits: { team_member_count: 4 } },
          {
            type: "track",
            userId: "user-1",
            event: "team_member_invited",
            properties: { role: "member" },
          },
        ]);
      });
    });
  });

  describe("given a person creating a workflow", () => {
    describe("when the workflow is saved", () => {
      /** @scenario "Workflow creation updates workflow count and fires event" */
      it("decides to raise the workflow count and track the workflow and project", () => {
        const calls = fireWorkflowCreated({
          userId: "user-1",
          workflowCount: 2,
          workflowId: "workflow-1",
          projectId: "project-1",
        });

        expect(calls).toEqual([
          { type: "identify", userId: "user-1", traits: { workflow_count: 2 } },
          {
            type: "track",
            userId: "user-1",
            event: "workflow_created",
            properties: { workflow_id: "workflow-1", project_id: "project-1" },
          },
        ]);
      });
    });
  });

  describe("given a person creating a scenario", () => {
    describe("when the scenario is saved", () => {
      /** @scenario "Scenario creation updates scenario count and fires event" */
      it("decides to raise the scenario count and track the scenario and project", () => {
        const calls = fireScenarioCreated({
          userId: "user-1",
          scenarioCount: 3,
          scenarioId: "scenario-1",
          projectId: "project-1",
        });

        expect(calls).toEqual([
          { type: "identify", userId: "user-1", traits: { scenario_count: 3 } },
          {
            type: "track",
            userId: "user-1",
            event: "scenario_created",
            properties: { scenario_id: "scenario-1", project_id: "project-1" },
          },
        ]);
      });
    });
  });

  describe("given a person running an experiment", () => {
    describe("when the experiment completes", () => {
      /** @scenario "Experiment run fires event" */
      it("decides to track the experiment and its project", () => {
        const calls = fireExperimentRan({
          userId: "user-1",
          experimentId: "experiment-1",
          projectId: "project-1",
        });

        expect(calls).toEqual([
          {
            type: "track",
            userId: "user-1",
            event: "experiment_ran",
            properties: { experiment_id: "experiment-1", project_id: "project-1" },
          },
        ]);
      });
    });
  });
});
