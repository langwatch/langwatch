/**
 * @vitest-environment node
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  StoredObjectStorageRegistry,
  type StoredObject,
  type StoredObjectStorageDriver,
} from "@langwatch/stored-object-server";
import {
  createMigrationStorageEndpoint,
  type MigrationDataset,
  type MigrationInventory,
  type MigrationProject,
  ObjectStorageMigration,
  type QueueMigrationBlocker,
} from "../migrate-object-storage.migration";

class MemoryDriver implements StoredObjectStorageDriver {
  readonly objects = new Map<string, Buffer>();
  readonly puts: string[] = [];
  readonly deletes: string[] = [];

  async get(uri: string): Promise<Readable> {
    const bytes = this.objects.get(uri);
    if (!bytes) throw new Error(`missing ${uri}`);
    return Readable.from(bytes);
  }

  async put(uri: string, bytes: Buffer): Promise<void> {
    this.puts.push(uri);
    this.objects.set(uri, Buffer.from(bytes));
  }

  async delete(uri: string): Promise<void> {
    this.deletes.push(uri);
    this.objects.delete(uri);
  }

  async exists(uri: string): Promise<boolean> {
    return this.objects.has(uri);
  }
}

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const storedObject = ({
  projectId,
  bytes,
  storageUri,
}: {
  projectId: string;
  bytes: Buffer;
  storageUri: string;
}): StoredObject => ({
  id: `object-${digest(bytes).slice(0, 8)}`,
  project_id: projectId,
  purpose: "test",
  owner_kind: "test",
  owner_id: "owner",
  media_type: "application/octet-stream",
  size_bytes: bytes.length,
  sha256: digest(bytes),
  storage_uri: storageUri,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  inserted_at: new Date("2026-01-01T00:00:00.000Z"),
});

const setup = ({
  sourceProvider = "s3",
  destinationProvider = "azure",
  projects = [{ id: "project-1", privateS3: false }],
  datasets = [],
  queueBlockers = [],
  writesPaused = true,
  readsPaused = true,
}: {
  sourceProvider?: "s3" | "azure";
  destinationProvider?: "s3" | "azure";
  projects?: MigrationProject[];
  datasets?: MigrationDataset[];
  queueBlockers?: QueueMigrationBlocker[];
  writesPaused?: boolean;
  readsPaused?: boolean;
} = {}) => {
  const sourceDriver = new MemoryDriver();
  const destinationDriver = new MemoryDriver();
  const source = createMigrationStorageEndpoint({
    provider: sourceProvider,
    driver: sourceDriver,
    bucket: "source-bucket",
    accountName: "source-account",
    container: "source-container",
  });
  const destination = createMigrationStorageEndpoint({
    provider: destinationProvider,
    driver: destinationDriver,
    bucket: "destination-bucket",
    accountName: "destination-account",
    container: "destination-container",
  });
  const rows = new Map<string, StoredObject[]>();
  const history: StoredObject[] = [];
  const datasetRows = [...datasets];
  let publisher = async (row: StoredObject) => {
    history.push(row);
    const current = rows.get(row.project_id) ?? [];
    rows.set(
      row.project_id,
      current.map((candidate) => (candidate.id === row.id ? row : candidate)),
    );
  };
  const inventory: MigrationInventory = {
    listProjectsPage: vi.fn(async (request) => pageById(projects, request)),
    listStoredObjectsPage: vi.fn(async (projectId, request) =>
      pageById(rows.get(projectId) ?? [], request),
    ),
    listDatasetsPage: vi.fn(async (projectId, request) =>
      pageById(
        datasetRows.filter((dataset) => dataset.projectId === projectId),
        request,
      ),
    ),
  };
  const migration = new ObjectStorageMigration({
    source,
    destination,
    inventory,
    publishStoredObject: async (row) => publisher(row),
    auditQueues: async () => queueBlockers,
    writesPaused: () => writesPaused,
    readsPaused: () => readsPaused,
    now: () => new Date("2026-02-01T00:00:00.000Z"),
  });
  return {
    migration,
    source,
    destination,
    sourceDriver,
    destinationDriver,
    rows,
    history,
    datasetRows,
    setPublisher: (next: typeof publisher) => {
      publisher = next;
    },
  };
};

function pageById<T extends { id: string }>(
  rows: T[],
  request: { afterId?: string; limit: number },
): T[] {
  return rows
    .filter((row) => request.afterId == null || row.id > request.afterId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, request.limit);
}

const seedStoredObject = (
  state: ReturnType<typeof setup>,
  projectId = "project-1",
  bytes = Buffer.from("stored-object"),
) => {
  const row = storedObject({
    projectId,
    bytes,
    storageUri: state.source.storedObjectUri(projectId, digest(bytes)),
  });
  state.rows.set(projectId, [row]);
  state.sourceDriver.objects.set(row.storage_uri, bytes);
  return row;
};

async function readBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("Feature: Object storage provider parity and migration", () => {
  /** @scenario A migration dry run changes no customer data */
  it("A migration dry run changes no customer data", async () => {
    const state = setup();
    const row = seedStoredObject(state);

    const report = await state.migration.plan();

    expect(report.eligibleStoredObjects).toBe(1);
    expect(state.destinationDriver.objects.size).toBe(0);
    expect(state.rows.get("project-1")?.[0]?.storage_uri).toBe(row.storage_uri);
  });

  /** @scenario Rows outside both providers are reported, never silently dropped */
  it("Rows outside both providers are reported, never silently dropped", async () => {
    const state = setup();
    const eligible = seedStoredObject(state);
    const foreign = storedObject({
      projectId: "project-1",
      bytes: Buffer.from("local-era-object"),
      storageUri: `file:///var/lib/langwatch/project-1/${digest(Buffer.from("local-era-object"))}`,
    });
    state.rows.set("project-1", [eligible, foreign]);

    const plan = await state.migration.plan();
    // The plan names what will NOT migrate — a total that silently excluded
    // the file:// row would claim the migration covers more than it does.
    expect(plan.eligibleStoredObjects).toBe(1);
    expect(plan.foreignSchemeRows).toBe(1);
    expect(plan.foreignSchemes).toEqual(["file"]);

    // ...and the foreign row is untouched by copy + finalize.
    const report = await state.migration.copy();
    expect(report.foreignSchemeRows).toBe(1);
    await state.migration.finalize();
    expect(
      state.rows.get("project-1")?.find((r) => r.id === foreign.id)
        ?.storage_uri,
    ).toBe(foreign.storage_uri);
  });

  it("plans every page without materializing the global inventory", async () => {
    const state = setup();
    state.rows.set(
      "project-1",
      Array.from({ length: 251 }, (_, index) => {
        const bytes = Buffer.from(`object-${index}`);
        return {
          ...storedObject({
            projectId: "project-1",
            bytes,
            storageUri: state.source.storedObjectUri(
              "project-1",
              digest(bytes),
            ),
          }),
          id: `object-${index.toString().padStart(4, "0")}`,
        };
      }),
    );

    const report = await state.migration.plan();

    expect(report.eligibleStoredObjects).toBe(251);
  });

  /** @scenario Global provider migration excludes private S3 projects */
  it("Global provider migration excludes private S3 projects", async () => {
    const state = setup({
      projects: [
        { id: "global", privateS3: false },
        { id: "private", privateS3: true },
      ],
    });
    seedStoredObject(state, "global", Buffer.from("global"));
    const privateRow = seedStoredObject(
      state,
      "private",
      Buffer.from("private"),
    );

    const report = await state.migration.copy();

    expect(report.excludedProjects).toEqual(["private"]);
    expect(state.destinationDriver.puts).toHaveLength(1);
    expect(
      state.destinationDriver.objects.has(
        state.destination.storedObjectUri(
          privateRow.project_id,
          privateRow.sha256,
        ),
      ),
    ).toBe(false);
  });

  /** @scenario Online copy keeps live reads on the source provider */
  it("Online copy keeps live reads on the source provider", async () => {
    const state = setup();
    const row = seedStoredObject(state);

    await state.migration.copy();

    const target = state.destination.storedObjectUri(
      row.project_id,
      row.sha256,
    );
    expect(state.destinationDriver.objects.get(target)).toEqual(
      state.sourceDriver.objects.get(row.storage_uri),
    );
    expect(state.rows.get("project-1")?.[0]?.storage_uri).toBe(row.storage_uri);
    expect(state.sourceDriver.deletes).toEqual([]);
  });

  /** @scenario An interrupted online copy resumes safely */
  it("An interrupted online copy resumes safely", async () => {
    const state = setup();
    const verified = seedStoredObject(state, "project-1", Buffer.from("one"));
    const mismatched = storedObject({
      projectId: "project-1",
      bytes: Buffer.from("two"),
      storageUri: state.source.storedObjectUri(
        "project-1",
        digest(Buffer.from("two")),
      ),
    });
    state.rows.set("project-1", [verified, mismatched]);
    state.sourceDriver.objects.set(mismatched.storage_uri, Buffer.from("two"));
    state.destinationDriver.objects.set(
      state.destination.storedObjectUri("project-1", verified.sha256),
      Buffer.from("one"),
    );
    state.destinationDriver.objects.set(
      state.destination.storedObjectUri("project-1", mismatched.sha256),
      Buffer.from("corrupt"),
    );

    const report = await state.migration.copy();

    expect(report.skippedVerified).toBe(1);
    expect(report.repaired).toBe(1);
    expect(state.destinationDriver.puts).toHaveLength(1);
  });

  it("blocks a destination-scheme row that points at another endpoint", async () => {
    const state = setup();
    const row = seedStoredObject(state);
    state.rows.set("project-1", [
      {
        ...row,
        storage_uri: `azure-blob://another-account/another-container/project-1/${row.sha256}`,
      },
    ]);

    // The message must name the row: this aborts the entire run, and the two
    // addresses differ only in the bucket/account, which redaction masks — so
    // the id is the operator's only way to tell a mis-set destination endpoint
    // from real corruption. Matched as a substring rather than a pattern: the
    // id is interpolated, and a generated id carrying one regex metacharacter
    // would silently stop matching.
    await expect(state.migration.copy()).rejects.toThrow(
      `Stored object ${row.id} (project project-1)`,
    );
  });

  /** @scenario Active dataset uploads block finalization */
  it("Active dataset uploads block finalization", async () => {
    const state = setup({
      datasets: [
        {
          id: "dataset-1",
          projectId: "project-1",
          contentLayout: "s3_jsonl",
          status: "processing",
          chunkCount: 1,
        },
      ],
    });

    await expect(state.migration.finalize()).rejects.toThrow(
      /dataset-1.*processing/,
    );
    expect(state.history).toEqual([]);
  });

  /** @scenario Unpaused read traffic blocks finalization */
  it("Unpaused read traffic blocks finalization", async () => {
    const state = setup({ readsPaused: false, writesPaused: true });
    seedStoredObject(state);

    await expect(state.migration.finalize()).rejects.toThrow(
      /reads.*paused|read traffic/i,
    );
    expect(state.history).toEqual([]);
  });

  /** @scenario A dataset already stored at the destination does not abort the copy */
  it("A dataset already stored at the destination does not abort the copy", async () => {
    const state = setup({
      datasets: [
        {
          id: "dataset-on-destination",
          projectId: "project-1",
          contentLayout: "s3_jsonl",
          status: "ready",
          chunkCount: 1,
        },
      ],
    });
    const row = seedStoredObject(state);
    // The chunk exists ONLY at the destination — uploaded while that
    // provider was briefly the active backend (#6323 posture).
    state.destinationDriver.objects.set(
      state.destination.datasetChunkUri(
        "project-1",
        "dataset-on-destination",
        0,
      ),
      Buffer.from("chunk-at-destination"),
    );

    const report = await state.migration.copy();

    expect(report.skippedVerified).toBe(1);
    expect(report.copied).toBe(1);
    expect(
      state.destinationDriver.objects.has(
        state.destination.storedObjectUri(row.project_id, row.sha256),
      ),
    ).toBe(true);
  });

  /** @scenario A dataset already stored at the destination does not abort the copy */
  it("blocks when a chunk is missing from both providers", async () => {
    const state = setup({
      datasets: [
        {
          id: "dataset-lost",
          projectId: "project-1",
          contentLayout: "s3_jsonl",
          status: "ready",
          chunkCount: 1,
        },
      ],
    });

    await expect(state.migration.copy()).rejects.toThrow(
      /missing from both providers/,
    );
  });

  /** @scenario A dataset with no usable chunk count is reported rather than aborting the run */
  it("A dataset with no usable chunk count is reported rather than aborting the run", async () => {
    const state = setup({
      datasets: [
        {
          id: "dataset-abandoned",
          projectId: "project-1",
          contentLayout: "s3_jsonl",
          status: "ready",
          chunkCount: null,
        },
      ],
    });
    const row = seedStoredObject(state);

    const plan = await state.migration.plan();
    expect(plan.blockingDatasets).toEqual([
      {
        id: "dataset-abandoned",
        status: "ready",
        reason: "invalid-chunk-count",
      },
    ]);

    // The eligible stored object still copies — one unusable dataset row must
    // not deny the operator the progress they can safely make.
    const report = await state.migration.copy();
    expect(report.copied).toBe(1);
    expect(
      state.destinationDriver.objects.has(
        state.destination.storedObjectUri(row.project_id, row.sha256),
      ),
    ).toBe(true);

    await expect(state.migration.finalize()).rejects.toThrow(
      /dataset-abandoned.*invalid-chunk-count/,
    );
    expect(state.history).toEqual([]);
  });

  /** @scenario Outstanding queue work blocks finalization */
  it.each([
    "pending",
    "delayed",
    "active",
    "blocked",
    "staged-durable-ref",
  ] as const)("Outstanding queue work blocks finalization: %s", async (kind) => {
    const state = setup({
      queueBlockers: [{ queueName: "events", kind, count: 1 }],
    });

    await expect(state.migration.finalize()).rejects.toThrow(
      new RegExp(`events.*${kind}`),
    );
    expect(state.history).toEqual([]);
  });

  /** @scenario Finalization publishes verified destination addresses without erasing history */
  it("Finalization publishes verified destination addresses without erasing history", async () => {
    const state = setup();
    const row = seedStoredObject(state);

    await state.migration.copy();
    await state.migration.finalize();

    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.storage_uri).toBe(
      state.destination.storedObjectUri(row.project_id, row.sha256),
    );
    expect(state.history[0]?.inserted_at.getTime()).toBeGreaterThan(
      row.inserted_at.getTime(),
    );
    expect(state.sourceDriver.objects.has(row.storage_uri)).toBe(true);
  });

  /** @scenario A finalized provider migration preserves durable customer data */
  it.each([
    ["s3", "azure"],
    ["azure", "s3"],
  ] as const)("A finalized provider migration preserves durable customer data: %s to %s", async (sourceProvider, destinationProvider) => {
    const state = setup({ sourceProvider, destinationProvider });
    const row = seedStoredObject(state);
    const dataset: MigrationDataset = {
      id: "dataset-1",
      projectId: "project-1",
      contentLayout: "s3_jsonl",
      status: "ready",
      chunkCount: 2,
    };
    state.datasetRows.push(dataset);
    for (let index = 0; index < (dataset.chunkCount ?? 0); index++) {
      state.sourceDriver.objects.set(
        state.source.datasetChunkUri(dataset.projectId, dataset.id, index),
        Buffer.from(`chunk-${index}`),
      );
    }

    const result = await state.migration.finalize();
    const activeRegistry = new StoredObjectStorageRegistry({
      s3:
        destinationProvider === "s3"
          ? state.destinationDriver
          : state.sourceDriver,
      file: new MemoryDriver(),
      "azure-blob":
        destinationProvider === "azure"
          ? state.destinationDriver
          : state.sourceDriver,
    });
    const publishedRow = state.rows.get("project-1")?.[0];
    const newBytes = Buffer.from("post-cutover-write");
    const newUri = state.destination.storedObjectUri(
      "project-1",
      digest(newBytes),
    );
    await activeRegistry.put(newUri, newBytes, "application/octet-stream");

    expect(result.destinationProvider).toBe(destinationProvider);
    expect(publishedRow?.storage_uri).toBe(
      state.destination.storedObjectUri(row.project_id, row.sha256),
    );
    expect(
      await readBuffer(await activeRegistry.get(publishedRow!.storage_uri)),
    ).toEqual(Buffer.from("stored-object"));
    expect(
      await readBuffer(
        await state.destination.driver.get(
          state.destination.datasetChunkUri(dataset.projectId, dataset.id, 1),
        ),
      ),
    ).toEqual(Buffer.from("chunk-1"));
    expect(await readBuffer(await activeRegistry.get(newUri))).toEqual(
      newBytes,
    );
  });

  /** @scenario A failed finalization can be resumed before traffic restarts */
  it("A failed finalization can be resumed before traffic restarts", async () => {
    const state = setup();
    const first = seedStoredObject(state, "project-1", Buffer.from("one"));
    const second = storedObject({
      projectId: "project-1",
      bytes: Buffer.from("two"),
      storageUri: state.source.storedObjectUri(
        "project-1",
        digest(Buffer.from("two")),
      ),
    });
    state.rows.set("project-1", [first, second]);
    state.sourceDriver.objects.set(second.storage_uri, Buffer.from("two"));
    let publications = 0;
    state.setPublisher(async (row) => {
      publications += 1;
      if (publications === 2) throw new Error("ClickHouse unavailable");
      state.history.push(row);
      state.rows.set(
        row.project_id,
        (state.rows.get(row.project_id) ?? []).map((candidate) =>
          candidate.id === row.id ? row : candidate,
        ),
      );
    });

    await expect(state.migration.finalize()).rejects.toThrow(
      "ClickHouse unavailable",
    );
    state.setPublisher(async (row) => {
      state.history.push(row);
      state.rows.set(
        row.project_id,
        (state.rows.get(row.project_id) ?? []).map((candidate) =>
          candidate.id === row.id ? row : candidate,
        ),
      );
    });

    const report = await state.migration.finalize();

    expect(report.publishedStoredObjects).toBe(1);
    expect(
      state.rows
        .get("project-1")
        ?.every((row) =>
          row.storage_uri.startsWith(`${state.destination.scheme}://`),
        ),
    ).toBe(true);
  });

  /** @scenario Successful migration does not delete source data */
  it("Successful migration does not delete source data", async () => {
    const state = setup();
    const row = seedStoredObject(state);

    await state.migration.finalize();

    expect(state.sourceDriver.objects.has(row.storage_uri)).toBe(true);
    expect(state.sourceDriver.deletes).toEqual([]);
  });
});
