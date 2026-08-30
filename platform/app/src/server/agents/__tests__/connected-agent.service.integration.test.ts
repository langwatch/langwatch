/**
 * @vitest-environment node
 *
 * Connected agent rows through the service, against a real database: one row
 * per identity, re-registered in place, restored on a reconnect.
 *
 * @see specs/agents/connected-agents.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "~/utils/testUtils";
import {
  AgentRepository,
  type ConnectedAgentIdentity,
} from "../agent.repository";
import { AgentService } from "../agent.service";

const projectId = `test-connected-agent-${nanoid(8)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

const service = AgentService.create(prisma);

const config: ConnectedComponentConfig = {
  description: "Answers support questions",
  parameters: [],
  sdk: { name: "langwatch", version: "1.0.0", language: "python" },
};

const identity: ConnectedAgentIdentity = {
  environment: "production",
  ownerUserId: null,
  hostLabel: null,
  identityKey: "support-agent@production",
};

beforeAll(async () => {
  await getTestUser();
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

describe("connected agent rows", () => {
  describe("when another instance wrote the row between the read and the create", () => {
    /** @scenario "Two instances registering together settle on one row" */
    it("answers with the row that landed instead of a constraint error", async () => {
      const raceIdentity: ConnectedAgentIdentity = {
        ...identity,
        identityKey: `race-agent@production-${nanoid()}`,
      };

      const winner = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "race-agent",
        config,
        identity: raceIdentity,
      });

      // The losing instance read before the winner wrote, so its lookup finds
      // nothing and it goes on to create a row that the unique index refuses.
      const repository = new AgentRepository(prisma);
      const realLookup = repository.findByIdentityKey.bind(repository);
      let isFirstLookup = true;
      repository.findByIdentityKey = async (params) => {
        if (isFirstLookup) {
          isFirstLookup = false;
          return null;
        }
        return realLookup(params);
      };
      const racing = new AgentService(prisma, repository);

      const loser = await racing.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "race-agent",
        config,
        identity: raceIdentity,
      });

      expect(loser.id).toBe(winner.id);
      const rows = await prisma.agent.findMany({
        where: { projectId, identityKey: raceIdentity.identityKey },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("when the same identity registers twice", () => {
    /** @scenario "A second register of the same identity updates the same row" */
    it("updates the same row instead of creating a second one", async () => {
      const first = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "support-agent",
        config,
        identity,
      });
      const second = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "support-agent",
        config: { ...config, description: "Answers billing questions" },
        identity,
      });

      expect(second.id).toBe(first.id);
      expect((second.config as ConnectedComponentConfig).description).toBe(
        "Answers billing questions",
      );
      const rows = await prisma.agent.findMany({
        where: { projectId, identityKey: identity.identityKey },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("when an identity unseen for thirty one days registers again", () => {
    /** @scenario "A reconnect of an unseen identity lists the row again" */
    it("lists the same row again", async () => {
      const unseenIdentity = {
        ...identity,
        identityKey: `billing-agent@staging-${nanoid(4)}`,
        environment: "staging",
      };
      const created = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "billing-agent",
        config,
        identity: unseenIdentity,
      });
      await prisma.agent.update({
        where: { id: created.id, projectId },
        data: { lastSeenAt: new Date(Date.now() - 31 * DAY_MS) },
      });
      const whileUnseen = await service.getAll({ projectId });
      expect(whileUnseen.map((agent) => agent.id)).not.toContain(created.id);

      const registered = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "billing-agent",
        config,
        identity: unseenIdentity,
      });

      expect(registered.id).toBe(created.id);
      const listed = await service.getAll({ projectId });
      expect(listed.map((agent) => agent.id)).toContain(created.id);
    });
  });

  describe("when an identity archived by hand registers again", () => {
    /** @scenario "A reconnect of an archived identity restores the row" */
    it("restores the same row", async () => {
      const archivedIdentity = {
        ...identity,
        identityKey: `archived-agent@staging-${nanoid(4)}`,
        environment: "staging",
      };
      const created = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "archived-agent",
        config,
        identity: archivedIdentity,
      });
      await service.archiveAgent({ id: created.id, projectId });

      const restored = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "archived-agent",
        config,
        identity: archivedIdentity,
      });

      expect(restored.id).toBe(created.id);
      expect(restored.archivedAt).toBeNull();
      const listed = await service.getAll({ projectId });
      expect(listed.map((agent) => agent.id)).toContain(created.id);
    });
  });

  describe("when one agent was seen thirty one days ago and one yesterday", () => {
    /** @scenario "A connected agent unseen for thirty days is not listed" */
    it("lists only the agent seen yesterday", async () => {
      const unseen = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: `unseen-agent-${nanoid(4)}`,
        config,
        identity: { ...identity, identityKey: `unseen-agent-${nanoid(6)}` },
      });
      const recent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: `recent-agent-${nanoid(4)}`,
        config,
        identity: { ...identity, identityKey: `recent-agent-${nanoid(6)}` },
      });
      await prisma.agent.update({
        where: { id: unseen.id, projectId },
        data: { lastSeenAt: new Date(Date.now() - 31 * DAY_MS) },
      });
      await prisma.agent.update({
        where: { id: recent.id, projectId },
        data: { lastSeenAt: new Date(Date.now() - DAY_MS) },
      });

      const ids = (await service.getAll({ projectId })).map(
        (agent) => agent.id,
      );

      expect(ids).not.toContain(unseen.id);
      expect(ids).toContain(recent.id);
    });
  });

  describe("when an archived connected agent is edited by hand", () => {
    /** @scenario "An archived connected agent is still registered from code" */
    it("refuses the rename the way it refuses one on an active row", async () => {
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "archived-edit-agent",
        config,
        identity: {
          ...identity,
          identityKey: `archived-edit-agent@production-${nanoid(4)}`,
        },
      });
      await service.archiveAgent({ id: agent.id, projectId });

      await expect(
        service.update({
          id: agent.id,
          projectId,
          data: { name: "renamed" },
        }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
      const row = await prisma.agent.findFirst({
        where: { id: agent.id, projectId },
      });
      expect(row?.name).toBe("archived-edit-agent");
    });
  });

  describe("when a connected agent is copied", () => {
    /** @scenario "A connected agent cannot be copied" */
    it("refuses the copy, which would carry no identity", async () => {
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "copied-agent",
        config,
        identity: {
          ...identity,
          identityKey: `copied-agent@production-${nanoid(4)}`,
        },
      });

      await expect(
        service.copyAgent(
          {
            sourceAgentId: agent.id,
            sourceProjectId: projectId,
            targetProjectId: projectId,
            newAgentId: `agent_${nanoid()}`,
          },
          {
            copyWorkflow: () => {
              throw new Error("a connected agent has no workflow to copy");
            },
          },
        ),
      ).rejects.toMatchObject({ code: "agent_register_only" });
      const rows = await prisma.agent.findMany({
        where: { projectId, copiedFromAgentId: agent.id },
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe("when a connected agent is edited by hand", () => {
    it("accepts a description edit and refuses the rest", async () => {
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "edited-agent",
        config,
        identity: { ...identity, identityKey: `edited-agent@production` },
      });

      const edited = await service.update({
        id: agent.id,
        projectId,
        data: { config: { description: "Edited by hand" } as never },
      });
      expect((edited.config as ConnectedComponentConfig).description).toBe(
        "Edited by hand",
      );
      expect((edited.config as ConnectedComponentConfig).sdk).toEqual(
        config.sdk,
      );

      await expect(
        service.update({
          id: agent.id,
          projectId,
          data: { name: "renamed" },
        }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
      await expect(
        service.create({
          id: `agent_${nanoid()}`,
          projectId,
          name: "by-hand",
          type: "connected",
          config,
        }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
    });
  });
});
