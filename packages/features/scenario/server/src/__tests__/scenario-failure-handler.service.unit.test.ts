/**
 * Unit tests for ScenarioFailureHandlerService service.
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentService,
  type AgentWithFields,
  type HttpAgentConfig,
} from "@langwatch/agent-contract";
import { SimulationService } from "@langwatch/scenario-contract";
import {
  type ScenarioFailureResults,
  ScenarioRunStatus,
  Verdict,
} from "@langwatch/scenario-contract";
import { ScenarioFailureHandlerService } from "@langwatch/scenario-server";
import { decodeScenarioError, ScenarioInfraErrorCode } from "@langwatch/scenario-contract";

const mockFinishRun = vi.fn().mockResolvedValue(undefined);

function testAgentService(
  lookup: (input: {
    projectId: string;
    agentId: string;
  }) => Promise<Partial<HttpAgentConfig> | null>,
): AgentService {
  return Object.assign(Object.create(AgentService.prototype), {
    getById: async ({ id, projectId }: { id: string; projectId: string }) => {
      const foundConfig = await lookup({ projectId, agentId: id });
      if (!foundConfig) throw new Error("Agent not found");

      const agent: AgentWithFields = {
        id,
        projectId,
        name: "Test HTTP agent",
        type: "http",
        config: {
          url: "https://agent.example.com",
          method: "POST",
          ...foundConfig,
        },
        workflowId: null,
        copiedFromAgentId: null,
        archivedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        inputFields: [],
        outputFields: [],
        fieldsResolved: true,
      };
      return agent;
    },
  }) as AgentService;
}

function testSimulationService(): SimulationService {
  return Object.assign(Object.create(SimulationService.prototype), {
    finishRun: mockFinishRun,
  }) as SimulationService;
}

function createHandler(
  lookup: (input: {
    projectId: string;
    agentId: string;
  }) => Promise<Partial<HttpAgentConfig> | null> = vi.fn().mockResolvedValue(null),
): ScenarioFailureHandlerService {
  return ScenarioFailureHandlerService.create({
    agents: testAgentService(lookup),
    simulations: testSimulationService(),
  });
}

function emittedFailureResults(): ScenarioFailureResults {
  const call = mockFinishRun.mock.calls[0];
  if (!call) throw new Error("Expected ScenarioFailureHandlerService to finish the run");

  const input = call[0] as { results: ScenarioFailureResults };
  return input.results;
}

describe("ScenarioFailureHandlerService", () => {
  let handler: ScenarioFailureHandlerService;

  const baseParams = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    scenarioRunId: "scenariorun_preassigned123",
  };

  beforeEach(() => {
    mockFinishRun.mockClear();
    handler = createHandler();
  });

  describe("when called with an error", () => {
    it("dispatches finishRun with ERROR status and a plain-text reasoning", async () => {
      await handler.finishUnsuccessfulRun({
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
      await handler.finishUnsuccessfulRun({
        ...baseParams,
        error:
          "fetch failed: self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)",
      });

      const results = emittedFailureResults();
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
      handler = createHandler(lookupWithDevTunnel);
    });

    /** @scenario "A transport failure on a tunneled agent is named a dead dev tunnel" */
    it("classifies a transport failure as a dead dev tunnel with a restart hint", async () => {
      await handler.finishUnsuccessfulRun({
        ...devTunnelParams,
        error: "TypeError: fetch failed (ECONNREFUSED)",
      });

      const results = emittedFailureResults();
      const decoded = decodeScenarioError(results.error);
      expect(decoded?.code).toBe(ScenarioInfraErrorCode.AgentDevTunnelUnreachable);
      expect(decoded?.hint).toContain("langwatch agent dev");
      expect(lookupWithDevTunnel).toHaveBeenCalledWith({
        projectId: "proj_123",
        agentId: "agent_dev1",
      });
    });

    /** @scenario "A DNS failure on an agent with a dev tunnel names the dead tunnel" */
    it("classifies a name-resolution failure the same way", async () => {
      await handler.finishUnsuccessfulRun({
        ...devTunnelParams,
        error: "getaddrinfo EAI_FAIL gone.trycloudflare.com",
      });

      const finishRunCall = mockFinishRun.mock.calls[0];
      if (!finishRunCall) throw new Error("finishRun was never called");
      const { results } = finishRunCall[0] as { results: { error: string } };
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
      );
    });

    it("classifies the tunnel edge's HTTP 530 answer the same way", async () => {
      await handler.finishUnsuccessfulRun({
        ...devTunnelParams,
        error:
          "HTTP 530: error from https://gone.trycloudflare.com (request-id: abc): error code: 1033",
      });

      const results = emittedFailureResults();
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
      );
    });

    it("keeps the generic classification for a non-transport failure", async () => {
      await handler.finishUnsuccessfulRun({
        ...devTunnelParams,
        error: "provider_error: API key is invalid",
      });

      const results = emittedFailureResults();
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.ModelProviderError,
      );
      // The agent lookup is only paid for transport-level failures.
      expect(lookupWithDevTunnel).not.toHaveBeenCalled();
    });

    it("degrades to the generic classification when the agent lookup fails", async () => {
      lookupWithDevTunnel.mockRejectedValueOnce(new Error("db down"));

      await handler.finishUnsuccessfulRun({
        ...devTunnelParams,
        error: "TypeError: fetch failed",
      });

      const results = emittedFailureResults();
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });
  });

  describe("when the target is an HTTP agent without a devTunnel marker", () => {
    /** @scenario "A transport failure on a regular agent keeps its generic classification" */
    it("keeps the unreachable-endpoint classification", async () => {
      const lookup = vi.fn().mockResolvedValue({ url: "https://api.example.com" });
      handler = createHandler(lookup);

      await handler.finishUnsuccessfulRun({
        ...baseParams,
        target: { type: "http", referenceId: "agent_plain" },
        error: "TypeError: fetch failed (ECONNREFUSED)",
      });

      const results = emittedFailureResults();
      expect(decodeScenarioError(results.error)?.code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });
  });

  describe("when called with cancelled: true", () => {
    it("dispatches finishRun with CANCELLED status", async () => {
      await handler.finishUnsuccessfulRun({
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

  describe("when finishRun fails", () => {
    it("propagates the error", async () => {
      mockFinishRun.mockRejectedValue(new Error("CH unavailable"));

      await expect(
        handler.finishUnsuccessfulRun({
          ...baseParams,
          error: "Child process exited with code 1",
        }),
      ).rejects.toThrow("CH unavailable");
    });
  });
});
