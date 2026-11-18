/**
 * The move's fingerprint is one aggregate Postgres computes over the dataset's
 * rows, so it notices a quiet edit without the process reading a row.
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

import { PrismaDatasetMigrationRepository } from "../prisma.dataset-migration.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaDatasetMigrationRepository fingerprint", () => {
  const namespace = `dataset-fingerprint-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const otherProjectId = `${namespace}-other`;
  const datasetId = `${namespace}-dataset`;
  const emptyId = `${namespace}-empty`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:fingerprint"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaDatasetMigrationRepository.create({ database: prisma });
  const key = { datasetId, projectId };

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
    for (const id of [datasetId, emptyId]) {
      await prisma.dataset.create({
        data: { id, projectId, name: id, slug: id, columnTypes: [] },
      });
    }
    for (const [id, updatedAt] of [
      [`${namespace}-a`, new Date(1_000)],
      [`${namespace}-b`, new Date(9_000)],
    ] as const) {
      await prisma.datasetRecord.create({
        data: { id, datasetId, projectId, entry: { id }, updatedAt },
      });
    }
  });

  afterAll(async () => {
    for (const id of [projectId, otherProjectId]) {
      await prisma.datasetRecord.deleteMany({ where: { projectId: id } });
    }
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when nothing changes between two reads", () => {
    it("returns the same count, newest time and digest", async () => {
      const first = await repository.getFingerprint(key);
      const second = await repository.getFingerprint(key);

      expect(first.count).toBe(2);
      expect(first.maxUpdatedAt?.epochMilliseconds).toBe(9_000);
      expect(second).toEqual(first);
    });
  });

  describe("when a record is edited without moving the count or the newest time", () => {
    it("changes the digest", async () => {
      const before = await repository.getFingerprint(key);
      await prisma.datasetRecord.update({
        where: { id: `${namespace}-a`, projectId },
        data: { updatedAt: new Date(5_000) },
      });

      const after = await repository.getFingerprint(key);

      expect(after.count).toBe(before.count);
      expect(after.maxUpdatedAt?.epochMilliseconds).toBe(before.maxUpdatedAt?.epochMilliseconds);
      expect(after.digest).not.toBe(before.digest);
    });
  });

  describe("when a row of the dataset is filed under another project", () => {
    it("leaves it out of the fingerprint", async () => {
      const before = await repository.getFingerprint(key);
      await prisma.datasetRecord.create({
        data: { datasetId, projectId: otherProjectId, entry: {}, updatedAt: new Date(20_000) },
      });

      await expect(repository.getFingerprint(key)).resolves.toEqual(before);
    });
  });

  describe("when the move commits", () => {
    const metadata = { rowCount: 2, sizeBytes: 10, chunkCount: 1, chunkOffsets: [] };

    it("refuses a stale baseline and flips on a current one, rechecking under the lock", async () => {
      const current = await repository.getFingerprint(key);
      const stale = { ...current, digest: `${current.digest}1` };

      await expect(repository.commit({ ...key, baseline: stale, metadata })).resolves.toBe(
        "skipped-concurrent-write",
      );
      await expect(repository.commit({ ...key, baseline: current, metadata })).resolves.toBe(
        "migrated",
      );
      await expect(repository.isPostgresLayout(key)).resolves.toBe(false);
    });
  });

  describe("when the dataset has no rows", () => {
    it("returns an empty fingerprint", async () => {
      const empty = await repository.getFingerprint({ datasetId: emptyId, projectId });

      expect(empty).toEqual({ count: 0, maxUpdatedAt: null, digest: "0" });
    });
  });
});
