/**
 * The single-file conversion step converts only what this selection returns, so it is pinned
 * against Postgres: legacy single-file datasets of the project, archived ones included, by id.
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

import { PrismaDatasetSingleFileConversionRepository } from "../prisma.dataset-single-file-conversion.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaDatasetSingleFileConversionRepository selection", () => {
  const namespace = `dataset-single-file-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const otherProjectId = `${namespace}-other`;
  const singleFile = `${namespace}-a-single-file`;
  const archivedSingleFile = `${namespace}-b-archived-single-file`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:single-file-selection"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaDatasetSingleFileConversionRepository.create({ database: prisma });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    for (const id of [projectId, otherProjectId]) {
      await prisma.project.create({
        data: {
          id,
          teamId,
          name: id,
          slug: id,
          apiKey: id,
          language: "typescript",
          framework: "test",
        },
      });
    }
    const datasets = [
      { id: singleFile, projectId, contentLayout: "postgres", useS3: true },
      {
        id: archivedSingleFile,
        projectId,
        contentLayout: "postgres",
        useS3: true,
        archivedAt: new Date(),
      },
      { id: `${namespace}-c-records`, projectId, contentLayout: "postgres", useS3: false },
      { id: `${namespace}-d-chunked`, projectId, contentLayout: "s3_jsonl", useS3: true },
      {
        id: `${namespace}-e-other-project`,
        projectId: otherProjectId,
        contentLayout: "postgres",
        useS3: true,
      },
    ];
    for (const dataset of datasets) {
      await prisma.dataset.create({
        data: { ...dataset, name: dataset.id, slug: dataset.id, columnTypes: [] },
      });
    }
  });

  afterAll(async () => {
    for (const id of [projectId, otherProjectId]) {
      await prisma.dataset.deleteMany({ where: { projectId: id } });
    }
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when a project holds datasets in every layout", () => {
    it("returns only its single-file datasets, archived ones included, in id order", async () => {
      const ids = await repository.findSingleFileDatasetIds({ projectId, limit: 10 });

      expect(ids).toEqual([singleFile, archivedSingleFile]);
    });
  });

  describe("when the selection is read a page at a time", () => {
    it("continues after the last id of the previous page and ends empty", async () => {
      const first = await repository.findSingleFileDatasetIds({ projectId, limit: 1 });
      const second = await repository.findSingleFileDatasetIds({
        projectId,
        afterId: first.at(-1),
        limit: 1,
      });
      const third = await repository.findSingleFileDatasetIds({
        projectId,
        afterId: second.at(-1),
        limit: 1,
      });

      expect([first, second, third]).toEqual([[singleFile], [archivedSingleFile], []]);
    });
  });
});
