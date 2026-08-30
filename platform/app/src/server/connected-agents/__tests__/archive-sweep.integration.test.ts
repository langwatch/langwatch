/**
 * @vitest-environment node
 *
 * The daily sweep over connected agents, against a real database.
 *
 * @see specs/agents/connected-agents.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "~/utils/testUtils";
import { archiveUnseenConnectedAgents } from "../presence.projection";

const projectId = `test-archive-sweep-${nanoid(8)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

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

async function connectedAgent(name: string, lastSeenAt: Date) {
  return prisma.agent.create({
    data: {
      id: `agent_${nanoid()}`,
      projectId,
      name,
      type: "connected",
      config: {
        parameters: [],
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
      },
      environment: "production",
      identityKey: `${name}@production`,
      lastSeenAt,
    },
  });
}

describe("archiveUnseenConnectedAgents", () => {
  describe("when one agent was seen thirty one days ago and one yesterday", () => {
    /** @scenario "The daily sweep archives connected agents unseen for thirty days" */
    it("archives the first and keeps the second", async () => {
      const now = new Date();
      const stale = await connectedAgent(
        "stale-agent",
        new Date(now.getTime() - 31 * DAY_MS),
      );
      const fresh = await connectedAgent(
        "fresh-agent",
        new Date(now.getTime() - DAY_MS),
      );
      const http = await prisma.agent.create({
        data: {
          id: `agent_${nanoid()}`,
          projectId,
          name: "http-agent",
          type: "http",
          config: { url: "https://example.com", method: "POST" },
          lastSeenAt: new Date(now.getTime() - 40 * DAY_MS),
        },
      });

      const count = await archiveUnseenConnectedAgents({ prisma, now });

      expect(count).toBeGreaterThanOrEqual(1);
      const rows = await prisma.agent.findMany({
        where: { projectId, id: { in: [stale.id, fresh.id, http.id] } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(stale.id)?.archivedAt).not.toBeNull();
      expect(byId.get(fresh.id)?.archivedAt).toBeNull();
      // Only connected agents are swept; another kind never has presence.
      expect(byId.get(http.id)?.archivedAt).toBeNull();
    });
  });
});
