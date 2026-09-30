/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { ClickHouseQueryClient, TenantGuard, type QueryDriver } from "@langwatch/clickhouse-client";
import type { Logger } from "@langwatch/observability";
import type { Encryption, ObjectStorage } from "@langwatch/process-stores/members";
import { describe, expect, it } from "vitest";

import { buildStoredObjectInfrastructure } from "#app/stored-object-composition.build";
import { StoredObjectFileReadService } from "#services/stored-object-file-read.service";

const PROJECT = "project-1";

/** A ClickHouse that holds no row, behind the real tenant guard. */
const emptyDriver: QueryDriver = {
  execute: async () => ({ rows: [] }),
  insert: async () => undefined,
  command: async () => undefined,
};

function readServiceOverLegacyIndex(): StoredObjectFileReadService {
  const { files } = buildStoredObjectInfrastructure({
    members: {
      clickhouse: new ClickHouseQueryClient({
        driver: emptyDriver,
        tenantGuard: new TenantGuard(),
      }),
      logger: createApiFixture<Logger>({}),
      objectStorage: createApiFixture<ObjectStorage>({}),
      encryption: createApiFixture<Encryption>({}),
      publicBaseUrl: undefined,
    },
  });

  return StoredObjectFileReadService.create({
    countRead: async () => ({ allowed: true, resetAt: 0 }),
    assertProjectPermission: async () => undefined,
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
