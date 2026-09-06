/**
 * A connected agent is a running process that registered itself: a copy would
 * carry no process and no identity, so it would be a row nothing connects to.
 * @see specs/agents/connected-agents.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAgentAdapter } from "../../adapters/postgres.agent.adapter";

/** This suite writes and reads its own rows, so it composes no tenant guard. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const DB_URL = process.env.DATABASE_URL;
const suffix = nanoid(8);
const ORGANIZATION_ID = `org_connected_copy_${suffix}`;
const TEAM_ID = `team_connected_copy_${suffix}`;
const PROJECT_ID = `proj_connected_copy_${suffix}`;

const connection = DB_URL
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }),
    )
  : null;

const database = (): PrismaClient => {
  if (!connection) throw new Error("DATABASE_URL is required for the connected-copy suite");

  return connection.client;
};

const agents = () => PostgresAgentAdapter.create({ database: database() }).build();

describe.skipIf(!DB_URL)("copying a connected agent", () => {
  beforeAll(async () => {
    const db = database();
    await db.organization.create({
      data: { id: ORGANIZATION_ID, name: ORGANIZATION_ID, slug: ORGANIZATION_ID },
    });
    await db.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: TEAM_ID, organizationId: ORGANIZATION_ID },
    });
    await db.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "other",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
  });

  afterAll(async () => {
    try {
      const db = database();
      await db.agent.deleteMany({ where: { projectId: PROJECT_ID } });
      await db.project.deleteMany({ where: { id: PROJECT_ID } });
      await db.team.deleteMany({ where: { id: TEAM_ID } });
      await db.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given an agent that registered itself over the SDK", () => {
    describe("when a copy of it is asked for", () => {
      /** @scenario "A connected agent cannot be copied" */
      it("refuses the copy, and writes no row", async () => {
        const service = agents();
        const registered = await service.registerConnected({
          id: `agent_${nanoid(8)}`,
          projectId: PROJECT_ID,
          name: "copied-agent",
          config: {
            parameters: [],
            sdk: { name: "langwatch", version: "1.0.0", language: "python" },
          },
          identity: {
            environment: "production",
            ownerUserId: null,
            hostLabel: null,
            identityKey: `copied-agent@production-${nanoid(4)}`,
          },
        });

        await expect(
          service.copy({
            sourceAgentId: registered.id,
            sourceProjectId: PROJECT_ID,
            targetProjectId: PROJECT_ID,
            actorUserId: `user_${suffix}`,
            newAgentId: `agent_${nanoid(8)}`,
          }),
        ).rejects.toMatchObject({ code: "agent_register_only" });

        const copies = await database().agent.findMany({
          where: { projectId: PROJECT_ID, copiedFromAgentId: registered.id },
        });
        expect(copies).toHaveLength(0);
      });
    });
  });
});
