import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ClickHouseImportStoredObjectMigration } from "../migrations/clickhouse-import.stored-object.migration.ts";
import { MemoryStoredObjectRecordRepository } from "../repositories/memory/memory.stored-object-record.repository.ts";
import {
  type LegacyStoredObjectRow,
  StoredObjectLegacySourceRepository,
} from "../repositories/stored-object-legacy-source.repository.ts";

class OneLegacyObject extends StoredObjectLegacySourceRepository {
  constructor(private readonly storageUri = "s3://bucket/project_1/so_legacy") {
    super();
  }

  async findPage(input: { afterId?: string }): Promise<readonly LegacyStoredObjectRow[]> {
    if (input.afterId) return [];
    return [
      {
        id: "so_legacy",
        projectId: "project_1",
        purpose: "trace_content",
        ownerKind: "trace",
        ownerId: "trace_1",
        mediaType: "application/octet-stream",
        sizeBytes: 3,
        sha256: "a".repeat(64),
        storageUri: this.storageUri,
        createdAt: Temporal.Instant.from("2026-08-21T00:00:00.000Z"),
        insertedAt: Temporal.Instant.from("2026-08-21T00:01:00.000Z"),
      },
    ];
  }
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
