/** @vitest-environment node */
/** @see specs/agents/connected-agents.feature */
import type { Agent, AgentApi, AgentOverview } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ConnectedTargetService } from "../connected-target.service.ts";

const PROJECT_ID = "project-1";
const ACTOR_ID = "user-1";

function connectedAgent(id: string, name: string): Agent {
  const now = new Date(0);
  return {
    id,
    projectId: PROJECT_ID,
    name,
    type: "connected",
    config: {
      parameters: [],
      sdk: { name: "langwatch", version: "1.0.0", language: "typescript" },
    },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: `${name}@production`,
    lastSeenAt: now,
  };
}

function overview(agent: Agent, status: "online" | "offline"): AgentOverview {
  return {
    ...agent,
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
    environment: agent.environment ?? null,
    ownerUserId: agent.ownerUserId ?? null,
    hostLabel: agent.hostLabel ?? null,
    lastSeenAt: agent.lastSeenAt ?? null,
    parameters: [],
    owner: null,
    status,
    instances: [],
    selectable: true,
    notSelectableReason: null,
  };
}

function serviceFor(agent: Agent, status: "online" | "offline") {
  const getById = vi.fn<AgentApi["getById"]>().mockResolvedValue(overview(agent, status));
  const getConnectedByNameAndEnvironment = vi
    .fn<AgentApi["getConnectedByNameAndEnvironment"]>()
    .mockResolvedValue([agent]);
  const agents = createApiFixture<AgentApi>({ getById, getConnectedByNameAndEnvironment });

  return {
    service: ConnectedTargetService.create(agents),
    getById,
    getConnectedByNameAndEnvironment,
  };
}

describe("ConnectedTargetService", () => {
  /** @scenario "A scenario run cannot target an offline connected agent" */
  it("refuses an offline connected target", async () => {
    const agent = connectedAgent("agent-offline", "offline-agent");
    const { service } = serviceFor(agent, "offline");

    await expect(
      service.resolve({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        target: { type: "connected", referenceId: agent.id },
      }),
    ).rejects.toMatchObject({
      code: "agent_offline",
      meta: { agentName: "offline-agent", environment: "production" },
    });
  });

  /** @scenario "A scenario run against an online connected agent resolves its target" */
  it("resolves a connected name and environment to its agent id", async () => {
    const agent = connectedAgent("agent-online", "online-agent");
    const { service, getById, getConnectedByNameAndEnvironment } = serviceFor(agent, "online");

    await expect(
      service.resolve({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        target: { type: "connected", referenceId: "online-agent@production" },
      }),
    ).resolves.toEqual({ type: "connected", referenceId: agent.id });
    expect(getConnectedByNameAndEnvironment).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      name: "online-agent",
      environment: "production",
    });
    expect(getById).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      id: agent.id,
      viewerUserId: ACTOR_ID,
    });
  });

  /** @scenario "A scenario run against an HTTP agent reads no presence" */
  it("does not consult agents for a non-connected target", async () => {
    const agent = connectedAgent("agent-unused", "unused-agent");
    const { service, getById, getConnectedByNameAndEnvironment } = serviceFor(agent, "online");
    const target = { type: "http" as const, referenceId: "agent-http" };

    await expect(service.resolve({ projectId: PROJECT_ID, target })).resolves.toBe(target);
    expect(getById).not.toHaveBeenCalled();
    expect(getConnectedByNameAndEnvironment).not.toHaveBeenCalled();
  });
});
