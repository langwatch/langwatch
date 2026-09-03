/**
 * @vitest-environment node
 *
 * What every agent read carries beside the row (ADR-128): the parameters a
 * connected agent declares, the owner of a personal one, and its presence.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentService, AgentWithFields } from "@langwatch/agent-contract";

import { AgentApp } from "../agent.app";
import { NO_PRESENCE, type AgentPresence } from "../../services/connected-agent-presence.service";

const connectedAgent: AgentWithFields = {
  id: "agent_1",
  projectId: "project_1",
  name: "support-agent",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  environment: "production",
  ownerUserId: null,
  hostLabel: null,
  identityKey: "support-agent@production",
  lastSeenAt: new Date(),
  type: "connected",
  config: {
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    parameters: [{ name: "model", defaultValue: "gpt-5-mini" }],
  },
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

function fakeAgents(overrides: Partial<AgentService> = {}): AgentService {
  return {
    getAll: vi.fn(),
    getById: vi.fn(),
    ownersOf: vi.fn().mockResolvedValue(new Map()),
    ...overrides,
  } as unknown as AgentService;
}

describe("AgentApp connected views", () => {
  describe("given a process that composed the connected-agent runtime", () => {
    it("carries the agent's declared parameters, owner and presence on getAll", async () => {
      const presence: AgentPresence = {
        status: "online",
        instances: [
          {
            instanceId: "inst_1",
            hostname: "host",
            username: "user",
            pid: 1,
            label: null,
            sdk: { name: "langwatch", version: "1.0.0", language: "python" },
            connectedAt: new Date(),
            inflight: 0,
            maxConcurrency: 1,
          },
        ],
      };
      const app = AgentApp.create({
        agents: fakeAgents({
          getAll: vi.fn().mockResolvedValue([connectedAgent]),
          ownersOf: vi.fn().mockResolvedValue(new Map()),
        }),
        connected: {
          presence: vi.fn().mockResolvedValue(new Map([["agent_1", presence]])),
        },
      });

      const [agent] = await app.getAll({ projectId: "project_1" });

      expect(agent?.parameters).toEqual([{ name: "model", defaultValue: "gpt-5-mini" }]);
      expect(agent?.owner).toBeNull();
      expect(agent?.status).toBe("online");
      expect(agent?.instances).toHaveLength(1);
    });
  });

  describe("given a process that composed no connected-agent runtime", () => {
    it("reads every agent as offline with no instances on getById", async () => {
      const app = AgentApp.create({
        agents: fakeAgents({
          getById: vi.fn().mockResolvedValue(connectedAgent),
          ownersOf: vi.fn().mockResolvedValue(new Map()),
        }),
      });

      const agent = await app.getById({ id: "agent_1", projectId: "project_1" });

      expect(agent.status).toBe(NO_PRESENCE.status);
      expect(agent.instances).toEqual(NO_PRESENCE.instances);
    });
  });
});
