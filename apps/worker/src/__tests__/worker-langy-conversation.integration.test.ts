import { LangyApi } from "@langwatch/langy-contract";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * The worker folds langy's conversation pipeline again: a created conversation is readable through
 * its projection. The worker booted wholly live over the test Postgres, Redis and ClickHouse (§7);
 * the conversation goes in and comes back through LangyApi.
 * @vitest-environment node
 * @see modules/langy/specs/langy.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootLiveWorker, liveStoresConfigured, type LiveWorker } from "./worker-live.fixture.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** Its own Redis database keeps this worker's jobs from every other test process. */
const REDIS_DB_INDEX = "11";

describe.skipIf(!DB_URL || !liveStoresConfigured)("given the worker with live eventing", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const ns = `langy-r53-${Date.now()}`;
  let projectId = "";
  const conversationId = `langyconv_r53_${Date.now()}`;
  let worker: LiveWorker;

  beforeAll(async () => {
    // ClickHouse routes a tenant by its organisation, so the project is a real row.
    const organization = await prisma.organization.create({
      data: { name: "Langy Fold Org", slug: `--test-org-${ns}` },
    });
    const team = await prisma.team.create({
      data: { name: "Langy Fold Team", slug: `--test-team-${ns}`, organizationId: organization.id },
    });
    const project = await prisma.project.create({
      data: {
        name: "Langy Fold Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;
    worker = await bootLiveWorker({ environment: { REDIS_DB_INDEX } });
  });

  afterAll(async () => {
    await worker?.close();
    await prisma.langyConversationProjection.deleteMany({
      where: { projectId, ConversationId: conversationId },
    });
    const organizations = await prisma.organization.findMany({
      where: { slug: `--test-org-${ns}` },
      select: { id: true },
    });
    const organizationIds = organizations.map((organization) => organization.id);
    await prisma.project.deleteMany({
      where: { team: { organizationId: { in: organizationIds } } },
    });
    await prisma.team.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  describe("when langy's conversation pipeline is sent a created conversation", () => {
    /** @scenario "The worker folds a created langy conversation into its projection" */
    it("folds it, so the conversation is readable through the projection", async () => {
      const langy = worker.application.service(LangyApi);
      await langy.recordUserMessage({
        projectId,
        conversationId,
        userId: "user_r53",
        parts: [{ type: "text", text: "Hello from the worker suite" }],
        title: "Folded by the worker",
      });

      await expect
        .poll(() => langy.getById({ id: conversationId, projectId, userId: "user_r53" }), {
          timeout: 60_000,
        })
        .toMatchObject({ id: conversationId, title: "Folded by the worker" });
    });
  });
});
