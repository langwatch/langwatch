/**
 * @vitest-environment node
 *
 * The dataset repository contract, stated once and run against both backends:
 * the memory twin always, and the Postgres one when a test database is named
 * at `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 *
 * The rows are keyed by project, so the isolation case here is the project: a
 * dataset another project wrote is never answered with, and its entries are
 * never counted into this project's list.
 *
 * @see packages/features/dataset/specs/dataset-service.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryDatasetDatabase } from "../memory/memory.dataset.database.ts";
import { MemoryDatasetRecordRepository } from "../memory/memory.dataset-record.repository.ts";
import { MemoryDatasetRepository } from "../memory/memory.dataset.repository.ts";
import { PrismaDatasetRecordRepository } from "../prisma/prisma.dataset-record.repository.ts";
import { PrismaDatasetRepository } from "../prisma/prisma.dataset.repository.ts";
import type { DatasetRecordRepository } from "../dataset-record.repository.ts";
import type { DatasetRepository } from "../dataset.repository.ts";

/** One backend under test, plus the project ids its rows are written under. */
type Backend = Readonly<{
  datasets: () => DatasetRepository;
  records: () => DatasetRecordRepository;
  mine: () => string;
  theirs: () => string;
}>;

const columns = [{ name: "input", type: "string" as const }];

function contractCases(backend: Backend): void {
  const create = (name: string, projectId = backend.mine()) =>
    backend.datasets().create({ projectId, name, slug: name, columnTypes: columns });

  describe("when a dataset is written and read back", () => {
    /** @scenario "The memory and Postgres dataset repositories answer alike" */
    it("answers it by id and by slug, and counts its slug once", async () => {
      const created = await create("first");

      await expect(
        backend.datasets().findById({ id: created.id, projectId: backend.mine() }),
      ).resolves.toMatchObject({ id: created.id, name: "first", slug: "first" });

      await expect(
        backend.datasets().findBySlug({ slug: "first", projectId: backend.mine() }),
      ).resolves.toMatchObject({ id: created.id });

      await expect(
        backend.datasets().count({ projectId: backend.mine(), slug: "first" }),
      ).resolves.toBe(1);
    });

    it("excludes the dataset it is told to exclude from a slug lookup", async () => {
      const created = await create("second");

      await expect(
        backend
          .datasets()
          .findBySlug({ slug: "second", projectId: backend.mine(), excludeId: created.id }),
      ).resolves.toBeNull();
    });
  });

  describe("when a dataset is archived", () => {
    /** @scenario "The memory and Postgres dataset repositories answer alike" */
    it("hides it from every read that did not ask for archived rows", async () => {
      const created = await create("third");

      await backend.datasets().archive({
        id: created.id,
        projectId: backend.mine(),
        slug: "third-archived",
        archivedAt: nowInstant(),
      });

      await expect(
        backend.datasets().findById({ id: created.id, projectId: backend.mine() }),
      ).resolves.toBeNull();

      await expect(
        backend
          .datasets()
          .findById({ id: created.id, projectId: backend.mine(), includeArchived: true }),
      ).resolves.toMatchObject({ slug: "third-archived" });

      await expect(
        backend.datasets().list({ projectId: backend.mine(), page: 1, limit: 50 }),
      ).resolves.toEqual([]);
    });

    it("brings it back with the slug the restore names", async () => {
      const created = await create("fourth");

      await backend.datasets().archive({
        id: created.id,
        projectId: backend.mine(),
        slug: "fourth-archived",
        archivedAt: nowInstant(),
      });
      await backend
        .datasets()
        .restore({ id: created.id, projectId: backend.mine(), slug: "fourth" });

      await expect(
        backend.datasets().findById({ id: created.id, projectId: backend.mine() }),
      ).resolves.toMatchObject({ slug: "fourth", archivedAt: null });
    });
  });

  describe("when the project's datasets are listed", () => {
    /** @scenario "The memory and Postgres dataset repositories answer alike" */
    it("counts each dataset's own entries and nobody else's", async () => {
      const mine = await create("mine");
      const theirs = await create("theirs", backend.theirs());

      await backend.records().createMany({
        datasetId: mine.id,
        projectId: backend.mine(),
        entries: [{ id: "record-1", input: "one" }],
      });
      await backend.records().createMany({
        datasetId: theirs.id,
        projectId: backend.theirs(),
        entries: [
          { id: "record-2", input: "two" },
          { id: "record-3", input: "three" },
        ],
      });

      const listed = await backend.datasets().list({
        projectId: backend.mine(),
        page: 1,
        limit: 50,
      });

      expect(listed.map((dataset) => [dataset.slug, dataset.recordCount])).toEqual([
        ["mine", 1],
      ]);
    });
  });

  describe("when another project holds a dataset with the same slug", () => {
    /** @scenario "The memory and Postgres dataset repositories answer alike" */
    it("never answers with it", async () => {
      const theirs = await create("shared-slug", backend.theirs());

      await expect(
        backend.datasets().findById({ id: theirs.id, projectId: backend.mine() }),
      ).resolves.toBeNull();

      await expect(
        backend.datasets().findBySlug({ slug: "shared-slug", projectId: backend.mine() }),
      ).resolves.toBeNull();
    });
  });

  describe("when a dataset's entries are paged", () => {
    /** @scenario "The memory and Postgres dataset repositories answer alike" */
    it("answers one page at a time with the authoritative total", async () => {
      const dataset = await create("paged");

      await backend.records().createMany({
        datasetId: dataset.id,
        projectId: backend.mine(),
        entries: [
          { id: "page-1", input: "one" },
          { id: "page-2", input: "two" },
          { id: "page-3", input: "three" },
        ],
      });

      const page = await backend.records().list({
        datasetId: dataset.id,
        projectId: backend.mine(),
        page: 2,
        limit: 2,
      });

      expect(page.total).toBe(3);
      expect(page.records).toHaveLength(1);
    });

    it("removes only the entries it was asked to remove", async () => {
      const dataset = await create("deleted");

      await backend.records().createMany({
        datasetId: dataset.id,
        projectId: backend.mine(),
        entries: [
          { id: "delete-1", input: "one" },
          { id: "delete-2", input: "two" },
        ],
      });

      await expect(
        backend.records().deleteMany({
          datasetId: dataset.id,
          projectId: backend.mine(),
          recordIds: ["delete-1"],
        }),
      ).resolves.toBe(1);

      const remaining = await backend.records().list({
        datasetId: dataset.id,
        projectId: backend.mine(),
        page: 1,
        limit: 50,
      });

      expect(remaining.records.map((record) => record.id)).toEqual(["delete-2"]);
    });
  });
}

describe("given the memory dataset repositories", () => {
  let database: MemoryDatasetDatabase;

  beforeEach(() => {
    database = MemoryDatasetDatabase.create();
  });

  contractCases({
    datasets: () => MemoryDatasetRepository.create({ database }),
    records: () => MemoryDatasetRecordRepository.create({ database }),
    mine: () => "project-mine",
    theirs: () => "project-theirs",
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

function prisma(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");

  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres dataset repositories", () => {
  const suffix = nanoid(8);
  const organizationId = `org_dataset_contract_${suffix}`;
  const teamId = `team_dataset_contract_${suffix}`;
  const mine = `proj_dataset_contract_mine_${suffix}`;
  const theirs = `proj_dataset_contract_theirs_${suffix}`;

  const clearRows = async () => {
    await prisma().datasetRecord.deleteMany({ where: { projectId: { in: [mine, theirs] } } });
    await prisma().dataset.deleteMany({ where: { projectId: { in: [mine, theirs] } } });
  };

  beforeAll(async () => {
    await prisma().organization.create({
      data: { id: organizationId, name: organizationId, slug: organizationId },
    });
    await prisma().team.create({
      data: { id: teamId, name: teamId, slug: teamId, organizationId },
    });
    for (const id of [mine, theirs]) {
      await prisma().project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `key-${id}`,
        },
      });
    }
  });

  beforeEach(clearRows);

  afterAll(async () => {
    try {
      await clearRows();
      await prisma().project.deleteMany({ where: { id: { in: [mine, theirs] } } });
      await prisma().team.deleteMany({ where: { id: teamId } });
      await prisma().organization.deleteMany({ where: { id: organizationId } });
    } finally {
      await connection?.closeOnce();
    }
  });

  contractCases({
    datasets: () => PrismaDatasetRepository.create({ prisma: prisma() }),
    records: () => PrismaDatasetRecordRepository.create({ prisma: prisma() }),
    mine: () => mine,
    theirs: () => theirs,
  });
});
