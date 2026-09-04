/**
 * What adopting a feature tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireExperimentRanNurturing,
  fireScenarioCreatedNurturing,
  fireTeamMemberInvitedNurturing,
  fireWorkflowCreatedNurturing,
} from "../nurturing-feature-adoption.service";
import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "./support/nurturing-harness";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => registerNoNurturingSink());

describe("feature adoption signals", () => {
  describe("given a person inviting a team member", () => {
    describe("when the invite is sent", () => {
      /** @scenario "Team member invite updates member count and fires event" */
      it("raises the team member count and tracks the invitation", async () => {
        const sink = registerNurturingSink();

        fireTeamMemberInvitedNurturing({ userId: "user-1", teamMemberCount: 4, role: "member" });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
          userId: "user-1",
          traits: { team_member_count: 4 },
        });
        expect(sink.sentTo("/track")[0]).toMatchObject({
          userId: "user-1",
          event: "team_member_invited",
          properties: { role: "member" },
        });
      });
    });
  });

  describe("given a person creating a workflow", () => {
    describe("when the workflow is saved", () => {
      /** @scenario "Workflow creation updates workflow count and fires event" */
      it("raises the workflow count and tracks the workflow and project", async () => {
        const sink = registerNurturingSink();

        fireWorkflowCreatedNurturing({
          userId: "user-1",
          workflowCount: 2,
          workflowId: "workflow-1",
          projectId: "project-1",
        });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({ traits: { workflow_count: 2 } });
        expect(sink.sentTo("/track")[0]).toMatchObject({
          event: "workflow_created",
          properties: { workflow_id: "workflow-1", project_id: "project-1" },
        });
      });
    });
  });

  describe("given a person creating a scenario", () => {
    describe("when the scenario is saved", () => {
      /** @scenario "Scenario creation updates scenario count and fires event" */
      it("raises the scenario count and tracks the scenario and project", async () => {
        const sink = registerNurturingSink();

        fireScenarioCreatedNurturing({
          userId: "user-1",
          scenarioCount: 3,
          scenarioId: "scenario-1",
          projectId: "project-1",
        });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({ traits: { scenario_count: 3 } });
        expect(sink.sentTo("/track")[0]).toMatchObject({
          event: "scenario_created",
          properties: { scenario_id: "scenario-1", project_id: "project-1" },
        });
      });
    });
  });

  describe("given a person running an experiment", () => {
    describe("when the experiment completes", () => {
      /** @scenario "Experiment run fires event" */
      it("tracks the experiment and its project", async () => {
        const sink = registerNurturingSink();

        fireExperimentRanNurturing({
          userId: "user-1",
          experimentId: "experiment-1",
          projectId: "project-1",
        });
        await settle();

        expect(sink.sentTo("/track")[0]).toMatchObject({
          event: "experiment_ran",
          properties: { experiment_id: "experiment-1", project_id: "project-1" },
        });
      });
    });
  });

  describe("given Customer.io is unavailable", () => {
    describe("when a workflow is saved", () => {
      /** @scenario "Feature adoption hook failure does not break the originating action" */
      it("returns normally and reports the failure for observability", async () => {
        const sink = registerNurturingSink({ failing: true });

        expect(() =>
          fireWorkflowCreatedNurturing({
            userId: "user-1",
            workflowCount: 1,
            workflowId: "workflow-1",
            projectId: "project-1",
          }),
        ).not.toThrow();
        await settle();

        expect(sink.errorReporter.capture).toHaveBeenCalled();
      });
    });
  });
});
