/**
 * @vitest-environment node
 * @see specs/datasets/large-dataset-storage.feature
 * A claim parked on another finalize's row lock re-checks the committed status and loses.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDatasetContentRepository } from "../prisma.dataset-content.repository.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaDatasetContentRepository.claimForProcessing", () => {
  const ns = `dataset-claim-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:claim-for-processing"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const datasets = PrismaDatasetContentRepository.create({ prisma });
  const projectId = `proj_${ns}`;
  let datasetId: string;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: `org_${ns}`, name: ns, slug: `org-${ns}` } });
    await prisma.team.create({
      data: { id: `team_${ns}`, name: ns, slug: `team-${ns}`, organizationId: `org_${ns}` },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: ns,
        slug: ns,
        teamId: `team_${ns}`,
        language: "typescript",
        framework: "other",
        apiKey: `key-${ns}`,
      },
    });
    const dataset = await prisma.dataset.create({
      data: {
        id: `dataset_${ns}`,
        name: ns,
        slug: ns,
        projectId,
        columnTypes: [],
        status: "uploading",
      },
    });
    datasetId = dataset.id;
  });

  afterAll(async () => {
    await prisma.dataset.deleteMany({ where: { id: datasetId, projectId } });
    await prisma.project.delete({ where: { id: projectId } });
    await prisma.team.delete({ where: { id: `team_${ns}` } });
    await prisma.organization.delete({ where: { id: `org_${ns}` } });
    await prisma.$disconnect();
  });

  describe("given an uploading row two finalize calls claim at the same moment", () => {
    /** @scenario "Two finalize calls for one upload start one preparation" */
    it("admits the first claim and refuses the second, which waited on the row", async () => {
      const claims = await raceOnOneRow({
        prisma,
        table: "Dataset",
        first: (tx) => tx.$executeRaw`
          UPDATE "Dataset"
             SET "status" = 'processing', "updatedAt" = now()
           WHERE "id" = ${datasetId}
             AND "projectId" = ${projectId}
             AND "status" = 'uploading'
             AND "archivedAt" IS NULL
        `,
        second: () => datasets.claimForProcessing({ id: datasetId, projectId }),
      });

      expect(claims).toEqual({ first: 1, second: 0 });
      const row = await prisma.dataset.findFirstOrThrow({ where: { id: datasetId, projectId } });
      expect(row.status).toBe("processing");
    });
  });
});
