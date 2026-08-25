/**
 * Unit tests for ScenarioFailureHandler service.
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus, Verdict } from "~/server/scenarios/scenario-event.enums";
import { ScenarioFailureHandler } from "../scenario-failure-handler";
import { decodeScenarioError, ScenarioInfraErrorCode } from "../scenario-infra-error";

const mockFinishRun = vi.fn().mockResolvedValue(undefined);

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
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

  describe("when the target is an HTTP agent carrying a devTunnel marker", () => {
    const devTunnelParams = {
      ...baseParams,
      target: { type: "http", referenceId: "agent_dev1" },
    };
    const lookupWithDevTunnel = vi.fn().mockResolvedValue({
      url: "https://gone.trycloudflare.com",
      devTunnel: { previousUrl: "https://staging.example.com/agent" },
    });

    beforeEach(() => {
      lookupWithDevTunnel.mockClear();
      handler = ScenarioFailureHandler.create(lookupWithDevTunnel);
    });

    /** @scenario "A transport failure on a tunneled agent is named a dead dev tunnel" */
    it("classifies a transport failure as a dead dev tunnel with a restart hint", async () => {
      await handler.ensureFailureEventsEmitted({
        ...devTunnelParams,
        error: "TypeError: fetch failed (ECONNREFUSED)",
      });

      const results = (mockFinishRun.mock.calls[0]?.[0] as { results: { error: string } })
        .results;
      const decoded = decodeScenarioError(results.error);
      expect(decoded?.code).toBe(ScenarioInfraErrorCode.AgentDevTunnelUnreachable);
      expect(decoded?.hint).toContain("langwatch agent dev");
      expect(lookupWithDevTunnel).toHaveBeenCalledWith({
        projectId: "proj_123",
        agentId: "agent_dev1",
      });
    });

    it("classifies the tunnel edge's HTTP 530 answer the same way", async () => {
      await handler.ensureFailureEventsEmitted({
        ...devTunnelParams,
        error:
          "HTTP 530: error from https://gone.trycloudflare.com (request-id: abc): error code: 1033",
      });

      const results = (mockFinishRun.mock.calls[0]?.[0] as { results: { error: string } })
        .results;
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
      );
    });

    it("keeps the generic classification for a non-transport failure", async () => {
      await handler.ensureFailureEventsEmitted({
        ...devTunnelParams,
        error: "provider_error: API key is invalid",
      });

      const results = (mockFinishRun.mock.calls[0]?.[0] as { results: { error: string } })
        .results;
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.ModelProviderError,
      );
      // The agent lookup is only paid for transport-level failures.
      expect(lookupWithDevTunnel).not.toHaveBeenCalled();
    });

    it("degrades to the generic classification when the agent lookup fails", async () => {
      lookupWithDevTunnel.mockRejectedValueOnce(new Error("db down"));

      await handler.ensureFailureEventsEmitted({
        ...devTunnelParams,
        error: "TypeError: fetch failed",
      });

      const results = (mockFinishRun.mock.calls[0]?.[0] as { results: { error: string } })
        .results;
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });
  });

  describe("when the target is an HTTP agent without a devTunnel marker", () => {
    /** @scenario "A transport failure on a regular agent keeps its generic classification" */
    it("keeps the unreachable-endpoint classification", async () => {
      const lookup = vi.fn().mockResolvedValue({ url: "https://api.example.com" });
      handler = ScenarioFailureHandler.create(lookup);

      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        target: { type: "http", referenceId: "agent_plain" },
        error: "TypeError: fetch failed (ECONNREFUSED)",
      });

      const results = (mockFinishRun.mock.calls[0]?.[0] as { results: { error: string } })
        .results;
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });
  });

  describe("when called with cancelled: true", () => {
    it("dispatches finishRun with CANCELLED status", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Cancelled by user",
        cancelled: true,
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
