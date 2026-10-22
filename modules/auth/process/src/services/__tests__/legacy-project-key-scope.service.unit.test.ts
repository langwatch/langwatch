/**
 * What a legacy project key holds: the ingestion permission by its class, anything else only on
 * its own project's `legacy_project_key_full_access` read.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LegacyProjectKeyScopeService } from "../legacy-project-key-scope.service.ts";

const PROJECT = { id: "project-1", organizationId: "org-1" };

function scope({ fullAccess }: { fullAccess: boolean }) {
  const reads: Parameters<FeatureFlagApi["isEnabled"]>[] = [];
  const service = LegacyProjectKeyScopeService.create({
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (...read) => {
        reads.push(read);
        return fullAccess;
      },
    }),
  });

  return { service, reads };
}

describe("given a legacy project key", () => {
  describe("when it is asked traces:create", () => {
    /** @scenario "The ingestion permission never reads the full-access flag" */
    it("holds it without reading the flag", async () => {
      const { service, reads } = scope({ fullAccess: false });

      await expect(service.holds({ project: PROJECT, permission: "traces:create" })).resolves.toBe(
        true,
      );
      expect(reads).toEqual([]);
    });
  });

  describe("when it is asked a permission beyond ingestion", () => {
    /** @scenario "The full-access flag is read for the key's own project" */
    it("reads the flag for its project and organization and answers what it says", async () => {
      const off = scope({ fullAccess: false });
      const on = scope({ fullAccess: true });

      await expect(
        off.service.holds({ project: PROJECT, permission: "prompts:view" }),
      ).resolves.toBe(false);
      await expect(
        on.service.holds({ project: PROJECT, permission: "prompts:view" }),
      ).resolves.toBe(true);
      expect(off.reads).toEqual([
        [
          "legacy_project_key_full_access",
          { kind: "project", projectId: "project-1", organizationId: "org-1" },
        ],
      ]);
    });
  });

  describe("when a route asks it nothing", () => {
    /** @scenario "A legacy project key is refused a project route that asks no permission" */
    it("is refused with the ingestion-only code unless its project has full access", async () => {
      await expect(
        scope({ fullAccess: false }).service.assertMayIdentify(PROJECT),
      ).rejects.toMatchObject({ code: "legacy_project_key_ingestion_only", httpStatus: 403 });
      await expect(scope({ fullAccess: true }).service.assertMayIdentify(PROJECT)).resolves.toBe(
        undefined,
      );
    });
  });
});
