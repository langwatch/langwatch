/**
 * @vitest-environment node
 * The page both project data steps read carries archived projects too, with their owner and
 * first message, which the history listing sends.
 * Spec: modules/project/specs/project-history-listing.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaProjectRepository } from "../prisma.project.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaProjectRepository history page over Postgres", () => {
  // A prefix of our own, so a page read after it starts at this test's rows and no other's.
  const ns = `history-page-${nanoid(8).toLowerCase()}`;
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaProjectRepository.create({ prisma });
  const ids = { organization: "", team: "" };
  const projectIds = {
    personal: `${ns}-a-personal`,
    archivedPersonal: `${ns}-b-archived-personal`,
    archivedFlagged: `${ns}-c-archived-flagged`,
    shared: `${ns}-d-shared`,
  };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Org ${ns}`, slug: `org-${ns}` },
    });
    ids.organization = organization.id;
    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `team-${ns}`, organizationId: organization.id },
    });
    ids.team = team.id;
    const base = { teamId: team.id, language: "python", framework: "openai" };
    const archivedAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = [
      { id: projectIds.personal, isPersonal: true, ownerUserId: `${ns}-owner-1` },
      {
        id: projectIds.archivedPersonal,
        isPersonal: true,
        ownerUserId: `${ns}-owner-2`,
        archivedAt,
      },
      { id: projectIds.archivedFlagged, firstMessage: true, archivedAt },
      { id: projectIds.shared },
    ];
    for (const row of rows) {
      await prisma.project.create({
        data: { ...base, ...row, name: row.id, slug: row.id, apiKey: `key-${row.id}` },
      });
    }
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: Object.values(projectIds) } } });
    await prisma.team.deleteMany({ where: { id: ids.team } });
    await prisma.organization.deleteMany({ where: { id: ids.organization } });
    await prisma.$disconnect();
  });

  describe("when the listing reads a page", () => {
    /**
     * @scenario "The project history listing sends each personal project's owner"
     * @scenario "The project history listing sends each project that received its first message"
     */
    it("returns archived personal and archived flagged projects with their owner and first message", async () => {
      const page = await repository.findBackfillPage({ afterId: `${ns}-`, limit: 4 });

      expect(
        page.map((entry) =>
          entry.kind === "whole"
            ? {
                kind: entry.kind,
                project: {
                  id: entry.project.id,
                  organizationId: entry.project.organizationId,
                  isPersonal: entry.project.isPersonal,
                  ownerUserId: entry.project.ownerUserId,
                  firstMessage: entry.project.firstMessage,
                },
              }
            : entry,
        ),
      ).toEqual([
        {
          kind: "whole",
          project: {
            id: projectIds.personal,
            organizationId: ids.organization,
            isPersonal: true,
            ownerUserId: `${ns}-owner-1`,
            firstMessage: false,
          },
        },
        {
          kind: "whole",
          project: {
            id: projectIds.archivedPersonal,
            organizationId: ids.organization,
            isPersonal: true,
            ownerUserId: `${ns}-owner-2`,
            firstMessage: false,
          },
        },
        {
          kind: "whole",
          project: {
            id: projectIds.archivedFlagged,
            organizationId: ids.organization,
            isPersonal: false,
            ownerUserId: null,
            firstMessage: true,
          },
        },
        {
          kind: "whole",
          project: {
            id: projectIds.shared,
            organizationId: ids.organization,
            isPersonal: false,
            ownerUserId: null,
            firstMessage: false,
          },
        },
      ]);
    });
  });
});
