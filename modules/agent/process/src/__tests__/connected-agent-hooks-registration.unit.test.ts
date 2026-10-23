/**
 * A register frame's scenario hooks reach the agent's stored config (ADR-180).
 * @see modules/agent/specs/scenario-hooks-protocol.feature
 */
import { type AgentHooks, PROTOCOL_VERSION } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { createAgentAppFixture } from "../app/__tests__/agent.fixture.ts";
import { MemoryConnectedAgentRelayChannel } from "../channels/memory/memory.connected-agent-relay.channel.ts";
import { MemoryConnectedAgentStateRepository } from "../repositories/memory/memory.connected-agent-state.repository.ts";
import { ConnectedAgentRuntimeService } from "../services/connected-agent-runtime.service.ts";
import { createConnectedAgentFixture, createLongPollFixture } from "./connected-agent.fixture.ts";

const projectId = "project_hooks";

/** Registers one agent through the HTTP transport and reads back its stored config. */
async function registerAndReadConfig(hooks: AgentHooks | undefined) {
  const { app, repositories } = createAgentAppFixture();
  const transport = createLongPollFixture({
    runtime: ConnectedAgentRuntimeService.create({
      podId: "pod_solo",
      state: MemoryConnectedAgentStateRepository.create(),
      relay: MemoryConnectedAgentRelayChannel.create(),
    }),
    agents: createConnectedAgentFixture({
      registerConnected: (input) => app.registerConnected(input),
    }),
    publicBaseUrl: "https://example.test",
    replicaCount: 1,
  });
  const answer = await transport.register({
    credentials: {
      caller: {
        project: { id: projectId, slug: "hooks" },
        principalId: "key:test",
        userId: null,
      },
    },
    body: {
      type: "register",
      protocol: PROTOCOL_VERSION,
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
      instance: {
        id: "inst_hooks",
        hostname: "laptop",
        username: "dev",
        pid: 1,
        startedAt: new Date().toISOString(),
        inFlightCallIds: [],
      },
      agents: [
        {
          name: "shop-assistant",
          environment: "production",
          parameters: {},
          ...(hooks ? { hooks } : {}),
        },
      ],
    },
  });
  await transport.close();
  const agentId = (answer.frame as { agents: { id: string }[] }).agents[0]!.id;
  const agent = await repositories.agents.getById({ id: agentId, projectId });
  return agent?.config as { hooks?: AgentHooks } | undefined;
}

describe("registering a connected agent's scenario hooks", () => {
  describe("when the SDK declares setup and teardown", () => {
    /** @scenario "The register frame with hooks is accepted and stored on the agent" */
    it("records both hooks on the agent's stored config", async () => {
      const config = await registerAndReadConfig({ setup: true, teardown: true });
      expect(config?.hooks).toEqual({ setup: true, teardown: true });
    });
  });

  describe("when an older SDK sends no hooks field", () => {
    /** @scenario "A register frame from an older SDK without hooks is accepted" */
    it("records the agent with no hooks", async () => {
      const config = await registerAndReadConfig(undefined);
      expect(config).toBeDefined();
      expect(config?.hooks).toBeUndefined();
    });
  });
});
