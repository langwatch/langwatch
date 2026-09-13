/**
 * @vitest-environment node
 *
 * The target of a single scenario run, resolved against a real database and
 * the presence registry: a connected agent no process is holding is refused
 * before the run is scheduled, one a process holds resolves to its id, and
 * an HTTP agent reads no presence at all.
 *
 * @see specs/agents/connected-agents.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import { AgentService } from "~/server/agents/agent.service";
import type { InstanceMeta } from "~/server/connected-agents/instance.registry";
import {
  type PresenceReads,
  runtimePresence,
} from "~/server/connected-agents/presence.read";
import { getConnectedAgentRuntime } from "~/server/connected-agents/runtime";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "~/utils/testUtils";
import { resolveConnectedTarget } from "../connected-target.service";

const projectId = `test-connected-target-${nanoid(8)}`;

const agentService = AgentService.create(prisma);

const config: ConnectedComponentConfig = {
  parameters: [],
  sdk: { name: "langwatch", version: "1.0.0", language: "python" },
};

let actor: { id: string; label: "user" };

async function registerAgent(name: string) {
  return agentService.registerConnected({
    id: `agent_${nanoid()}`,
    projectId,
    name,
    config,
    identity: {
      environment: "production",
      ownerUserId: null,
      hostLabel: null,
      identityKey: `${name}@production`,
    },
  });
}

/** Holds the agent from one live instance, the way a running SDK process does. */
async function connectInstance(agentId: string): Promise<void> {
  const meta: InstanceMeta = {
    instanceId: `inst_${nanoid(8)}`,
    projectId,
    hostname: "dev-box",
    username: "dev",
    pid: 1,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    label: null,
    podId: "pod_test",
    connectedAt: Date.now(),
    maxConcurrency: 1,
  };
  await getConnectedAgentRuntime().registry.register({
    meta,
    agentIds: [agentId],
  });
}

beforeAll(async () => {
  const user = await getTestUser();
  actor = { id: user.id, label: "user" };
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["agent", { projectId }],
    ["project", { id: projectId }],
  ]);
});

describe("resolveConnectedTarget", () => {
  describe("when no process is holding the connected agent", () => {
    /** @scenario "A scenario run cannot target an offline connected agent" */
    it("refuses the run with agent_offline", async () => {
      const agent = await registerAgent("offline-agent");

      await expect(
        resolveConnectedTarget({
          prisma,
          projectId,
          target: { type: "connected", referenceId: agent.id },
          actor,
          presence: runtimePresence,
        }),
      ).rejects.toMatchObject({
        code: "agent_offline",
        meta: { agentName: "offline-agent", environment: "production" },
      });
    });
  });

  describe("when a process is holding the connected agent", () => {
    /** @scenario "A scenario run against an online connected agent resolves its target" */
    it("answers with the agent's id", async () => {
      const agent = await registerAgent("online-agent");
      await connectInstance(agent.id);

      const resolved = await resolveConnectedTarget({
        prisma,
        projectId,
        target: { type: "connected", referenceId: "online-agent@production" },
        actor,
        presence: runtimePresence,
      });

      expect(resolved.target).toEqual({
        type: "connected",
        referenceId: agent.id,
      });
    });
  });

  describe("when the target is an HTTP agent", () => {
    /** @scenario "A scenario run against an HTTP agent reads no presence" */
    it("answers the target as written without reading presence", async () => {
      const presence: PresenceReads = {
        listLive: async () => {
          throw new Error("presence must not be read for an HTTP agent");
        },
      };

      const resolved = await resolveConnectedTarget({
        prisma,
        projectId,
        target: { type: "http", referenceId: "agent_http" },
        actor,
        presence,
      });

      expect(resolved).toEqual({
        target: { type: "http", referenceId: "agent_http" },
        targetDefinitions: [],
      });
    });
  });
});
