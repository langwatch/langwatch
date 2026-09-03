/**
 * The remove-confirmation preview asks only when a scope is actually pending.
 *
 * These cases were `platform/app/src/pages/settings/__tests__/data-retention-preview.unit.test.ts`,
 * on the helper that moved into this package with the page.
 */

import { describe, expect, it } from "vitest";
import type { RetentionScopeGroup } from "../retention-grouping";
import { retentionRemovalPreviewQuery } from "../retention-removal-preview";

const group: RetentionScopeGroup = {
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  name: "Acme",
  byCategory: { traces: 91, scenarios: 91, experiments: 91 },
  rules: [],
};

describe("given the remove-confirmation dialog", () => {
  describe("when no scope is targeted", () => {
    it("is disabled, so nothing is asked for a dialog that is not open", () => {
      expect(retentionRemovalPreviewQuery("project-1", null)).toEqual({
        input: {
          projectId: "project-1",
          scope: { scopeType: "PROJECT", scopeId: "" },
        },
        options: { enabled: false },
      });
    });
  });

  describe("when a scope is pending removal", () => {
    it("targets that scope and enables the read", () => {
      expect(retentionRemovalPreviewQuery("project-1", group)).toEqual({
        input: {
          projectId: "project-1",
          scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        },
        options: { enabled: true },
      });
    });
  });
});
