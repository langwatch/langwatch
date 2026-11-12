/**
 * @vitest-environment node
 * @unit
 * Every legacy key door reads the full-access and enforced flags through one function each, so the
 * targeting shape is pinned here rather than at each door.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { FeatureFlagApi } from "../feature-flag.api.ts";
import {
  LEGACY_PROJECT_KEY_FULL_ACCESS_FLAG_KEY,
  LEGACY_PROJECT_KEY_SCOPE_ENFORCED_FLAG_KEY,
  legacyProjectKeyHasFullAccess,
  legacyProjectKeyScopeEnforced,
} from "../legacy-project-key.ts";

describe("legacyProjectKeyHasFullAccess", () => {
  describe("given a legacy key's project", () => {
    it("reads the full-access flag for that project and its organization", async () => {
      const isEnabled = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(true);

      const fullAccess = await legacyProjectKeyHasFullAccess({
        featureFlags: { isEnabled },
        project: { id: "project_1", organizationId: "org_1" },
      });

      expect(fullAccess).toBe(true);
      expect(isEnabled).toHaveBeenCalledWith(LEGACY_PROJECT_KEY_FULL_ACCESS_FLAG_KEY, {
        kind: "project",
        projectId: "project_1",
        organizationId: "org_1",
      });
    });
  });
});

describe("legacyProjectKeyScopeEnforced", () => {
  describe("given a legacy key's project", () => {
    it("reads the enforced flag for that project and its organization", async () => {
      const isEnabled = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(false);

      const enforced = await legacyProjectKeyScopeEnforced({
        featureFlags: { isEnabled },
        project: { id: "project_1", organizationId: "org_1" },
      });

      expect(enforced).toBe(false);
      expect(isEnabled).toHaveBeenCalledWith(LEGACY_PROJECT_KEY_SCOPE_ENFORCED_FLAG_KEY, {
        kind: "project",
        projectId: "project_1",
        organizationId: "org_1",
      });
    });
  });
});
