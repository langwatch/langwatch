/**
 * Controlled S3 <-> Azure object-storage migration.
 *
 * The core is deliberately provider-neutral and dependency-injected. The
 * operational task can wire real Prisma, ClickHouse, Redis, S3, and Azure
 * boundaries while integration tests use in-memory drivers. No phase deletes
 * source bytes.
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { chunkKey } from "@langwatch/dataset-contract";
import { redactStorageUri } from "~/server/stored-objects/project-storage-destination";
import type { StorageDriver } from "~/server/stored-objects/storage-driver";
import type { StoredObject } from "~/server/stored-objects/stored-object";
import { mintAzureBlobUri, mintS3Uri } from "~/server/stored-objects/uri";

export type MigrationProvider = "s3" | "azure";

export type MigrationProject = {
  id: string;
  /** A tenant-owned bucket is never included in a global provider migration. */
  privateS3: boolean;
};

export type MigrationDataset = {
  id: string;
  projectId: string;
  contentLayout: string;
  status: string;
  chunkCount: number | null;
};

export type QueueMigrationBlocker = {
  queueName: string;
  kind: "pending" | "delayed" | "active" | "blocked" | "staged-durable-ref";
  count: number;
};

export interface MigrationInventory {
  listProjectsPage(request: MigrationPageRequest): Promise<MigrationProject[]>;
  /** Returns a stable id-ordered page of latest ReplacingMergeTree versions. */
  listStoredObjectsPage(
    projectId: string,
    request: MigrationPageRequest,
  ): Promise<StoredObject[]>;
  /**
   * Includes archived datasets: they remain recoverable customer data.
   * Per-project like the stored-objects page: the Prisma multitenancy
   * middleware rejects any Dataset query without a projectId, so a global
   * page shape is unimplementable against the real database.
   */
  listDatasetsPage(
    projectId: string,
    request: MigrationPageRequest,
  ): Promise<MigrationDataset[]>;
}

export type MigrationPageRequest = {
  afterId?: string;
  limit: number;
};

export type MigrationStorageEndpoint = {
  provider: MigrationProvider;
  scheme: "s3" | "azure-blob";
  driver: StorageDriver;
  storedObjectUri(projectId: string, sha256: string): string;
  datasetChunkUri(projectId: string, datasetId: string, index: number): string;
};

export function createMigrationStorageEndpoint({
  provider,
  driver,
  bucket,
  accountName,
  container,
}: {
  provider: MigrationProvider;
  driver: StorageDriver;
  bucket?: string;
  accountName?: string;
  container?: string;
}): MigrationStorageEndpoint {
  if (provider === "s3") {
    if (!bucket?.trim()) {
      throw new Error("S3 migration endpoint requires a bucket");
    }
    return {
      provider,
      scheme: "s3",
      driver,
      storedObjectUri: (projectId, sha256) =>
        mintS3Uri({ bucket, projectId, sha256 }),
      datasetChunkUri: (projectId, datasetId, index) =>
        `s3://${bucket}/${chunkKey(projectId, datasetId, index)}`,
    };
  }
  if (!accountName?.trim() || !container?.trim()) {
    throw new Error(
      "Azure migration endpoint requires an account name and container",
    );
  }
  return {
    provider,
    scheme: "azure-blob",
    driver,
    storedObjectUri: (projectId, sha256) =>
      mintAzureBlobUri({ accountName, container, projectId, sha256 }),
    datasetChunkUri: (projectId, datasetId, index) =>
      `azure-blob://${accountName}/${container}/${chunkKey(projectId, datasetId, index)}`,
  };
}

export type MigrationPlan = {
  eligibleStoredObjects: number;
  eligibleDatasetChunks: number;
  /**
   * Live rows whose scheme is neither the source nor the destination (e.g.
   * `file://` on a deployment that once used local storage). They are outside
   * this migration's scope — untouched, still readable through scheme
   * dispatch — but the plan must say they exist: a total that silently
   * excludes them tells the operator the migration covers more than it does.
   */
  foreignSchemeRows: number;
  foreignSchemes: string[];
  excludedProjects: string[];
  blockingDatasets: Array<{
    id: string;
    status: string;
    reason: DatasetBlockerReason;
  }>;
};

/**
 * `active-upload` — the dataset is mid-write, so its chunk set is still moving.
 * `invalid-chunk-count` — an `s3_jsonl` dataset with a null/negative
 * `chunkCount`. Reachable on any install: the direct-upload flow creates the
 * row at presign time with `contentLayout='s3_jsonl'` and fills `chunkCount`
 * only once the normalize job lands, so every abandoned upload leaves one
 * behind. Reported, never thrown from `plan` — the phase whose whole job is to
 * enumerate blockers must survive finding one.
 */
export type DatasetBlockerReason = "active-upload" | "invalid-chunk-count";

export type MigrationCopyReport = MigrationPlan & {
  copied: number;
  repaired: number;
  skippedVerified: number;
};

export type MigrationFinalizeReport = {
  destinationProvider: MigrationProvider;
  publishedStoredObjects: number;
};

export class MigrationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationBlockedError";
  }
}

type ObjectStorageMigrationDeps = {
  source: MigrationStorageEndpoint;
  destination: MigrationStorageEndpoint;
  inventory: MigrationInventory;
  /**
   * Must append a newer stored_objects version. It must never ALTER UPDATE or
   * delete the prior version.
   */
  publishStoredObject(row: StoredObject): Promise<void>;
  auditQueues(): Promise<QueueMigrationBlocker[]>;
  writesPaused(): boolean;
  readsPaused(): boolean;
  now?: () => Date;
};

type EligibleScope = {
  eligibleProjectIds: Set<string>;
  excludedProjects: string[];
};

type DatasetChunkUris = {
  sourceUri: string;
  destinationUri: string;
};

const INVENTORY_PAGE_SIZE = 250;

export class ObjectStorageMigration {
  private readonly now: () => Date;

  constructor(private readonly deps: ObjectStorageMigrationDeps) {
    if (deps.source.provider === deps.destination.provider) {
      throw new Error("Migration source and destination providers must differ");
    }
    this.now = deps.now ?? (() => new Date());
  }

  async plan(): Promise<MigrationPlan> {
    const scope = await this.eligibleScope();
    return this.buildPlan(scope);
  }

  async copy(): Promise<MigrationCopyReport> {
    const scope = await this.eligibleScope();
    const plan = await this.buildPlan(scope);
    return this.copyEligible(scope, plan);
  }

  private async copyEligible(
    scope: EligibleScope,
    plan: MigrationPlan,
  ): Promise<MigrationCopyReport> {
    const report: MigrationCopyReport = {
      ...plan,
      copied: 0,
      repaired: 0,
      skippedVerified: 0,
    };

    for await (const row of this.eligibleStoredObjects(scope)) {
      const destinationUri = this.deps.destination.storedObjectUri(
        row.project_id,
        row.sha256,
      );
      if (row.storage_uri.startsWith(`${this.deps.destination.scheme}://`)) {
        if (row.storage_uri !== destinationUri) {
          // This aborts the whole run, so it has to say WHICH row. The two
          // addresses themselves cannot go in the message: they differ only
          // in the bucket / storage account, which is exactly what
          // redactStorageUri masks, so quoting them would print two identical
          // strings. The id is what lets the operator look the row up and
          // tell a mis-set destination endpoint from real corruption.
          throw new MigrationBlockedError(
            `Stored object ${row.id} (project ${row.project_id}) already uses the ${this.deps.destination.scheme} scheme, but its recorded bucket/account is not the one configured as this migration's destination`,
          );
        }
        await assertUriDigest(
          this.deps.destination.driver,
          destinationUri,
          row.sha256,
        );
        report.skippedVerified += 1;
        continue;
      }
      const result = await copyVerified({
        source: this.deps.source,
        sourceUri: row.storage_uri,
        destination: this.deps.destination,
        destinationUri,
        expectedSha256: row.sha256,
        mediaType: row.media_type,
      });
      report[result] += 1;
    }

    for await (const chunk of this.eligibleDatasetChunks(scope)) {
      report[await this.copyDatasetChunk(chunk)] += 1;
    }
    return report;
  }

  private async *eligibleDatasetChunks(
    scope: EligibleScope,
  ): AsyncGenerator<DatasetChunkUris> {
    for await (const dataset of this.eligibleDatasets(scope)) {
      for (let index = 0; index < dataset.chunkCount; index++) {
        yield {
          sourceUri: this.deps.source.datasetChunkUri(
            dataset.projectId,
            dataset.id,
            index,
          ),
          destinationUri: this.deps.destination.datasetChunkUri(
            dataset.projectId,
            dataset.id,
            index,
          ),
        };
      }
    }
  }

  /**
   * A chunk can already live ONLY at the destination: a dataset uploaded
   * while the destination provider was briefly active (the backend-flip
   * posture #6323 documents), or a previous reverse migration. Chunks carry
   * no recorded digest, so there is no source to verify against — presence
   * at the destination is the strongest available check, and aborting would
   * deny the operator every other copy this run could safely make.
   */
  private async copyDatasetChunk({
    sourceUri,
    destinationUri,
  }: DatasetChunkUris): Promise<"copied" | "repaired" | "skippedVerified"> {
    if (!(await this.deps.source.driver.exists(sourceUri))) {
      return this.acceptDestinationOnlyChunk({ sourceUri, destinationUri });
    }
    return copyVerified({
      source: this.deps.source,
      sourceUri,
      destination: this.deps.destination,
      destinationUri,
      mediaType: "application/x-ndjson",
    });
  }

  private async acceptDestinationOnlyChunk({
    sourceUri,
    destinationUri,
  }: DatasetChunkUris): Promise<"skippedVerified"> {
    if (await this.deps.destination.driver.exists(destinationUri)) {
      return "skippedVerified";
    }
    throw new MigrationBlockedError(
      `Dataset chunk is missing from both providers: ${redactStorageUri(sourceUri)}`,
    );
  }

  async finalize(): Promise<MigrationFinalizeReport> {
    if (!this.deps.writesPaused()) {
      throw new MigrationBlockedError(
        "Finalization requires writes to be paused",
      );
    }
    if (!this.deps.readsPaused()) {
      throw new MigrationBlockedError(
        "Finalization requires read traffic to be paused",
      );
    }

    const scope = await this.eligibleScope();
    const plan = await this.buildPlan(scope);
    if (plan.blockingDatasets.length > 0) {
      const detail = plan.blockingDatasets
        .map(({ id, status, reason }) => `${id} (${status}, ${reason})`)
        .join(", ");
      throw new MigrationBlockedError(
        `Finalization blocked by datasets: ${detail}`,
      );
    }
    const queueBlockers = await this.deps.auditQueues();
    if (queueBlockers.length > 0) {
      const detail = queueBlockers
        .map(({ queueName, kind, count }) => `${queueName} ${kind}=${count}`)
        .join(", ");
      throw new MigrationBlockedError(
        `Finalization blocked by queues: ${detail}`,
      );
    }

    // A final delta copy runs only after writers stop. Every destination byte
    // is verified before any address is published.
    await this.copyEligible(scope, plan);
    await this.verifyEligible(scope);

    let publishedStoredObjects = 0;
    for await (const row of this.eligibleStoredObjects(scope)) {
      const destinationUri = this.deps.destination.storedObjectUri(
        row.project_id,
        row.sha256,
      );
      if (row.storage_uri === destinationUri) {
        continue;
      }
      const insertedAt = newerVersionTimestamp(row.inserted_at, this.now());
      await this.deps.publishStoredObject({
        ...row,
        storage_uri: destinationUri,
        inserted_at: insertedAt,
      });
      publishedStoredObjects += 1;
    }

    return {
      destinationProvider: this.deps.destination.provider,
      publishedStoredObjects,
    };
  }

  async verify(): Promise<void> {
    const scope = await this.eligibleScope();
    await this.verifyEligible(scope);
  }

  private async verifyEligible(scope: EligibleScope): Promise<void> {
    for await (const row of this.eligibleStoredObjects(scope)) {
      const destinationUri = this.deps.destination.storedObjectUri(
        row.project_id,
        row.sha256,
      );
      await assertUriDigest(
        this.deps.destination.driver,
        destinationUri,
        row.sha256,
      );
    }
    for await (const chunk of this.eligibleDatasetChunks(scope)) {
      // Mirror of the copy loop's already-at-destination tolerance: a chunk
      // with no source copy has no digest to compare, so presence at the
      // destination is the strongest check available (#6323).
      if (!(await this.deps.source.driver.exists(chunk.sourceUri))) {
        await this.acceptDestinationOnlyChunk(chunk);
        continue;
      }
      // Verification never needs the bytes resident — hash both streams.
      const sourceSha256 = await sha256OfStream(
        await this.deps.source.driver.get(chunk.sourceUri),
      );
      await assertUriDigest(
        this.deps.destination.driver,
        chunk.destinationUri,
        sourceSha256,
      );
    }
  }

  private async eligibleScope(): Promise<EligibleScope> {
    const eligibleProjectIds = new Set<string>();
    const excludedProjects: string[] = [];
    for await (const project of paginate((request) =>
      this.deps.inventory.listProjectsPage(request),
    )) {
      if (project.privateS3) {
        excludedProjects.push(project.id);
      } else {
        eligibleProjectIds.add(project.id);
      }
    }
    return {
      eligibleProjectIds,
      excludedProjects: excludedProjects.sort(),
    };
  }

  private async buildPlan(scope: EligibleScope): Promise<MigrationPlan> {
    let eligibleStoredObjects = 0;
    let eligibleDatasetChunks = 0;
    let foreignSchemeRows = 0;
    const foreignSchemes = new Set<string>();
    const blockingDatasets: MigrationPlan["blockingDatasets"] = [];
    for await (const _row of this.eligibleStoredObjects(scope, (scheme) => {
      foreignSchemeRows += 1;
      foreignSchemes.add(scheme);
    })) {
      eligibleStoredObjects += 1;
    }
    for await (const dataset of this.datasets(scope)) {
      const { id, status, contentLayout } = dataset;
      if (status === "uploading" || status === "processing") {
        blockingDatasets.push({ id, status, reason: "active-upload" });
      }
      if (contentLayout !== "s3_jsonl") continue;
      // The count tracks what `copy` will attempt, which includes a dataset
      // that is merely mid-upload: copying a moving dataset is safe because
      // finalize re-copies the delta and refuses to run while it is still
      // listed as a blocker.
      if (hasMigratableChunkCount(dataset)) {
        eligibleDatasetChunks += dataset.chunkCount;
        continue;
      }
      blockingDatasets.push({ id, status, reason: "invalid-chunk-count" });
    }
    return {
      eligibleStoredObjects,
      eligibleDatasetChunks,
      foreignSchemeRows,
      foreignSchemes: [...foreignSchemes].sort(),
      excludedProjects: scope.excludedProjects,
      blockingDatasets,
    };
  }

  /**
   * Yields rows on the source or destination scheme; anything else — a
   * `file://` row from a local-filesystem deployment, an address left by an
   * unrelated earlier migration — is out of this migration's scope. Those
   * rows are NOT touched and stay readable through scheme dispatch, but they
   * must never vanish silently: `onForeignScheme` lets `buildPlan` count and
   * name them so the operator's plan states what will not migrate.
   */
  private async *eligibleStoredObjects(
    scope: EligibleScope,
    onForeignScheme?: (scheme: string) => void,
  ): AsyncGenerator<StoredObject> {
    for (const projectId of [...scope.eligibleProjectIds].sort()) {
      for await (const row of paginate((request) =>
        this.deps.inventory.listStoredObjectsPage(projectId, request),
      )) {
        const scheme = row.storage_uri.slice(0, row.storage_uri.indexOf(":"));
        if (
          scheme === this.deps.source.scheme ||
          scheme === this.deps.destination.scheme
        ) {
          yield row;
        } else {
          onForeignScheme?.(scheme);
        }
      }
    }
  }

  private async *datasets(
    scope: EligibleScope,
  ): AsyncGenerator<MigrationDataset> {
    // Iterated per eligible project (sorted for a stable, resumable order):
    // BYOC projects are excluded by never being asked for, and every page
    // query is tenant-scoped as the data layer requires.
    for (const projectId of [...scope.eligibleProjectIds].sort()) {
      yield* paginate((request) =>
        this.deps.inventory.listDatasetsPage(projectId, request),
      );
    }
  }

  private async *eligibleDatasets(
    scope: EligibleScope,
  ): AsyncGenerator<MigrationDataset & { chunkCount: number }> {
    for await (const dataset of this.datasets(scope)) {
      if (dataset.contentLayout !== "s3_jsonl") continue;
      // Skipped rather than thrown: a dataset with no usable chunk count has
      // no derivable chunk keys, so there is nothing to copy or verify. It is
      // already reported by `plan` and already refuses finalization, so
      // aborting the whole run here would only deny the operator the copy
      // progress they can safely make first.
      if (!hasMigratableChunkCount(dataset)) continue;
      yield dataset;
    }
  }
}

async function* paginate<T extends { id: string }>(
  load: (request: MigrationPageRequest) => Promise<T[]>,
): AsyncGenerator<T> {
  let afterId: string | undefined;
  for (;;) {
    const page = await load({ afterId, limit: INVENTORY_PAGE_SIZE });
    if (page.length === 0) return;
    for (const row of page) yield row;
    const nextAfterId = page.at(-1)?.id;
    if (!nextAfterId || nextAfterId === afterId) {
      throw new Error("Migration inventory pagination did not advance");
    }
    afterId = nextAfterId;
    if (page.length < INVENTORY_PAGE_SIZE) return;
  }
}

function hasMigratableChunkCount(
  dataset: MigrationDataset,
): dataset is MigrationDataset & { chunkCount: number } {
  return dataset.chunkCount != null && dataset.chunkCount >= 0;
}

function newerVersionTimestamp(previous: Date, candidate: Date): Date {
  return new Date(Math.max(candidate.getTime(), previous.getTime() + 1));
}

async function copyVerified({
  source,
  sourceUri,
  destination,
  destinationUri,
  expectedSha256,
  mediaType,
}: {
  source: MigrationStorageEndpoint;
  sourceUri: string;
  destination: MigrationStorageEndpoint;
  destinationUri: string;
  expectedSha256?: string;
  mediaType: string;
}): Promise<"copied" | "repaired" | "skippedVerified"> {
  // The ONLY full copy held in memory: `StorageDriver.put` takes a Buffer,
  // so the source bytes must be resident to write them. Every digest below
  // hashes its stream chunk-by-chunk instead of buffering a second (or
  // third) copy alongside — peak residency is one object, not two or three.
  const sourceBytes = await readAll(await source.driver.get(sourceUri));
  const sourceSha256 = sha256(sourceBytes);
  if (expectedSha256 && sourceSha256 !== expectedSha256) {
    throw new Error(
      `Source object verification failed for ${redactStorageUri(sourceUri)}: expected ${expectedSha256}, got ${sourceSha256}`,
    );
  }
  if (await destination.driver.exists(destinationUri)) {
    const destinationSha256 = await sha256OfStream(
      await destination.driver.get(destinationUri),
    );
    if (destinationSha256 === sourceSha256) {
      return "skippedVerified";
    }
    await destination.driver.put(destinationUri, sourceBytes, mediaType);
    await assertUriDigest(destination.driver, destinationUri, sourceSha256);
    return "repaired";
  }
  await destination.driver.put(destinationUri, sourceBytes, mediaType);
  await assertUriDigest(destination.driver, destinationUri, sourceSha256);
  return "copied";
}

async function assertUriDigest(
  driver: StorageDriver,
  uri: string,
  expectedSha256: string,
): Promise<void> {
  if (!(await driver.exists(uri))) {
    throw new Error(`Destination object is missing: ${redactStorageUri(uri)}`);
  }
  const actual = await sha256OfStream(await driver.get(uri));
  if (actual !== expectedSha256) {
    throw new Error(
      `Destination object verification failed for ${redactStorageUri(uri)}: expected ${expectedSha256}, got ${actual}`,
    );
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Digest a stream chunk-by-chunk — nothing is retained beyond the hash state. */
async function sha256OfStream(stream: Readable): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
