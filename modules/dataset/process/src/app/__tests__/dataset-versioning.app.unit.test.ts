/**
 * @vitest-environment node
 * Dataset versions over the memory twins: saving, reading, comparing,
 * restoring, experiment runs, retention and the first-version step.
 */
import type { DatasetVersionAuthor } from "@langwatch/dataset-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { beforeEach, describe, expect, it } from "vitest";

import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetVersionRepository } from "../../repositories/memory/memory.dataset-version.repository.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { StreamingChunkWriterService } from "../../services/dataset-chunk-writer.service.ts";
import type { DatasetModule } from "../dataset.app.ts";
import { createDatasetTestApp, createDatasetTestProjects } from "./dataset.fixture.ts";

const PROJECT = "project-1";
const ALICE: DatasetVersionAuthor = { kind: "user", id: "user-alice" };
const DAY_MS = 24 * 60 * 60 * 1000;

let clock = Date.UTC(2026, 9, 1);
let repositories: DatasetRepositories;
let app: DatasetModule;

function boot(projects: ProjectApi = createDatasetTestProjects()) {
  repositories = {
    ...MemoryDatasetRepositories.create(),
    versions: MemoryDatasetVersionRepository.create({
      now: () => Temporal.Instant.fromEpochMilliseconds(clock),
    }),
  };
  app = createDatasetTestApp({ repositories, dependencies: { projects } });
}

async function createDataset(
  rows: { id: string; input: string }[] = [
    { id: "a", input: "first" },
    { id: "b", input: "second" },
  ],
) {
  const dataset = await app.upsertDataset({
    projectId: PROJECT,
    name: `qa-${Math.random().toString(36).slice(2, 8)}`,
    columnTypes: [{ name: "input", type: "string" }],
    datasetRecords: rows,
  });
  return dataset.id;
}

const save = (datasetId: string, name?: string) =>
  app.saveVersion({ projectId: PROJECT, datasetId, editedBy: ALICE, ...(name ? { name } : {}) });

const versionsOf = async (datasetId: string) =>
  (await app.listVersions({ projectId: PROJECT, datasetId })).versions;

const edit = (datasetId: string, recordId: string, input: string) =>
  app.upsertRecord({
    projectId: PROJECT,
    slugOrId: datasetId,
    recordId,
    updatedRecord: { input },
    editedBy: ALICE,
  });

beforeEach(() => {
  clock = Date.UTC(2026, 9, 1);
  boot();
});

describe("given a dataset with version 1", () => {
  describe("when a user edits a row and the edits go quiet", () => {
    /** @scenario "Edits that go quiet save a version" */
    it("saves version 2 automatically, authored by that user", async () => {
      const datasetId = await createDataset();
      await save(datasetId);
      await edit(datasetId, "a", "changed");

      await app.autosaveVersion({ projectId: PROJECT, datasetId, editedBy: ALICE });

      const [latest] = await versionsOf(datasetId);
      expect(latest).toMatchObject({ version: 2, trigger: "autosave", authorId: "user-alice" });
    });
  });

  describe("when a user edits a row and saves a named version", () => {
    /** @scenario "Saving a version by hand with a name" */
    it("saves version 2 with that name", async () => {
      const datasetId = await createDataset();
      await save(datasetId);
      await edit(datasetId, "a", "changed");

      const saved = await save(datasetId, "Before relabel");

      expect(saved).toMatchObject({
        version: 2,
        name: "Before relabel",
        trigger: "manual",
        authorKind: "user",
        authorId: "user-alice",
      });
    });
  });
});

describe("given a dataset that was never versioned", () => {
  describe("when the first edit arrives", () => {
    /** @scenario "Edits that go quiet save a version" */
    it("keeps the content before the edit as version 1", async () => {
      const datasetId = await createDataset();
      await edit(datasetId, "a", "changed");

      const versions = await versionsOf(datasetId);
      expect(versions).toHaveLength(1);
      const page = await app.getVersionPage({ projectId: PROJECT, datasetId, version: 1 });
      expect(page.version.trigger).toBe("initial");
      expect(page.rows.find((row) => row.id === "a")?.entry).toEqual({ input: "first" });
    });
  });
});

describe("given a dataset whose latest version holds its current content", () => {
  describe("when a version is saved automatically or by a run", () => {
    /** @scenario "Saving unchanged content creates no version" */
    it("creates no new version and answers the latest", async () => {
      const datasetId = await createDataset();
      const first = await save(datasetId);

      await app.autosaveVersion({ projectId: PROJECT, datasetId, editedBy: ALICE });
      const forRun = await app.resolveVersionForRun({ projectId: PROJECT, datasetId, by: ALICE });

      expect(forRun.id).toBe(first.id);
      expect(await versionsOf(datasetId)).toHaveLength(1);
    });
  });

  describe("when a user saves it with a name", () => {
    /** @scenario "Naming unchanged content names the latest version" */
    it("names the latest version instead of adding one", async () => {
      const datasetId = await createDataset();
      await save(datasetId);

      const named = await save(datasetId, "Baseline");

      expect(named).toMatchObject({ version: 1, name: "Baseline" });
      expect(await versionsOf(datasetId)).toHaveLength(1);
    });
  });
});

describe("given a dataset whose import is still processing", () => {
  /** @scenario "A dataset that is still importing is not snapshotted" */
  it("refuses a save with dataset_not_ready", async () => {
    const datasetId = await createDataset();
    await repositories.content.update({
      id: datasetId,
      projectId: PROJECT,
      data: { status: "processing" },
    });

    await expect(save(datasetId)).rejects.toMatchObject({ code: "dataset_not_ready" });
  });
});

describe("given no dataset by that name", () => {
  /** @scenario "Saving a version of a missing dataset is refused" */
  it("refuses a save with dataset_not_found", async () => {
    await expect(save("ghost")).rejects.toMatchObject({ code: "dataset_not_found" });
  });
});

describe("given a dataset with versions 1, 2 and 3", () => {
  /** @scenario "The history lists versions newest first with author and time" */
  it("lists them newest first with author, trigger, row count and time", async () => {
    const datasetId = await createDataset();
    for (const value of ["one", "two", "three"]) {
      await edit(datasetId, "a", value);
      clock += 60_000;
      await save(datasetId);
    }

    const versions = await versionsOf(datasetId);

    expect(versions.map((version) => version.version)).toEqual([4, 3, 2, 1]);
    expect(versions[0]).toMatchObject({
      authorId: "user-alice",
      authorName: "Name of user-alice",
      trigger: "manual",
      rowCount: 2,
    });
    expect(versions[0]!.createdAt.getTime()).toBeGreaterThan(versions[1]!.createdAt.getTime());
  });
});

describe("given a version older than the current content", () => {
  /** @scenario "Viewing a version shows its own rows and columns" */
  it("answers the version's own rows and columns", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await app.batchCreateRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      entries: [{ id: "c", input: "third" }],
    });

    const page = await app.getVersionPage({ projectId: PROJECT, datasetId, version: 1 });

    expect(page.rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(page.version.columnTypes).toEqual([{ name: "input", type: "string" }]);
    expect(page.pagination.total).toBe(2);
  });

  /** @scenario "Reading a version the dataset does not have is refused" */
  it("refuses a version number the dataset does not have", async () => {
    const datasetId = await createDataset();
    await save(datasetId);

    await expect(
      app.getVersionPage({ projectId: PROJECT, datasetId, version: 7 }),
    ).rejects.toMatchObject({ code: "dataset_version_not_found" });
  });

  /** @scenario "A version of another project is not readable" */
  it("refuses a version read from another project", async () => {
    const datasetId = await createDataset();
    await save(datasetId);

    await expect(
      app.getVersionPage({ projectId: "project-2", datasetId, version: 1 }),
    ).rejects.toMatchObject({ code: "dataset_not_found" });
  });
});

describe("when a version is compared with the current content", () => {
  /** @scenario "Comparing a version with the current content" */
  it("counts and lists added, removed and changed rows", async () => {
    const datasetId = await createDataset([
      { id: "a", input: "first" },
      { id: "b", input: "second" },
      { id: "c", input: "third" },
    ]);
    await save(datasetId);
    await edit(datasetId, "a", "changed");
    await app.deleteRecords({ projectId: PROJECT, slugOrId: datasetId, recordIds: ["b"] });
    await app.batchCreateRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      entries: [{ id: "d", input: "fourth" }],
    });

    const comparison = await app.compareVersion({ projectId: PROJECT, datasetId, version: 1 });

    expect(comparison.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(comparison.added.map((row) => row.id)).toEqual(["d"]);
    expect(comparison.removed.map((row) => row.id)).toEqual(["b"]);
    expect(comparison.changed).toEqual([
      { id: "a", before: { input: "first" }, after: { input: "changed" } },
    ]);
    expect(comparison.against).toBeNull();
  });

  /** @scenario "Comparing reports column changes" */
  it("lists added and removed columns", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await app.upsertDataset({
      projectId: PROJECT,
      slugOrId: datasetId,
      columnTypes: [
        { name: "input", type: "string" },
        { name: "expected", type: "string" },
      ],
    });

    const comparison = await app.compareVersion({ projectId: PROJECT, datasetId, version: 1 });

    expect(comparison.columns).toEqual({ added: ["expected"], removed: [] });
  });
});

describe("when a version is restored", () => {
  /** @scenario "Restoring a version writes a new version" */
  it("writes the version's content back as a new version and keeps the old ones", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await edit(datasetId, "a", "changed");
    await save(datasetId);

    const restored = await app.restoreVersion({
      projectId: PROJECT,
      datasetId,
      version: 1,
      editedBy: ALICE,
    });

    expect(restored).toMatchObject({ changed: true });
    expect(restored.version).toMatchObject({
      version: 3,
      trigger: "restore",
      restoredFromVersion: 1,
      authorId: "user-alice",
    });
    const current = await app.getDatasetWithRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      limitMb: null,
    });
    expect(current.records.find((record) => record.id === "a")?.entry).toEqual({ input: "first" });
    const second = await app.getVersionPage({ projectId: PROJECT, datasetId, version: 2 });
    expect(second.rows.find((row) => row.id === "a")?.entry).toEqual({ input: "changed" });
  });

  /** @scenario "Restoring a version writes a new version" */
  it("restores an object-storage dataset's rows and ids into its chunks", async () => {
    const datasetId = await createDataset([]);
    const writer = StreamingChunkWriterService.create({
      storage: repositories.chunks,
      projectId: PROJECT,
      datasetId,
    });
    await writer.push({ input: "first" }, { id: "a" });
    await writer.push({ input: "second" }, { id: "b" });
    const meta = await writer.finalize();
    await repositories.content.update({
      id: datasetId,
      projectId: PROJECT,
      data: {
        contentLayout: "s3_jsonl",
        rowCount: meta.rowCount,
        chunkCount: meta.chunkCount,
        sizeBytes: BigInt(meta.sizeBytes),
        chunkOffsets: meta.chunkOffsets,
      },
    });
    await save(datasetId);
    await app.deleteRecords({ projectId: PROJECT, slugOrId: datasetId, recordIds: ["b"] });
    await save(datasetId);

    const restored = await app.restoreVersion({ projectId: PROJECT, datasetId, version: 1 });

    expect(restored).toMatchObject({ changed: true, version: { version: 3, rowCount: 2 } });
    const current = await app.getDatasetWithRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      limitMb: null,
    });
    expect(current.records.map((record) => [record.id, record.entry])).toEqual([
      ["a", { input: "first" }],
      ["b", { input: "second" }],
    ]);
  });

  /** @scenario "Restoring a version writes a new version" */
  it("records the restore so every open read of the dataset refreshes", async () => {
    const restoredEvents: unknown[] = [];
    const ignore = { send: async () => undefined };
    app.connectVersions({
      recordContentEdit: ignore,
      recordVersionSaved: ignore,
      recordVersionRestored: { send: async (input) => void restoredEvents.push(input) },
    });
    const datasetId = await createDataset();
    await save(datasetId);
    await edit(datasetId, "a", "changed");

    await app.restoreVersion({ projectId: PROJECT, datasetId, version: 1 });

    expect(restoredEvents).toEqual([
      expect.objectContaining({
        projectId: PROJECT,
        datasetId,
        version: 3,
        restoredFromVersion: 1,
        tenantId: PROJECT,
      }),
    ]);
  });

  /** @scenario "Restoring a version that holds the current content changes nothing" */
  it("creates nothing when the version is the current content", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await edit(datasetId, "a", "changed");
    await save(datasetId);

    const restored = await app.restoreVersion({ projectId: PROJECT, datasetId, version: 2 });

    expect(restored).toMatchObject({ changed: false, version: { version: 2 } });
    expect(await versionsOf(datasetId)).toHaveLength(2);
  });

  /** @scenario "Restoring a version the dataset does not have is refused" */
  it("refuses a version the dataset does not have", async () => {
    const datasetId = await createDataset();
    await save(datasetId);

    await expect(
      app.restoreVersion({ projectId: PROJECT, datasetId, version: 9 }),
    ).rejects.toMatchObject({ code: "dataset_version_not_found" });
  });

  /** @scenario "Restoring a legacy single-file dataset is refused" */
  it("refuses a legacy single-file dataset", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await repositories.content.update({ id: datasetId, projectId: PROJECT, data: { useS3: true } });

    await expect(
      app.restoreVersion({ projectId: PROJECT, datasetId, version: 1 }),
    ).rejects.toMatchObject({ code: "dataset_version_restore_unsupported" });
    await expect(app.listVersions({ projectId: PROJECT, datasetId })).resolves.toMatchObject({
      restorable: false,
    });
  });
});

describe("given an experiment run over a saved dataset", () => {
  /** @scenario "An experiment run records the dataset version it ran on" */
  it("saves the changed content as an experiment_run version and links the run", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await edit(datasetId, "a", "changed");

    const version = await app.resolveVersionForRun({ projectId: PROJECT, datasetId, by: ALICE });
    await app.linkRunVersions({
      projectId: PROJECT,
      runId: "run-1",
      versions: [{ datasetId, versionId: version.id }],
    });

    expect(version).toMatchObject({ version: 2, trigger: "experiment_run" });
    const read = await app.readVersion({ projectId: PROJECT, datasetId, version: 2 });
    expect(read.rows.find((row) => row.id === "a")?.entry).toEqual({ input: "changed" });
    const [listed] = await versionsOf(datasetId);
    expect(listed!.runCount).toBe(1);
  });

  /** @scenario "An experiment run can pin a dataset version" */
  it("answers the pinned version, not the current content", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await edit(datasetId, "a", "changed");
    await save(datasetId);

    const version = await app.resolveVersionForRun({
      projectId: PROJECT,
      datasetId,
      version: 1,
      by: ALICE,
    });
    const read = await app.readVersion({ projectId: PROJECT, datasetId, version: version.version });

    expect(version.version).toBe(1);
    expect(read.rows.find((row) => row.id === "a")?.entry).toEqual({ input: "first" });
  });

  /** @scenario "Pinning a version the dataset does not have refuses the run" */
  it("refuses a pin to a version the dataset does not have", async () => {
    const datasetId = await createDataset();
    await save(datasetId);

    await expect(
      app.resolveVersionForRun({ projectId: PROJECT, datasetId, version: 5, by: ALICE }),
    ).rejects.toMatchObject({ code: "dataset_version_not_found" });
  });

  /** @scenario "A run's dataset version is shown with the run" */
  it("answers the version a run read by its run id", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    await edit(datasetId, "a", "changed");
    const version = await save(datasetId);
    await app.linkRunVersions({
      projectId: PROJECT,
      runId: "run-7",
      experimentId: "experiment-1",
      versions: [{ datasetId, versionId: version.id }],
    });

    const links = await app.findRunVersions({ projectId: PROJECT, runIds: ["run-7", "run-8"] });

    expect(links).toEqual([{ runId: "run-7", datasetId, versionId: version.id, version: 2 }]);
  });
});

describe("when the retention sweep runs", () => {
  /** @scenario "Retention never thins named or run versions" */
  it("keeps named and run versions whatever their age", async () => {
    const datasetId = await createDataset();
    const named = await save(datasetId, "Keep me");
    for (let hour = 1; hour <= 4; hour++) {
      clock += 60 * 60 * 1000;
      await edit(datasetId, "a", `value ${hour}`);
      await app.autosaveVersion({ projectId: PROJECT, datasetId, editedBy: ALICE });
    }
    const all = await versionsOf(datasetId);
    const runVersion = all.find((version) => version.version === 3)!;
    await app.linkRunVersions({
      projectId: PROJECT,
      runId: "run-1",
      versions: [{ datasetId, versionId: runVersion.id }],
    });
    clock += 40 * DAY_MS;

    const summary = await app.sweepVersionRetention({ nowMs: clock });

    const kept = (await versionsOf(datasetId)).map((version) => version.version);
    expect(kept).toContain(named.version);
    expect(kept).toContain(3);
    expect(kept).toContain(5);
    expect(summary.thinned).toBe(2);
  });

  /** @scenario "Retention removes a thinned version's stored rows" */
  it("removes a thinned version's row and its stored chunks", async () => {
    const datasetId = await createDataset();
    await save(datasetId);
    clock += 60_000;
    await edit(datasetId, "a", "changed");
    await save(datasetId);
    clock += 60_000;
    await edit(datasetId, "a", "again");
    await save(datasetId);
    const [, middle] = await versionsOf(datasetId);
    clock += 3 * DAY_MS;

    await app.sweepVersionRetention({ nowMs: clock });

    expect((await versionsOf(datasetId)).map((version) => version.version)).toEqual([3]);
    await expect(
      repositories.versionContent.readChunk({
        projectId: PROJECT,
        datasetId,
        versionId: middle!.id,
        index: 0,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("given datasets created before versioning", () => {
  const checkpointOf = (resumeFrom: MigrationStepReport | null) => {
    const saved: MigrationStepReport[] = [];
    return {
      saved,
      checkpoint: {
        resumeFrom,
        save: async ({ report }: { report: MigrationStepReport }) => void saved.push(report),
      },
    };
  };
  const run = (resumeFrom: MigrationStepReport | null = null, dryRun = false) => {
    const { saved, checkpoint } = checkpointOf(resumeFrom);
    return app
      .firstVersionsRun()({
        checkpoint,
        dryRun,
        signal: new AbortController().signal,
        log: { info: () => undefined, warn: () => undefined },
      })
      .then((report) => ({ report, saved }));
  };

  beforeEach(() => {
    boot(
      createApiFixture<ProjectApi>({
        getOrganizationId: async () => "organization-1",
        listAllIds: async (input) => ({
          ids: ["project-0", PROJECT].filter((id) => !input?.after || id > input.after),
          next: null,
        }),
      }),
    );
  });

  /** @scenario "Existing datasets get version 1 in the background" */
  it("gives each ready dataset version 1, once", async () => {
    const first = await createDataset();
    const second = await createDataset();

    const { report } = await run();
    const again = await run();

    expect(report).toMatchObject({ created: 2, failed: 0 });
    expect(again.report).toMatchObject({ created: 0 });
    for (const datasetId of [first, second]) {
      const versions = await versionsOf(datasetId);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: 1, trigger: "initial", authorKind: "system" });
    }
  });

  /** @scenario "Existing datasets get version 1 in the background" */
  it("creates nothing and saves no checkpoint on a dry run", async () => {
    const datasetId = await createDataset();

    const { report, saved } = await run(null, true);

    expect(report).toMatchObject({ wouldCreate: 1, dryRun: true });
    expect(saved).toEqual([]);
    expect(await versionsOf(datasetId)).toEqual([]);
  });

  /** @scenario "The first-version step resumes from its checkpoint" */
  it("continues after the project its checkpoint names", async () => {
    const finished = await app.upsertDataset({
      projectId: "project-0",
      name: "finished-before",
      columnTypes: [{ name: "input", type: "string" }],
      datasetRecords: [{ id: "a", input: "x" }],
    });
    const datasetId = await createDataset();

    const { report, saved } = await run({ afterProjectId: "project-0" });

    expect(report).toMatchObject({ created: 1 });
    expect(await versionsOf(datasetId)).toHaveLength(1);
    expect(
      (await app.listVersions({ projectId: "project-0", datasetId: finished.id })).versions,
    ).toEqual([]);
    expect(saved.at(-1)).toMatchObject({ afterProjectId: PROJECT });
  });
});
