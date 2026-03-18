import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireTeamMemberInvitedNurturing,
  fireWorkflowCreatedNurturing,
  fireScenarioCreatedNurturing,
  fireExperimentRanNurturing,
} from "./featureAdoption";

// Suppress logger output
vi.mock("../../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    nurturing: mockNurturing,
  }),
}));

describe("Feature adoption hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fireTeamMemberInvitedNurturing()", () => {
    describe("when an invite is sent", () => {
      it("identifies user with updated team_member_count", () => {
        fireTeamMemberInvitedNurturing({
          userId: "user-1",
          teamMemberCount: 5,
          role: "member",
        });

        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: { team_member_count: 5 },
        });
      });

      it("tracks team_member_invited event with role", () => {
        fireTeamMemberInvitedNurturing({
          userId: "user-1",
          teamMemberCount: 5,
          role: "member",
        });

        expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "team_member_invited",
          properties: { role: "member" },
        });
      });
    });

    describe("when Customer.io API is unavailable", () => {
      it("does not throw (fire-and-forget)", async () => {
        const { captureException } = await import(
          "../../../../src/utils/posthogErrorCapture"
        );
        mockNurturing.identifyUser.mockRejectedValueOnce(
          new Error("CIO unavailable"),
        );

        expect(() =>
          fireTeamMemberInvitedNurturing({
            userId: "user-1",
            teamMemberCount: 5,
            role: "member",
          }),
        ).not.toThrow();

        await vi.waitFor(() => {
          expect(captureException).toHaveBeenCalled();
        });
      });
    });
  });

  describe("fireWorkflowCreatedNurturing()", () => {
    describe("when the workflow is saved", () => {
      it("identifies user with updated workflow_count", () => {
        fireWorkflowCreatedNurturing({
          userId: "user-1",
          workflowCount: 3,
          workflowId: "wf-1",
          projectId: "proj-1",
        });

        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: { workflow_count: 3 },
        });
      });

      it("tracks workflow_created event with workflow_id and project_id", () => {
        fireWorkflowCreatedNurturing({
          userId: "user-1",
          workflowCount: 3,
          workflowId: "wf-1",
          projectId: "proj-1",
        });

        expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "workflow_created",
          properties: { workflow_id: "wf-1", project_id: "proj-1" },
        });
      });
    });

    describe("when Customer.io API is unavailable", () => {
      it("does not throw (fire-and-forget)", async () => {
        const { captureException } = await import(
          "../../../../src/utils/posthogErrorCapture"
        );
        mockNurturing.identifyUser.mockRejectedValueOnce(
          new Error("CIO unavailable"),
        );

        expect(() =>
          fireWorkflowCreatedNurturing({
            userId: "user-1",
            workflowCount: 3,
            workflowId: "wf-1",
            projectId: "proj-1",
          }),
        ).not.toThrow();

        await vi.waitFor(() => {
          expect(captureException).toHaveBeenCalled();
        });
      });
    });
  });

  describe("fireScenarioCreatedNurturing()", () => {
    describe("when the scenario is saved", () => {
      it("identifies user with updated scenario_count", () => {
        fireScenarioCreatedNurturing({
          userId: "user-1",
          scenarioCount: 7,
          scenarioId: "sc-1",
          projectId: "proj-1",
        });

        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: { scenario_count: 7 },
        });
      });

      it("tracks scenario_created event with scenario_id and project_id", () => {
        fireScenarioCreatedNurturing({
          userId: "user-1",
          scenarioCount: 7,
          scenarioId: "sc-1",
          projectId: "proj-1",
        });

        expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "scenario_created",
          properties: { scenario_id: "sc-1", project_id: "proj-1" },
        });
      });
    });
  });

  describe("fireExperimentRanNurturing()", () => {
    describe("when the experiment completes", () => {
      it("tracks experiment_ran event with experiment_id and project_id", () => {
        fireExperimentRanNurturing({
          userId: "user-1",
          experimentId: "exp-1",
          projectId: "proj-1",
        });

        expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "experiment_ran",
          properties: { experiment_id: "exp-1", project_id: "proj-1" },
        });
      });

      it("does not call identifyUser (no count trait for experiments)", () => {
        fireExperimentRanNurturing({
          userId: "user-1",
          experimentId: "exp-1",
          projectId: "proj-1",
        });

        expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      });
    });
  });
});
