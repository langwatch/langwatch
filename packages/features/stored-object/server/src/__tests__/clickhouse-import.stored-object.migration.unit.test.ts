import { describe, expect, it } from "vitest";
import {
  ClickHouseImportStoredObjectMigration,
  StoredObjectLegacyLocationPort,
  StoredObjectLegacySourcePort,
  StoredObjectLegacyWriterDrainPort,
  StoredObjectProjectSourcePort,
} from "../index.ts";
import { InMemoryStoredObjectStore } from "../testing.ts";
import { Temporal } from "@langwatch/time";

class OneProject extends StoredObjectProjectSourcePort {
  async listForOrganization() {
    return [{ id: "project_1" }];
  }
}

class OneLegacyObject extends StoredObjectLegacySourcePort {
  async findPage(input: { afterId?: string }) {
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
        storageUri: "s3://bucket/project_1/so_legacy",
        createdAt: Temporal.Instant.from("2026-08-21T00:00:00.000Z"),
        insertedAt: Temporal.Instant.from("2026-08-21T00:01:00.000Z"),
      },
    ];
  }
}

class LegacyLocations extends StoredObjectLegacyLocationPort {
  parse() {
    return {
      provider: "s3",
      destinationId: "bucket",
      relativeId: "project_1/so_legacy",
    };
  }
}

class ProvedDrain extends StoredObjectLegacyWriterDrainPort {
  async get() {
    return {
      valid: true as const,
      minimumWriterGeneration: "2026.08.22",
      assertedAt: Temporal.Instant.from("2026-08-22T00:00:00.000Z"),
    };
  }
}

class DrainBecomesValidAfterFirstScan extends StoredObjectLegacyWriterDrainPort {
  private calls = 0;
  async get() {
    this.calls += 1;
    return this.calls === 1
      ? { valid: false as const, reason: "writers active" }
      : {
          valid: true as const,
          minimumWriterGeneration: "2026.08.22",
          assertedAt: Temporal.Instant.from("2026-08-22T00:00:00.000Z"),
        };
  }
}

function newMigration() {
  return ClickHouseImportStoredObjectMigration.create({
    projects: new OneProject(),
    legacy: new OneLegacyObject(),
    locations: new LegacyLocations(),
    drain: new ProvedDrain(),
    store: InMemoryStoredObjectStore.create(),
  });
}

describe("ClickHouseImportStoredObjectMigration", () => {
  describe("when the runner reads its declaration", () => {
    it("registers for automatic startup completion", () => {
      const declared = newMigration();

      // The state table's key. Renaming it orphans every stored record.
      expect(declared.name).toBe("stored-objects-clickhouse-import-v0");
      expect(declared.requiresOperatorConfirmation).toBe(false);
      expect(declared.runsAutomaticallyOnSelfHosted).toBe(true);
      expect(declared.enrolledAutomatically).toBe(true);
    });
  });

  it("imports directly into the one row store through system migrations", async () => {
    const store = InMemoryStoredObjectStore.create();
    const migration = ClickHouseImportStoredObjectMigration.create({
      projects: new OneProject(),
      legacy: new OneLegacyObject(),
      locations: new LegacyLocations(),
      drain: new ProvedDrain(),
      store,
    });

    await expect(migration.migrateTenant({ tenantId: "organization_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { imported: 1, drainProved: true },
    });
    await expect(store.tryFind({ tenantId: "project_1", id: "so_legacy" })).resolves.toMatchObject({
      status: "available",
      source: "imported",
      audiences: ["traces:view"],
    });
    await expect(migration.migrateTenant({ tenantId: "organization_1" })).resolves.toMatchObject({
      status: "finalized",
      report: { imported: 0, unchanged: 1, drainProved: true },
    });
  });

  it("holds the first scan when the writer drain becomes valid during it", async () => {
    const migration = ClickHouseImportStoredObjectMigration.create({
      projects: new OneProject(),
      legacy: new OneLegacyObject(),
      locations: new LegacyLocations(),
      drain: new DrainBecomesValidAfterFirstScan(),
      store: InMemoryStoredObjectStore.create(),
    });
    const first = await migration.migrateTenant({ tenantId: "org_1" });
    expect(first.status).toBe("migrated");
    const second = await migration.migrateTenant({ tenantId: "org_1" });
    expect(second.status).toBe("finalized");
  });
});
