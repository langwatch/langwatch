/**
 * A file appended to a dataset still in the records table takes the dataset lock the content
 * move commits under, so the move can never flip the dataset between the append's rows landing
 * and its own commit: the rows are either seen by the move or written after it, to the chunks.
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { memoryObjectStorage } from "@langwatch/process-stores";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatasetTestApp } from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetMigrationRepository } from "../../repositories/dataset-migration.repository.ts";
import { PostgresDatasetRepositories } from "../../repositories/prisma/prisma.dataset.repositories.ts";
import { DatasetMigrationService } from "../dataset-migration.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("a file appended to a dataset still in the records table", () => {
  const namespace = `dataset-append-lock-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:append-lock"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const objectStorage = memoryObjectStorage();
  const repositories = PostgresDatasetRepositories.create({
    prisma,
    objectStorage,
    config: { singleFileStorage: { onLocalDisk: false, localPath: undefined } },
  });
  const app = createDatasetTestApp({ repositories });
  let datasetId = "";

  const append = (rows: string[]) =>
    app.uploadToExistingDataset({
      projectId,
      slugOrId: datasetId,
      filename: "more.csv",
      fileSize: 0,
      bytes: (async function* () {
        yield new TextEncoder().encode(`input\n${rows.join("\n")}\n`);
      })(),
    });
  const tableRows = () => prisma.datasetRecord.count({ where: { datasetId, projectId } });
  const readRows = async () =>
    (
      await app.getDatasetWithRecords({ projectId, slugOrId: datasetId, limitMb: null })
    ).records.map((record) => record.entry.input);
  const move = (repository: DatasetMigrationRepository = repositories.migration) =>
    DatasetMigrationService.create({
      repository,
      storage: repositories.migrationChunks,
      projects: { listAllIds: async () => ({ ids: [projectId], next: null }) },
    }).run();

  /** Resolves once some transaction waits on an advisory lock: the append is held back. */
  const appendWaitsOnLock = async () => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const waiting = await prisma.$queryRaw<{ count: bigint }[]>` ${skipTenantCheck({
        // Reads the lock table only.
        SKIP_TENANT_CHECK: true,
      })}
SELECT count(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if ((waiting[0]?.count ?? 0n) > 0n) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

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
  });

  beforeEach(async () => {
    await prisma.datasetRecord.deleteMany({ where: { projectId } });
    await prisma.dataset.deleteMany({ where: { projectId } });
    datasetId = `${namespace}-${randomUUID()}`;
    await prisma.dataset.create({
      data: {
        id: datasetId,
        projectId,
        name: datasetId,
        slug: datasetId,
        columnTypes: [{ name: "input", type: "string" }],
        contentLayout: "postgres",
      },
    });
    await repositories.records.createMany({
      datasetId,
      projectId,
      entries: ["one", "two", "three"].map((input, index) => ({
        id: `${datasetId}-row-${index}`,
        input,
      })),
    });
  });

  afterAll(async () => {
    await prisma.datasetRecord.deleteMany({ where: { projectId } });
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  /** @scenario "A file appended to a dataset that is being moved keeps every row" */
  it("waits while the dataset's lock is held, then adds its rows", async () => {
    let released!: () => void;
    const holding = new Promise<void>((resolve) => (released = resolve));
    const held = repositories.records.withDatasetLock({ datasetId, projectId }, () => holding);

    const appended = append(["four", "five"]);
    let first: string;
    let rowsWhileHeld: number;
    try {
      first = await Promise.race([
        appended.then(() => "appended"),
        appendWaitsOnLock().then((waits) => (waits ? "waiting" : "never waited")),
      ]);
      rowsWhileHeld = await tableRows();
    } finally {
      released();
      await held;
    }
    expect(first).toBe("waiting");
    expect(rowsWhileHeld).toBe(3);

    await expect(appended).resolves.toMatchObject({ recordsCreated: 2 });
    await expect(tableRows()).resolves.toBe(5);
  });

  /** @scenario "A file appended to a dataset that is being moved keeps every row" */
  it("leaves the dataset for the move's next pass, which moves all five rows", async () => {
    const real = repositories.migration;
    const racing: DatasetMigrationRepository = Object.assign(Object.create(real) as typeof real, {
      commit: (async (input) => {
        await append(["four", "five"]);
        return real.commit(input);
      }) satisfies DatasetMigrationRepository["commit"],
    });

    const first = await move(racing);
    expect(first).toMatchObject({ status: "incomplete", summary: { skippedConcurrentWrite: 1 } });
    await expect(readRows()).resolves.toEqual(["one", "two", "three", "four", "five"]);

    const second = await move();
    expect(second).toMatchObject({ status: "completed", summary: { migrated: 1 } });
    await expect(
      prisma.dataset.findFirstOrThrow({ where: { id: datasetId, projectId } }),
    ).resolves.toMatchObject({ contentLayout: "s3_jsonl", rowCount: 5 });
    await expect(readRows()).resolves.toEqual(["one", "two", "three", "four", "five"]);
  });

  /** @scenario "A file appended to a dataset that is being moved keeps every row" */
  it("writes to the chunks when the move flips the dataset while the append waits", async () => {
    // The append's promise is returned wrapped: awaiting it inside would wait on this lock.
    const { appended } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw` ${skipTenantCheck({
        // Advisory-lock helper, key is dataset-bounded.
        SKIP_TENANT_CHECK: true,
      })}
SELECT pg_advisory_xact_lock(hashtextextended(${`dataset:${datasetId}`}, 0))`;
      const waiting = { appended: append(["four", "five"]) };
      expect(await appendWaitsOnLock()).toBe(true);
      await tx.dataset.update({
        where: { id: datasetId, projectId },
        data: { contentLayout: "s3_jsonl", rowCount: 0, chunkCount: 0, chunkOffsets: [] },
      });
      return waiting;
    });

    await expect(appended).resolves.toMatchObject({ recordsCreated: 2 });
    await expect(tableRows()).resolves.toBe(3);
    await expect(readRows()).resolves.toEqual(["four", "five"]);
  });
});
