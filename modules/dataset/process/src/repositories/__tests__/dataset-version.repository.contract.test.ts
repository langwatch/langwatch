import { createLogger } from "@langwatch/observability";
/**
 * @vitest-environment node
 * Dataset version repository contract against memory and Postgres backends.
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import {
  DatasetVersionNumberTakenError,
  type DatasetVersionRepository,
  type NewDatasetVersion,
} from "../dataset-version.repository.ts";
import { MemoryDatasetVersionRepository } from "../memory/memory.dataset-version.repository.ts";
import { PrismaDatasetVersionRepository } from "../prisma/prisma.dataset-version.repository.ts";

type Backend = Readonly<{ versions: () => DatasetVersionRepository; mine: string; theirs: string }>;

function contractCases(backend: Backend): void {
  const datasetId = `dataset_${nanoid(8)}`;
  const version = (
    number: number,
    overrides: Partial<NewDatasetVersion> = {},
  ): NewDatasetVersion => ({
    id: `dsv_${nanoid(10)}`,
    projectId: backend.mine,
    datasetId,
    version: number,
    name: null,
    trigger: "autosave",
    contentHash: `hash-${number}`,
    columnTypes: [{ name: "input", type: "string" }],
    rowCount: number * 10,
    sizeBytes: number * 100,
    chunkCount: 1,
    restoredFromVersion: null,
    authorId: "user-1",
    authorKind: "user",
    pinned: false,
    ...overrides,
  });

  /** @scenario "The memory and Postgres version repositories answer alike" */
  it("writes, lists newest first, links runs and deletes, scoped to the project", async () => {
    const repo = backend.versions();
    const first = await repo.create(version(1));
    const second = await repo.create(version(2, { name: "Named", trigger: "manual" }));

    await expect(repo.create(version(2))).rejects.toBeInstanceOf(DatasetVersionNumberTakenError);
    expect(
      (await repo.findAll({ projectId: backend.mine, datasetId })).map((v) => v.version),
    ).toEqual([2, 1]);
    await expect(repo.findLatest({ projectId: backend.mine, datasetId })).resolves.toMatchObject({
      id: second.id,
      name: "Named",
      trigger: "manual",
      sizeBytes: 200,
      columnTypes: [{ name: "input", type: "string" }],
    });
    await expect(
      repo.findByNumber({ projectId: backend.theirs, datasetId, version: 1 }),
    ).resolves.toBeNull();
    await expect(repo.hasAny({ projectId: backend.theirs, datasetId })).resolves.toBe(false);

    await repo.linkRun({
      projectId: backend.mine,
      runId: "run-1",
      experimentId: "experiment-1",
      versions: [{ datasetId, versionId: first.id }],
    });
    await repo.linkRun({
      projectId: backend.mine,
      runId: "run-1",
      experimentId: "experiment-1",
      versions: [{ datasetId, versionId: first.id }],
    });
    await expect(
      repo.findByNumber({ projectId: backend.mine, datasetId, version: 1 }),
    ).resolves.toMatchObject({ runCount: 1 });
    await expect(
      repo.findRunLinks({ projectId: backend.mine, runIds: ["run-1"] }),
    ).resolves.toEqual([{ runId: "run-1", datasetId, versionId: first.id, version: 1 }]);
    await expect(
      repo.findRunLinks({ projectId: backend.theirs, runIds: ["run-1"] }),
    ).resolves.toEqual([]);

    await expect(
      repo.rename({ projectId: backend.mine, id: first.id, name: "Baseline" }),
    ).resolves.toMatchObject({ name: "Baseline" });
    await expect(repo.pin({ projectId: backend.mine, id: first.id })).resolves.toMatchObject({
      pinned: true,
    });

    await expect(repo.deleteMany({ projectId: backend.theirs, ids: [second.id] })).resolves.toBe(0);
    await expect(repo.deleteMany({ projectId: backend.mine, ids: [second.id] })).resolves.toBe(1);
    expect(
      (await repo.findAll({ projectId: backend.mine, datasetId })).map((v) => v.version),
    ).toEqual([1]);
  });

  /** @scenario "The memory and Postgres version repositories answer alike" */
  it("pages datasets with an old version, by dataset id", async () => {
    const repo = backend.versions();
    const many = `dataset_${nanoid(8)}`;
    const single = `dataset_${nanoid(8)}`;
    await repo.create(version(1, { datasetId: many }));
    await repo.create(version(2, { datasetId: many }));
    await repo.create(version(1, { datasetId: single }));

    const page = await repo.findDatasetsWithVersions({
      afterDatasetId: null,
      olderThanMs: Date.now() + 60_000,
      limit: 1_000,
    });

    expect(page).toContainEqual({ projectId: backend.mine, datasetId: many });
    expect(page).toContainEqual({ projectId: backend.mine, datasetId: single });
    expect(page.filter((entry) => entry.datasetId === many)).toHaveLength(1);
    const later = await repo.findDatasetsWithVersions({
      afterDatasetId: many,
      olderThanMs: Date.now() + 60_000,
      limit: 1_000,
    });
    expect(later.map((entry) => entry.datasetId)).not.toContain(many);
    const recent = await repo.findDatasetsWithVersions({
      afterDatasetId: null,
      olderThanMs: Date.now() - 60 * 60_000,
      limit: 1_000,
    });
    expect(recent.map((entry) => entry.datasetId)).not.toContain(many);
  });

  /** @scenario "The memory and Postgres version repositories answer alike" */
  it("removes run links with their versions and clears an erased author", async () => {
    const repo = backend.versions();
    const linked = `dataset_${nanoid(8)}`;
    const userId = `user_${nanoid(8)}`;
    const saved = await repo.create(version(1, { datasetId: linked, authorId: userId }));
    await repo.create(
      version(1, {
        datasetId: `dataset_${nanoid(8)}`,
        projectId: backend.theirs,
        authorId: userId,
      }),
    );
    await repo.create(version(2, { datasetId: linked, authorKind: "api_key", authorId: userId }));
    const runId = `run_${nanoid(8)}`;
    await repo.linkRun({
      projectId: backend.mine,
      runId,
      experimentId: "experiment-1",
      versions: [{ datasetId: linked, versionId: saved.id }],
    });

    await expect(repo.forgetAuthor({ userId })).resolves.toBe(2);
    const [apiKeyVersion, userVersion] = await repo.findAll({
      projectId: backend.mine,
      datasetId: linked,
    });
    expect(userVersion).toMatchObject({ authorKind: "user", authorId: null });
    expect(apiKeyVersion).toMatchObject({ authorKind: "api_key", authorId: userId });

    await repo.deleteMany({ projectId: backend.mine, ids: [saved.id] });
    await expect(repo.findRunLinks({ projectId: backend.mine, runIds: [runId] })).resolves.toEqual(
      [],
    );
  });
}

describe("given the memory dataset version repository", () => {
  const repository = MemoryDatasetVersionRepository.create();
  contractCases({ versions: () => repository, mine: "project-mine", theirs: "project-theirs" });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("dataset-version-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

describe.skipIf(!databaseUrl)("given the Postgres dataset version repository", () => {
  const suffix = nanoid(8);
  const mine = `proj_dsv_contract_mine_${suffix}`;
  const theirs = `proj_dsv_contract_theirs_${suffix}`;

  afterAll(async () => {
    const prisma = connection!.client;
    await prisma.datasetVersionRun.deleteMany({ where: { projectId: { in: [mine, theirs] } } });
    await prisma.datasetVersion.deleteMany({ where: { projectId: { in: [mine, theirs] } } });
  });

  contractCases({
    versions: () => PrismaDatasetVersionRepository.create({ prisma: connection!.client }),
    mine,
    theirs,
  });
});
