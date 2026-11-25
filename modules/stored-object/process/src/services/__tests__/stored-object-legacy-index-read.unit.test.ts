import { ClickHouseQueryClient, TenantGuard, type QueryDriver } from "@langwatch/clickhouse-client";
import type { ObjectStorage } from "@langwatch/process-stores/members";
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  ClickHouseStoredObjectsRepository,
  RoutedStoredObjectsClickHouse,
} from "../../repositories/clickhouse/stored-objects.repository.ts";
import { ObjectStorageStoredObjectLegacyStorageRepository } from "../../repositories/object-storage/object-storage.stored-object-legacy-storage.repository.ts";
import type { StoredObjectsRepository } from "../../repositories/stored-objects.repository.ts";
import { StoredObjectFileReadService } from "../stored-object-file-read.service.ts";
import { StoredObjectsTelemetryService } from "../stored-objects-telemetry.service.ts";
import { StoredObjectsService } from "../stored-objects.service.ts";

const PROJECT = "project-1";

/** A ClickHouse that holds no row, behind the real tenant guard. */
const emptyDriver: QueryDriver = {
  execute: async () => ({ rows: [] }),
  insert: async () => undefined,
  command: async () => undefined,
};

function readServiceOverLegacyIndex(): StoredObjectFileReadService {
  const legacyStorage = ObjectStorageStoredObjectLegacyStorageRepository.create(
    createApiFixture<ObjectStorage>({}),
  );
  const files = StoredObjectsService.create({
    repository: ClickHouseStoredObjectsRepository.create(
      RoutedStoredObjectsClickHouse.create(
        new ClickHouseQueryClient({ driver: emptyDriver, tenantGuard: new TenantGuard() }),
      ),
    ),
    registry: (projectId) => legacyStorage.forProject(projectId),
    telemetry: StoredObjectsTelemetryService.create(),
  });

  return StoredObjectFileReadService.create({
    countRead: async () => ({ allowed: true, resetAt: 0 }),
    assertProjectPermission: async () => undefined,
    isRecorded: async () => false,
    resolveOwner: async () => ({ projectId: PROJECT }),
    readById: (input) => files.getById(input),
  });
}

describe("given the legacy stored_objects index is read through the tenant guard", () => {
  describe("when the byte door reads an id that the index does not hold", () => {
    /** @scenario "An unknown id on the legacy ClickHouse index answers not found, not unavailable" */
    it("fails as stored_object_not_found, not as an unavailable store", async () => {
      const read = readServiceOverLegacyIndex().read({
        caller: { apiKeyProjectId: PROJECT },
        id: "unknown-id",
        claimedProjectId: PROJECT,
      });

      await expect(read).rejects.toMatchObject({ code: "stored_object_not_found" });
    });
  });
});

describe("given the legacy index holds a row for an object", () => {
  describe("when its row alone is asked for", () => {
    /** @scenario "Probing an object or minting its read URL opens none of its bytes" */
    it("answers the purpose and owner kind without asking storage for anything", async () => {
      const nothingStored = ObjectStorageStoredObjectLegacyStorageRepository.create(
        createApiFixture<ObjectStorage>({}),
      );
      const files = StoredObjectsService.create({
        repository: createApiFixture<StoredObjectsRepository>({
          tryFindById: async () => ({
            id: "so_legacy",
            project_id: PROJECT,
            purpose: "trace_content",
            owner_kind: "trace",
            owner_id: "trace-1",
            media_type: "audio/mpeg",
            size_bytes: 3,
            sha256: "a".repeat(64),
            storage_uri: "s3://bucket/project-1/so_legacy",
            created_at: new Date("2026-01-01T00:00:00Z"),
            inserted_at: new Date("2026-01-01T00:00:00Z"),
          }),
        }),
        registry: (projectId) => nothingStored.forProject(projectId),
        telemetry: StoredObjectsTelemetryService.create(),
      });

      await expect(
        files.findRowById({ projectId: PROJECT, id: "so_legacy" }),
      ).resolves.toMatchObject({ purpose: "trace_content", owner_kind: "trace" });
    });
  });
});
