/**
 * Unit tests for ScenarioFailureHandler service.
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { ScenarioFailureHandler } from "../scenario-failure-handler";
import {
  decodeScenarioError,
  ScenarioInfraErrorCode,
} from "../scenario-infra-error";

const mockFinishRun = vi.fn().mockResolvedValue(undefined);

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    simulations: {
      finishRun: mockFinishRun,
    },
  }),
}));

describe("ScenarioFailureHandler", () => {
  let handler: ScenarioFailureHandler;

  const baseParams = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    scenarioRunId: "scenariorun_preassigned123",
  };

  beforeEach(() => {
    mockFinishRun.mockClear();
    handler = ScenarioFailureHandler.create();
  });

  describe("when called with an error", () => {
    it("dispatches finishRun with ERROR status and a plain-text reasoning", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Child process exited with code 1",
      });

      expect(mockFinishRun).toHaveBeenCalledTimes(1);
      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "proj_123",
          scenarioRunId: "scenariorun_preassigned123",
          status: ScenarioRunStatus.ERROR,
          results: expect.objectContaining({
            verdict: Verdict.FAILURE,
            // reasoning stays a plain human sentence for text consumers
            reasoning: "Child process exited with code 1",
          }),
        }),
      );
    });

    it("encodes the error as a handled-error envelope the drawer can decode", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error:
          "fetch failed: self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)",
      });

      const results = (
        mockFinishRun.mock.calls[0]?.[0] as {
          results: { error: string };
        }
      ).results;
      const decoded = decodeScenarioError(results.error);
      expect(decoded?.code).toBe(ScenarioInfraErrorCode.UntrustedCertificate);
      expect(decoded?.hint).toBeDefined();
    });
  });

  describe("when the run belongs to a suite the user is watching", () => {
    /**
     * The push that tells an open panel a run moved is built from this event
     * and read straight off it — there is no projection behind it to look the
     * run up in. A panel filtered to a set drops a push that does not carry
     * one, and the client-side fallbacks that used to flip the row anyway are
     * gone: the poll is disabled while SSE is connected, and the stall re-check
     * was removed. Dropping the ids here therefore left every reaped run —
     * stalled, cancelled, faulted — reading IN_PROGRESS on the open panel until
     * the user navigated away.
     *
     * @scenario "A run that could not report its own ending still updates the open panel"
     */
    it("says which batch and set the run belongs to", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Child process exited with code 1",
      });

      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          batchRunId: "batch_abc",
          scenarioSetId: "set_789",
        }),
      );
    });

    it("says so for a stalled run, which is the same terminal path", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Scenario run stopped reporting progress",
        outcome: "stalled",
      });

      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          batchRunId: "batch_abc",
          scenarioSetId: "set_789",
        }),
      );
    });
  });

  describe("when the run's placement is not known", () => {
    // An absent id and a blank one are equally unmatchable to a filtered panel,
    // but a blank one claims on the event that the run has a placement.
    it("omits the ids rather than sending them blank", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        setId: "",
        batchRunId: "",
        error: "Child process exited with code 1",
      });

      const payload = mockFinishRun.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(payload).not.toHaveProperty("batchRunId");
      expect(payload).not.toHaveProperty("scenarioSetId");
    });
  });

  describe("when the outcome is cancelled", () => {
    it("dispatches finishRun with CANCELLED status", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Cancelled by user",
        outcome: "cancelled",
      });

      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ScenarioRunStatus.CANCELLED,
          results: expect.objectContaining({
            verdict: Verdict.INCONCLUSIVE,
            reasoning: "Cancelled by user",
          }),
        }),
      );
    });
  });

  describe("when the outcome is stalled", () => {
    /** @scenario "A run whose worker disappears is recorded as failed" */
    it("stores STALLED rather than leaving it to be derived per read", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error:
          "Scenario run stopped reporting progress — the worker executing it is no longer alive",
        outcome: "stalled",
      });

      // Before ADR-073 step 2 (retired; ground now ADR-103) this wrote ERROR and the UI derived STALLED from
      // how long ago the row was last touched, so the same run read as two
      // different statuses depending on when you looked.
      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ScenarioRunStatus.STALLED,
          results: expect.objectContaining({ verdict: Verdict.FAILURE }),
        }),
      );
    });
  });

  describe("when scenarioRunId is not provided", () => {
    it("does not dispatch any events", async () => {
      await handler.ensureFailureEventsEmitted({
        projectId: "proj_123",
        scenarioId: "scen_456",
        setId: "set_789",
        batchRunId: "batch_abc",
        error: "Some error",
      });

      expect(mockFinishRun).not.toHaveBeenCalled();
    });
  });

  describe("when finishRun fails", () => {
    it("propagates the error", async () => {
      mockFinishRun.mockRejectedValue(new Error("CH unavailable"));

      await expect(
        handler.ensureFailureEventsEmitted({
          ...baseParams,
          error: "Child process exited with code 1",
        }),
      ).rejects.toThrow("CH unavailable");
    });
  });
});
