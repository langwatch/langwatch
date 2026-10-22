/**
 * What a legacy project key holds: the ingestion permission by its class, anything else only on
 * the scope flags that grant it or `legacy_project_key_full_access`, read for its own project.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { LEGACY_PROJECT_KEY_SCOPES } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import { pickFlagDefinition, type FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LegacyProjectKeyScopeService } from "../legacy-project-key-scope.service.ts";

const PROJECT = { id: "project-1", organizationId: "org-1" };
const TARGET = { kind: "project", projectId: "project-1", organizationId: "org-1" };
const FULL_ACCESS = "legacy_project_key_full_access";

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
  "prompts:update",
  "traces:view",
  "scenarios:manage",
  "evaluations:manage",
  "datasets:view",
  "project:view",
  "project:update",
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

  describe("when it is asked a permission no scope flag grants", () => {
    /** @scenario "The full-access flag is read for the key's own project" */
    it("reads only the full-access flag for its project and organization", async () => {
      const off = scope({ enabled: [] });
      const on = scope({ enabled: [FULL_ACCESS] });

      await expect(
        off.service.holds({ project: PROJECT, permission: "organization:manage" }),
      ).resolves.toBe(false);
      await expect(
        on.service.holds({ project: PROJECT, permission: "organization:manage" }),
      ).resolves.toBe(true);
      expect(off.reads).toEqual([[FULL_ACCESS, TARGET]]);
    });
  });

  describe("when it is asked prompts:view", () => {
    /** @scenario "Only the scope flags that grant the asked permission are read" */
    it("reads the prompts-read flag, then full access, and no other scope flag", async () => {
      const off = scope({ enabled: [] });
      const on = scope({ enabled: ["legacy_project_key_prompts_read"] });

      await expect(
        off.service.holds({ project: PROJECT, permission: "prompts:view" }),
      ).resolves.toBe(false);
      await expect(
        on.service.holds({ project: PROJECT, permission: "prompts:view" }),
      ).resolves.toBe(true);
      expect(off.reads).toEqual([
        ["legacy_project_key_prompts_read", TARGET],
        [FULL_ACCESS, TARGET],
      ]);
      expect(on.reads).toEqual([["legacy_project_key_prompts_read", TARGET]]);
    });
  });

  describe("when its project is on no flag", () => {
    /** @scenario "A project on no flag stays ingestion-only" */
    it.each(BEYOND_INGESTION)("does not hold %s", async (permission) => {
      await expect(
        scope({ enabled: [] }).service.holds({ project: PROJECT, permission }),
      ).resolves.toBe(false);
    });
  });

  describe("when its project is on the full-access flag only", () => {
    /** @scenario "Full access holds every permission" */
    it.each(BEYOND_INGESTION)("holds %s", async (permission) => {
      await expect(
        scope({ enabled: [FULL_ACCESS] }).service.holds({ project: PROJECT, permission }),
      ).resolves.toBe(true);
    });
  });

  describe("when its project is on one scope flag", () => {
    it.each(Object.entries(LEGACY_PROJECT_KEY_SCOPES))(
      "%s holds exactly its own permissions",
      async (flag, granted) => {
        const { service } = scope({ enabled: [flag] });
        const asked: AuthzPermission[] = [...new Set([...BEYOND_INGESTION, ...granted])];

        for (const permission of asked) {
          await expect(service.holds({ project: PROJECT, permission })).resolves.toBe(
            (granted as readonly AuthzPermission[]).includes(permission),
          );
        }
      },
    );
  });

  describe("when a route asks it nothing", () => {
    /** @scenario "A legacy project key is refused a project route that asks no permission" */
    it("is refused with the ingestion-only code unless its project has full access", async () => {
      const everyScope = Object.keys(LEGACY_PROJECT_KEY_SCOPES);

      await expect(
        scope({ enabled: everyScope }).service.assertMayIdentify(PROJECT),
      ).rejects.toMatchObject({ code: "legacy_project_key_ingestion_only", httpStatus: 403 });
      await expect(
        scope({ enabled: [FULL_ACCESS] }).service.assertMayIdentify(PROJECT),
      ).resolves.toBe(undefined);
    });
  });
});

describe("the scope flag map", () => {
  /** @scenario "Every scope flag is a registered feature flag" */
  it("names only registered product flags that are off by default", () => {
    for (const flag of Object.keys(LEGACY_PROJECT_KEY_SCOPES)) {
      expect(pickFlagDefinition(flag)).toMatchObject({
        key: flag,
        scope: "PRODUCT",
        defaultValue: false,
      });
    }
  });
});
