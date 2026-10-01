import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Logger } from "@langwatch/observability";
import type { Encryption, ObjectStorage } from "@langwatch/process-stores/members";
import { StoredObjectNotFoundError } from "@langwatch/stored-object-contract";
/**
 * @see specs/features/stored-object-legacy-id-only-owner.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { buildStoredObjectInfrastructure } from "../stored-object-composition.build.ts";

describe("given the API process opened no ClickHouse endpoint", () => {
  describe("when a delivery names a stored object by its id alone", () => {
    /** @scenario "An id-only URL on a deployment with no owner directory resolves to nothing" */
    it("resolves to no project and says no owner directory was composed", async () => {
      const warnings: unknown[][] = [];
      const infrastructure = buildStoredObjectInfrastructure({
        members: {
          clickhouse: createApiFixture<ClickHouseQueryClient>({}),
          logger: createApiFixture<Logger>({
            warn: (...args: unknown[]) => void warnings.push(args),
          }),
          objectStorage: createApiFixture<ObjectStorage>({}),
          encryption: createApiFixture<Encryption>({}),
          publicBaseUrl: "https://app.example",
        },
      });

      await expect(infrastructure.owners.getOwner({ id: "so_legacy" })).rejects.toBeInstanceOf(
        StoredObjectNotFoundError,
      );
      expect(warnings).toEqual([
        [
          { storedObjectId: "so_legacy" },
          expect.stringContaining("composed no stored-object owner directory"),
        ],
      ]);
    });
  });
});
