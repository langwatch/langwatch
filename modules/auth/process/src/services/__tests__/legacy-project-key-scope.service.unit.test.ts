/**
 * What a legacy project key holds: the ingestion permission by its class, anything else only on
 * a scope flag the route names or `legacy_project_key_full_access`, read for its own project.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { LEGACY_PROJECT_KEY_SCOPE_FLAGS } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import { pickFlagDefinition, type FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LegacyProjectKeyScopeService } from "../legacy-project-key-scope.service.ts";

const PROJECT = { id: "project-1", organizationId: "org-1" };
const TARGET = { kind: "project", projectId: "project-1", organizationId: "org-1" };
const FULL_ACCESS = "legacy_project_key_full_access";
const PROMPTS_READ = "legacy_project_key_prompts_read";

/** `enabled` names the flags whose rule lists the project. */
function scope({ enabled }: { enabled: readonly string[] }) {
  const reads: Parameters<FeatureFlagApi["isEnabled"]>[] = [];
  const service = LegacyProjectKeyScopeService.create({
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (...read) => {
        reads.push(read);
        return enabled.includes(read[0]);
      },
    }),
  });

  return { service, reads };
}

const BEYOND_INGESTION: readonly AuthzPermission[] = [
  "prompts:view",
  "traces:view",
  "scenarios:manage",
  "project:view",
  "organization:manage",
];

describe("given a legacy project key", () => {
  describe("when it is asked traces:create", () => {
    /** @scenario "The ingestion permission never reads the full-access flag" */
    it("holds it without reading any flag", async () => {
      const { service, reads } = scope({ enabled: [] });

      await expect(service.holds({ project: PROJECT, permission: "traces:create" })).resolves.toBe(
        true,
      );
      expect(reads).toEqual([]);
    });
  });

  describe("when the route names no scope flag", () => {
    /** @scenario "The full-access flag is read for the key's own project" */
    it("reads the full-access flag for its project and organization", async () => {
      const off = scope({ enabled: [] });
      const on = scope({ enabled: [FULL_ACCESS] });

      await expect(
        off.service.holds({ project: PROJECT, permission: "prompts:view" }),
      ).resolves.toBe(false);
      await expect(
        on.service.holds({ project: PROJECT, permission: "prompts:view" }),
      ).resolves.toBe(true);
      expect(off.reads).toEqual([[FULL_ACCESS, TARGET]]);
    });

    /** @scenario "A route that names no scope flag reads only the full-access flag" */
    it.each(BEYOND_INGESTION)(
      "does not hold %s even when every scope flag lists the project",
      async (permission) => {
        const { service, reads } = scope({ enabled: LEGACY_PROJECT_KEY_SCOPE_FLAGS });

        await expect(service.holds({ project: PROJECT, permission })).resolves.toBe(false);
        expect(reads).toEqual([[FULL_ACCESS, TARGET]]);
      },
    );
  });

  describe("when the route names the prompts-read flag", () => {
    /** @scenario "Only the scope flags the route names are read" */
    it("reads that flag, then full access, and no other scope flag", async () => {
      const off = scope({ enabled: [] });
      const on = scope({ enabled: [PROMPTS_READ] });
      const asked = {
        project: PROJECT,
        permission: "prompts:view" as const,
        routeScopes: [PROMPTS_READ],
      };

      await expect(off.service.holds(asked)).resolves.toBe(false);
      await expect(on.service.holds(asked)).resolves.toBe(true);
      expect(off.reads).toEqual([
        [PROMPTS_READ, TARGET],
        [FULL_ACCESS, TARGET],
      ]);
      expect(on.reads).toEqual([[PROMPTS_READ, TARGET]]);
    });

    it("refuses a scope name that is not a scope flag", async () => {
      await expect(
        scope({ enabled: [] }).service.holds({
          project: PROJECT,
          permission: "prompts:view",
          routeScopes: ["legacy_project_key_everything"],
        }),
      ).rejects.toThrow(/Invalid option/);
    });
  });

  describe("when its project is on the full-access flag only", () => {
    /** @scenario "Full access holds every permission" */
    it.each(BEYOND_INGESTION)("holds %s on any route", async (permission) => {
      const { service } = scope({ enabled: [FULL_ACCESS] });

      await expect(service.holds({ project: PROJECT, permission })).resolves.toBe(true);
      await expect(
        service.holds({ project: PROJECT, permission, routeScopes: [PROMPTS_READ] }),
      ).resolves.toBe(true);
    });
  });

  describe("when a route asks it nothing", () => {
    /** @scenario "A legacy project key is refused a project route that asks no permission" */
    it("is refused with the ingestion-only code unless its project has full access", async () => {
      await expect(
        scope({ enabled: LEGACY_PROJECT_KEY_SCOPE_FLAGS }).service.assertMayIdentify(PROJECT),
      ).rejects.toMatchObject({ code: "legacy_project_key_ingestion_only", httpStatus: 403 });
      await expect(
        scope({ enabled: [FULL_ACCESS] }).service.assertMayIdentify(PROJECT),
      ).resolves.toBe(undefined);
    });
  });
});

describe("the scope flag list", () => {
  /** @scenario "Every scope flag is a registered feature flag" */
  it("names only registered product flags that are off by default", () => {
    for (const flag of LEGACY_PROJECT_KEY_SCOPE_FLAGS) {
      expect(pickFlagDefinition(flag)).toMatchObject({
        key: flag,
        scope: "PRODUCT",
        defaultValue: false,
      });
    }
  });
});
