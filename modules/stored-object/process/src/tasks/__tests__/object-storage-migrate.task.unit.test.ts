/**
 * @vitest-environment node
 * Spec: specs/migration/object-storage-provider-migration.feature
 */
import type { Readable } from "node:stream";
import { Readable as ReadableStream } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { ObjectStorageMigrationInventoryRepository } from "#repositories/object-storage-migration-inventory.repository";
import type { StoredObjectBlobRepository } from "#repositories/stored-object-blob.repository";

import { createMigrationStorageEndpoint } from "../../rules/object-storage-migration-transfer.rules.ts";
import { ObjectStorageMigrationService } from "../../services/object-storage-migration.service.ts";
import {
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
} from "../object-storage-migrate.task.ts";

class RecordingDriver implements StoredObjectBlobRepository {
  readonly calls: string[] = [];

  async get(uri: string): Promise<Readable> {
    this.calls.push(`get ${uri}`);
    return ReadableStream.from(Buffer.alloc(0));
  }

  async put(uri: string): Promise<void> {
    this.calls.push(`put ${uri}`);
  }

  async delete(uri: string): Promise<void> {
    this.calls.push(`delete ${uri}`);
  }

  async exists(uri: string): Promise<boolean> {
    this.calls.push(`exists ${uri}`);
    return false;
  }
}

const migrationEnvironment = (): NodeJS.ProcessEnv => ({
  OBJECT_STORAGE_MIGRATION_SOURCE_PROVIDER: "s3",
  OBJECT_STORAGE_MIGRATION_TARGET_PROVIDER: "azure",
  OBJECT_STORAGE_MIGRATION_WRITES_PAUSED: "1",
  OBJECT_STORAGE_MIGRATION_READS_PAUSED: "1",
  OBJECT_STORAGE_MIGRATION_S3_BUCKET: "source",
  OBJECT_STORAGE_MIGRATION_S3_REGION: "eu-west-1",
  OBJECT_STORAGE_MIGRATION_AZURE_ACCOUNT_NAME: "destination",
  OBJECT_STORAGE_MIGRATION_AZURE_CONTAINER: "langwatch",
  OBJECT_STORAGE_MIGRATION_AZURE_AUTH_MODE: "sharedKey",
  OBJECT_STORAGE_MIGRATION_AZURE_ACCOUNT_KEY: "content-marker",
});

const ACTIVE_S3 = { STORED_OBJECTS_BACKEND: "s3", S3_BUCKET_NAME: "source" };
const ACTIVE_AZURE = {
  STORED_OBJECTS_BACKEND: "azure",
  AZURE_BLOB_ACCOUNT_NAME: "destination",
  AZURE_BLOB_CONTAINER: "langwatch",
};

const setup = (activeEnvironment: NodeJS.ProcessEnv) => {
  const sourceDriver = new RecordingDriver();
  const destinationDriver = new RecordingDriver();
  const published: string[] = [];
  const findProjectsPage = vi.fn(async () => []);
  const inventory: ObjectStorageMigrationInventoryRepository = {
    findProjectsPage,
    findStoredObjectsPage: vi.fn(async () => []),
    findDatasetsPage: vi.fn(async () => []),
  };
  const service = ObjectStorageMigrationService.create({
    source: createMigrationStorageEndpoint({
      provider: "s3",
      driver: sourceDriver,
      bucket: "source",
    }),
    destination: createMigrationStorageEndpoint({
      provider: "azure",
      driver: destinationDriver,
      accountName: "destination",
      container: "langwatch",
    }),
    inventory,
    publishStoredObject: async (row) => {
      published.push(row.id);
    },
    auditQueues: async () => [],
    writesPaused: () => true,
    readsPaused: () => true,
  });
  const migration = vi.fn(() => service);
  const task = ObjectStorageMigrateTask.create({
    migration,
    config: parseMigrationTaskConfig(migrationEnvironment()),
    activeEnvironment,
  });
  const run = (phase: string) => task.run({ args: [phase], signal: new AbortController().signal });
  const nothingMoved = () => ({
    sourceCalls: sourceDriver.calls,
    destinationCalls: destinationDriver.calls,
    published,
    inventoryReads: findProjectsPage.mock.calls.length,
    migrationBuilt: migration.mock.calls.length,
  });
  return { run, nothingMoved, inventory };
};

const NOTHING_MOVED = {
  sourceCalls: [],
  destinationCalls: [],
  published: [],
  inventoryReads: 0,
  migrationBuilt: 0,
};

describe("ObjectStorageMigrateTask", () => {
  describe("given the active provider is not the one the phase expects", () => {
    /** @scenario A phase run against the wrong active provider is refused before any object moves */
    it.each([
      { phase: "plan", active: ACTIVE_AZURE, message: /plan expects s3.*but azure is active/ },
      { phase: "copy", active: ACTIVE_AZURE, message: /copy expects s3.*but azure is active/ },
      {
        phase: "finalize",
        active: ACTIVE_AZURE,
        message: /finalize expects s3.*but azure is active/,
      },
      { phase: "verify", active: ACTIVE_S3, message: /verify expects azure.*but s3 is active/ },
    ])("refuses $phase before any object moves", async ({ phase, active, message }) => {
      const { run, nothingMoved } = setup(active);

      await expect(run(phase)).rejects.toThrow(message);

      expect(nothingMoved()).toEqual(NOTHING_MOVED);
    });
  });

  describe("given the active storage is a different bucket than the migration's source", () => {
    /** @scenario A phase whose active storage is a different bucket than the migration names is refused */
    it("refuses copy, naming the bucket the migration expects", async () => {
      const { run, nothingMoved } = setup({
        STORED_OBJECTS_BACKEND: "s3",
        S3_BUCKET_NAME: "another-bucket",
      });

      await expect(run("copy")).rejects.toThrow(/expects active S3 bucket "source"/);

      expect(nothingMoved()).toEqual(NOTHING_MOVED);
    });
  });

  describe("given the active provider is the one the phase expects", () => {
    /** @scenario A phase run against the matching active provider proceeds */
    it.each([
      { phase: "copy", active: ACTIVE_S3 },
      { phase: "verify", active: ACTIVE_AZURE },
    ])("runs the $phase phase", async ({ phase, active }) => {
      const { run, nothingMoved } = setup(active);

      await run(phase);

      expect(nothingMoved().inventoryReads).toBe(1);
    });
  });
});
