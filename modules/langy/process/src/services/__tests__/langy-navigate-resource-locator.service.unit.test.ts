/**
 * The navigate fallback's resource half: an id is looked up in its owning
 * feature, with the asking project's own access.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { AgentNotFoundError, type AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  type LangyNavigateResourceLocation,
  LangyNavigateResourceLocatorService,
} from "../langy-navigate-resource-locator.service.ts";

const address = async (location: LangyNavigateResourceLocation) =>
  location.outcome === "located" ? location.address("acme") : location.outcome;

function locator(input: {
  experiments?: Partial<Pick<ExperimentApi, "findById">>;
  agents?: Partial<Pick<AgentApi, "getById" | "platformUrl">>;
}) {
  return LangyNavigateResourceLocatorService.create({
    experiments: createApiFixture<ExperimentApi>(input.experiments ?? {}),
    agents: createApiFixture<AgentApi>(input.agents ?? {}),
    publicBaseUrl: "https://app.langwatch.test",
  });
}

describe("LangyNavigateResourceLocatorService", () => {
  describe("when the id names an agent", () => {
    it("opens the agent at the address the agent module hands out", async () => {
      const agents = {
        getById: async ({ id }: { id: string }) =>
          createApiFixture<Awaited<ReturnType<AgentApi["getById"]>>>({ id, type: "http" }),
        platformUrl: ({
          projectSlug,
          agentId,
          agentType,
        }: Parameters<AgentApi["platformUrl"]>[0]) =>
          `https://app.langwatch.test/${projectSlug}/agents#${agentType}:${agentId}`,
      };

      expect(
        await address(
          await locator({ agents }).locate({
            projectId: "project-1",
            kind: "agent",
            resourceId: "agent_1",
          }),
        ),
      ).toBe("https://app.langwatch.test/acme/agents#http:agent_1");
    });

    it("answers unknown when the project holds no such agent", async () => {
      const agents = {
        getById: () => Promise.reject(new AgentNotFoundError("agent_gone", "project-1")),
      };

      expect(
        await locator({ agents }).locate({
          projectId: "project-1",
          kind: "agent",
          resourceId: "agent_gone",
        }),
      ).toEqual({ outcome: "unknown" });
    });
  });

  describe("when the id names an experiment", () => {
    it("answers unknown when the project holds no such experiment", async () => {
      expect(
        await locator({ experiments: { findById: async () => null } }).locate({
          projectId: "project-1",
          kind: "experiment",
          resourceId: "experiment_gone",
        }),
      ).toEqual({ outcome: "unknown" });
    });
  });
});
