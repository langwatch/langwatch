import type { Logger } from "@langwatch/observability";
import { StoredObjectNotFoundError } from "@langwatch/stored-object-contract";
/**
 * @see specs/features/stored-object-legacy-id-only-owner.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { StoredObjectOwnerUnresolvedService } from "../stored-object-owner-unresolved.service.ts";

describe("given the API process opened no ClickHouse endpoint", () => {
  describe("when a delivery names a stored object by its id alone", () => {
    /** @scenario "An id-only URL on a deployment with no owner directory resolves to nothing" */
    it("resolves to no project and says no owner directory was composed", async () => {
      const warnings: unknown[][] = [];
      const owners = StoredObjectOwnerUnresolvedService.create({
        logger: createApiFixture<Logger>({
          warn: (...args: unknown[]) => void warnings.push(args),
        }),
      });

      await expect(owners.getOwner({ id: "so_legacy" })).rejects.toBeInstanceOf(
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
