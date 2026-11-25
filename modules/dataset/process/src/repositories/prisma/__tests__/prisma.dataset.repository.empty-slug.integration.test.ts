/**
 * A dataset an old release stored with an empty slug gets a free one over Postgres: the unique
 * slug index refuses a taken slug, and the dataset reads again once it has one.
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatasetEmptySlugService } from "../../../services/dataset-empty-slug.service.ts";
import { PrismaDatasetRepository } from "../prisma.dataset.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaDatasetRepository empty slugs", () => {
  const namespace = `dataset-empty-slug-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const takenId = `${namespace}-taken`;
  const emptyId = `${namespace}-empty`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:empty-slug"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaDatasetRepository.create({ prisma });
  const service = DatasetEmptySlugService.create({
    datasets: repository,
    projects: { listAllIds: async () => ({ ids: [projectId], next: null }) },
  });
  const run = () =>
    service.runStep({
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun: false,
      signal: new AbortController().signal,
      log: { info: () => undefined, warn: () => undefined },
    });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        teamId,
        name: projectId,
        slug: projectId,
        apiKey: projectId,
        language: "typescript",
        framework: "test",
      },
    });
    await prisma.dataset.create({
      data: {
        id: takenId,
        projectId,
        name: "Support questions",
        slug: "support-questions",
        columnTypes: [],
      },
    });
    await prisma.dataset.create({
      data: { id: emptyId, projectId, name: "Support questions", slug: "", columnTypes: [] },
    });
  });

  afterAll(async () => {
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when a project holds a dataset with an empty slug and one with its name's slug", () => {
    /** @scenario "Postgres gives a dataset with an empty slug a free slug once" */
    it("refuses the empty-slug read, then fills the next numbered slug and reads it", async () => {
      await expect(repository.findById({ id: emptyId, projectId })).rejects.toThrow(/slug/);
      await expect(
        repository.fillEmptySlug({ id: emptyId, projectId, slug: "support-questions" }),
      ).resolves.toBe("taken");

      await expect(run()).resolves.toMatchObject({ filled: 1, failed: 0 });

      await expect(repository.findById({ id: emptyId, projectId })).resolves.toMatchObject({
        slug: "support-questions-2",
        name: "Support questions",
      });
      await expect(
        repository.findBySlug({ projectId, slug: "support-questions-2" }),
      ).resolves.toMatchObject({ id: emptyId });
      await expect(repository.findById({ id: takenId, projectId })).resolves.toMatchObject({
        slug: "support-questions",
      });
    });

    /** @scenario "Postgres gives a dataset with an empty slug a free slug once" */
    it("finds nothing to fill on a second run", async () => {
      await expect(repository.findEmptySlugPage({ projectId, limit: 10 })).resolves.toEqual([]);
      await expect(run()).resolves.toMatchObject({ filled: 0, failed: 0 });
      await expect(
        repository.fillEmptySlug({ id: emptyId, projectId, slug: "anything" }),
      ).resolves.toBe("not-empty");
    });
  });
});
