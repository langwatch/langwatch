/**
 * @vitest-environment node
 * The pinned-trace contract, stated once and run against both backends: the
 * memory twin always, and the Postgres one when a test database is named at
 * `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 * @see specs/data-retention-service.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryPinnedTraceRepository } from "../memory/memory.pinned-trace.repository.ts";
import type { PinnedTraceRepository } from "../pinned-trace.repository.ts";
import { PrismaPinnedTraceRepository } from "../prisma/prisma.pinned-trace.repository.ts";

/**
 * One backend under test. A pin names a project and, when a person made it, a
 * user — both foreign keys, so Postgres needs real rows behind them and the
 * backend supplies their ids.
 */
type Backend = Readonly<{
  repository: () => PinnedTraceRepository;
  projectId: () => string;
  otherProjectId: () => string;
  userId: () => string;
}>;

const TRACE = "trace_1";

function contractCases(backend: Backend): void {
  describe("when the trace is not pinned", () => {
    /** @scenario "The memory and Postgres data retention repositories answer alike" */
    it("answers absence with null rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(
        repository.findByProjectAndTrace({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBeNull();
    });

    it("answers no pins and no trace ids for the project", async () => {
      const repository = backend.repository();

      await expect(
        repository.findAllByProject({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        repository.findAllTraceIds({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
    });

    it("reports no manual pin", async () => {
      const repository = backend.repository();

      await expect(
        repository.hasManualPin({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBe(false);
    });

    it("deletes a pin nobody wrote without complaint", async () => {
      const repository = backend.repository();

      await expect(
        repository.delete({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a person pins the trace", () => {
    it("reads the pin back with the reason they typed", async () => {
      const repository = backend.repository();

      const pin = await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        userId: backend.userId(),
        reason: "the customer asked us to keep it",
        source: "manual",
      });

      expect(pin).toMatchObject({
        projectId: backend.projectId(),
        traceId: TRACE,
        userId: backend.userId(),
        source: "manual",
        reason: "the customer asked us to keep it",
      });
      await expect(
        repository.findByProjectAndTrace({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toEqual(pin);
      await expect(
        repository.findAllTraceIds({ projectId: backend.projectId() }),
      ).resolves.toEqual([TRACE]);
      await expect(
        repository.hasManualPin({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBe(true);
    });

    it("removes the pin when it is deleted", async () => {
      const repository = backend.repository();

      await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        source: "manual",
      });
      await repository.delete({ projectId: backend.projectId(), traceId: TRACE });

      await expect(
        repository.findByProjectAndTrace({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBeNull();
    });
  });

  describe("when a share pins a trace a person already pinned", () => {
    it("leaves the reason the person typed alone", async () => {
      const repository = backend.repository();

      const manual = await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        userId: backend.userId(),
        reason: "the customer asked us to keep it",
        source: "manual",
      });
      const automatic = await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        source: "share",
      });

      expect(automatic).toEqual(manual);
      await expect(
        repository.hasManualPin({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBe(true);
    });

    it("records the share's own pin when nobody pinned it by hand", async () => {
      const repository = backend.repository();

      const pin = await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        source: "share",
      });

      expect(pin).toMatchObject({ source: "share", userId: null, reason: null });
      await expect(
        repository.hasManualPin({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBe(false);
    });

    it("lets a later manual pin take the row over", async () => {
      const repository = backend.repository();

      await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        source: "share",
      });
      await repository.create({
        projectId: backend.projectId(),
        traceId: TRACE,
        userId: backend.userId(),
        reason: "keep",
        source: "manual",
      });

      await expect(
        repository.findByProjectAndTrace({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toMatchObject({ source: "manual", userId: backend.userId(), reason: "keep" });
    });
  });

  describe("when another project pinned a trace of the same id", () => {
    it("never answers with the other project's pin", async () => {
      const repository = backend.repository();

      await repository.create({
        projectId: backend.otherProjectId(),
        traceId: TRACE,
        source: "manual",
      });

      await expect(
        repository.findByProjectAndTrace({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBeNull();
      await expect(
        repository.findAllByProject({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        repository.findAllTraceIds({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        repository.hasManualPin({ projectId: backend.projectId(), traceId: TRACE }),
      ).resolves.toBe(false);
    });

    it("never deletes the other project's pin", async () => {
      const repository = backend.repository();

      await repository.create({
        projectId: backend.otherProjectId(),
        traceId: TRACE,
        source: "manual",
      });
      await repository.delete({ projectId: backend.projectId(), traceId: TRACE });

      await expect(
        repository.findAllByProject({ projectId: backend.otherProjectId() }),
      ).resolves.toHaveLength(1);
    });
  });
}

describe("given the memory pinned trace repository", () => {
  let repository: PinnedTraceRepository;

  beforeEach(() => {
    repository = MemoryPinnedTraceRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project_1",
    otherProjectId: () => "project_2",
    userId: () => "user_olive",
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres pinned trace repository", () => {
  const namespace = `pinned-trace-contract-${randomUUID()}`;
  let projectId = "";
  let otherProjectId = "";
  let userId = "";

  const clean = () =>
    cleanupTestRows(database(), [
      ["pinnedTrace", { projectId: { in: [projectId, otherProjectId] } }],
    ]);

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId: organization.id },
    });
    const project = (slug: string) =>
      database().project.create({
        data: {
          name: slug,
          slug,
          apiKey: slug,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
        select: { id: true },
      });
    projectId = (await project(`${namespace}-a`)).id;
    otherProjectId = (await project(`${namespace}-b`)).id;
    userId = (
      await database().user.create({
        data: { name: namespace, email: `${namespace}@example.com` },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await cleanupTestRows(database(), [
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["user", { id: userId }],
      ["team", { slug: namespace }],
      ["organization", { slug: namespace }],
    ]);
  });

  contractCases({
    repository: () => PrismaPinnedTraceRepository.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
    userId: () => userId,
  });
});
