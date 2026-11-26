import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ClickHouseImportStoredObjectMigration } from "../migrations/clickhouse-import.stored-object.migration.ts";
import { MemoryStoredObjectRecordRepository } from "../repositories/memory/memory.stored-object-record.repository.ts";
import {
  type LegacyStoredObjectRow,
  StoredObjectLegacySourceRepository,
} from "../repositories/stored-object-legacy-source.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";

class OneLegacyObject extends StoredObjectLegacySourceRepository {
  sizeBytes = 3;

  constructor(
    private readonly storageUri = "s3://bucket/project_1/so_legacy",
    private readonly purpose = "trace_content",
  ) {
    super();
  }

  async findPage(input: { afterId?: string }): Promise<readonly LegacyStoredObjectRow[]> {
    if (input.afterId) return [];
    return [
      {
        id: "so_legacy",
        projectId: "project_1",
        purpose: this.purpose,
        ownerKind: "trace",
        ownerId: "trace_1",
        mediaType: "application/octet-stream",
        sizeBytes: this.sizeBytes,
        sha256: "a".repeat(64),
        storageUri: this.storageUri,
        createdAt: Temporal.Instant.from("2026-08-21T00:00:00.000Z"),
        insertedAt: Temporal.Instant.from("2026-08-21T00:01:00.000Z"),
      },
    ];
  }
}

/** The memory twin, with a delete landing between the import's read of a row and its write. */
function deleteLandsAfterRead(
  records: MemoryStoredObjectRecordRepository,
): StoredObjectRecordRepository {
  return racingAfterRead({
    records,
    race: async (read) => {
      if (read?.status !== "available") return;
      const deleted = { ...read, status: "deleted" as const, generation: read.generation + 1 };
      await records.transition({ expected: read, next: deleted });
    },
  });
}

/**
 * The memory twin, with another run of the import creating the row between this run's read and
 * its write, and a delete then removing it, as when a stalled run outlives its lease.
 */
function anotherRunCreatesAfterRead({
  records,
  legacy,
}: {
  records: MemoryStoredObjectRecordRepository;
  legacy: StoredObjectLegacySourceRepository;
}): StoredObjectRecordRepository {
  return racingAfterRead({
    records,
    race: async (read) => {
      if (read !== null) return;
      await ClickHouseImportStoredObjectMigration.create({ legacy, records })
        .step()
        .migrateTenant({ tenantId: "project_1" });
      const created = await records.findById({ tenantId: "project_1", id: "so_legacy" });
      if (!created) throw new Error("the other run created nothing");
      const deleted = {
        ...created,
        status: "deleted" as const,
        generation: created.generation + 1,
      };
      await records.transition({ expected: created, next: deleted });
    },
  });
}

/** The memory twin, running `race` after each read and before handing the read back. */
function racingAfterRead({
  records,
  race,
}: {
  records: MemoryStoredObjectRecordRepository;
  race: (read: StoredObjectRecord | null) => Promise<void>;
}): StoredObjectRecordRepository {
  return {
    findById: async (input) => {
      const read = await records.findById(input);
      await race(read);
      return read;
    },
    upsert: (value) => records.upsert(value),
    insert: (value) => records.insert(value),
    transition: (input) => records.transition(input),
    countActive: (input) => records.countActive(input),
    findPage: (input) => records.findPage(input),
    findPageByPurpose: (input) => records.findPageByPurpose(input),
    findTenantsWithExpiredUploads: (input) => records.findTenantsWithExpiredUploads(input),
    delete: (input) => records.delete(input),
    findReusable: (input) => records.findReusable(input),
    markDeletedIfUnheld: (input) => records.markDeletedIfUnheld(input),
    addAudience: (input) => records.addAudience(input),
  };
}

describe("ClickHouseImportStoredObjectMigration.step", () => {
  /** @scenario "The Stored Objects import waits until no old image serves" */
  it("declares a per-project tenant step that waits for old writers to leave", () => {
    const step = ClickHouseImportStoredObjectMigration.create({
      legacy: new OneLegacyObject(),
      records: MemoryStoredObjectRecordRepository.create(),
    }).step();

    expect(step).toMatchObject({
      id: "stored-object:import-clickhouse-index",
      kind: "tenant",
      mode: "background",
      tenants: "project",
      needsOldWritersGone: true,
      requiresOperatorConfirmation: false,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
    });
  });

  /** @scenario "The Stored Objects import copies one project's latest legacy rows" */
  it("copies the project's legacy row into the row store at its legacy location", async () => {
    const records = MemoryStoredObjectRecordRepository.create();
    const step = ClickHouseImportStoredObjectMigration.create({
      legacy: new OneLegacyObject(),
      records,
    }).step();

    await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { kind: "stored_objects_imported", scanned: 1, imported: 1 },
    });
    await expect(
      records.findById({ tenantId: "project_1", id: "so_legacy" }),
    ).resolves.toMatchObject({
      status: "available",
      source: "imported",
      audiences: ["traces:view"],
      storage: { provider: "s3", destinationId: "bucket", relativeId: "project_1/so_legacy" },
    });
  });

  it.each([
    ["dataset_attachment", "datasets:view"],
    ["user_avatar", "project:view"],
  ])("imports a legacy %s row with the %s audience", async (purpose, audience) => {
    const records = MemoryStoredObjectRecordRepository.create();
    const step = ClickHouseImportStoredObjectMigration.create({
      legacy: new OneLegacyObject("s3://bucket/project_1/so_legacy", purpose),
      records,
    }).step();

    await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { scanned: 1, imported: 1 },
    });
    await expect(
      records.findById({ tenantId: "project_1", id: "so_legacy" }),
    ).resolves.toMatchObject({ purpose, audiences: [audience] });
  });

  /** @scenario "A second Stored Objects import of a project changes nothing" */
  it("reports the row unchanged on a second run", async () => {
    const step = ClickHouseImportStoredObjectMigration.create({
      legacy: new OneLegacyObject(),
      records: MemoryStoredObjectRecordRepository.create(),
    }).step();

    await step.migrateTenant({ tenantId: "project_1" });

    await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { imported: 0, unchanged: 1 },
    });
  });

  /** @scenario "A Stored Objects import copies again a legacy row that changed" */
  it("copies a changed legacy row again under a new generation", async () => {
    const legacy = new OneLegacyObject();
    const records = MemoryStoredObjectRecordRepository.create();
    const step = ClickHouseImportStoredObjectMigration.create({ legacy, records }).step();
    await step.migrateTenant({ tenantId: "project_1" });
    const first = await records.findById({ tenantId: "project_1", id: "so_legacy" });
    if (!first) throw new Error("the first pass imported nothing");
    expect(first.byteLength).toBe(3);

    legacy.sizeBytes = 4;

    await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { imported: 1, unchanged: 0 },
    });
    await expect(
      records.findById({ tenantId: "project_1", id: "so_legacy" }),
    ).resolves.toMatchObject({ byteLength: 4, generation: first.generation + 1 });
  });

  describe("when another run creates the row between this run's read and its write", () => {
    /** @scenario "A Stored Objects import never writes over a row another run created" */
    it("reports the row unchanged and leaves it as the other run and a delete left it", async () => {
      const legacy = new OneLegacyObject();
      const records = MemoryStoredObjectRecordRepository.create();
      const step = ClickHouseImportStoredObjectMigration.create({
        legacy,
        records: anotherRunCreatesAfterRead({ records, legacy }),
      }).step();

      await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
        status: "finalized",
        report: { imported: 0, unchanged: 1 },
      });
      await expect(
        records.findById({ tenantId: "project_1", id: "so_legacy" }),
      ).resolves.toMatchObject({ status: "deleted" });
    });
  });

  /** @scenario "A Stored Objects import leaves a row another writer moved" */
  it("reports a row a delete moved after the read unchanged and leaves it deleted", async () => {
    const legacy = new OneLegacyObject();
    const records = MemoryStoredObjectRecordRepository.create();
    await ClickHouseImportStoredObjectMigration.create({ legacy, records })
      .step()
      .migrateTenant({ tenantId: "project_1" });
    const deletedGeneration =
      ((await records.findById({ tenantId: "project_1", id: "so_legacy" }))?.generation ?? 0) + 1;
    legacy.sizeBytes = 4;
    const step = ClickHouseImportStoredObjectMigration.create({
      legacy,
      records: deleteLandsAfterRead(records),
    }).step();

    await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { imported: 0, unchanged: 1 },
    });
    await expect(
      records.findById({ tenantId: "project_1", id: "so_legacy" }),
    ).resolves.toMatchObject({ status: "deleted", byteLength: 3, generation: deletedGeneration });
  });

  describe("when the import runs again after a delete, and the legacy row changed since", () => {
    /** @scenario "A Stored Objects import never brings a deleted row back" */
    it("leaves the row deleted and reports it unchanged", async () => {
      const legacy = new OneLegacyObject();
      const records = MemoryStoredObjectRecordRepository.create();
      const step = ClickHouseImportStoredObjectMigration.create({ legacy, records }).step();
      await step.migrateTenant({ tenantId: "project_1" });
      const imported = await records.findById({ tenantId: "project_1", id: "so_legacy" });
      if (!imported) throw new Error("the first pass imported nothing");
      const deleted = {
        ...imported,
        status: "deleted" as const,
        generation: imported.generation + 1,
      };
      await records.transition({ expected: imported, next: deleted });
      legacy.sizeBytes = 4;

      await expect(step.migrateTenant({ tenantId: "project_1" })).resolves.toMatchObject({
        status: "finalized",
        report: { imported: 0, unchanged: 1 },
      });
      await expect(
        records.findById({ tenantId: "project_1", id: "so_legacy" }),
      ).resolves.toMatchObject({
        status: "deleted",
        byteLength: 3,
        generation: deleted.generation,
      });
    });
  });

  /** @scenario "A legacy row stored outside its project fails the Stored Objects import" */
  it("refuses a row whose location is outside its project and writes nothing", async () => {
    const records = MemoryStoredObjectRecordRepository.create();
    const step = ClickHouseImportStoredObjectMigration.create({
      legacy: new OneLegacyObject("s3://bucket/project_2/so_legacy"),
      records,
    }).step();

    await expect(step.migrateTenant({ tenantId: "project_1" })).rejects.toThrow(
      "Legacy Stored Object location is outside its project",
    );
    await expect(records.findById({ tenantId: "project_1", id: "so_legacy" })).resolves.toBeNull();
  });
});
