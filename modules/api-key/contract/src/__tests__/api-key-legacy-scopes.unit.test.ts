/**
 * The span attributes a legacy project key request beyond ingestion records.
 * Spec: modules/auth/specs/legacy-project-key-scope.feature
 */
import { describe, expect, it } from "vitest";

import {
  legacyProjectKeyUseSpanAttributes,
  type LegacyProjectKeyUse,
} from "../api-key.legacy-scopes.ts";

const use: LegacyProjectKeyUse = {
  projectId: "project-acme",
  organizationId: "org-acme",
  route: "GET /api/prompts/:id",
  permission: "prompts:view",
  routeScopes: ["legacy_project_key_prompts_read"],
};

const useFields = {
  "langwatch.legacy_project_key.project_id": "project-acme",
  "langwatch.legacy_project_key.organization_id": "org-acme",
  "langwatch.legacy_project_key.route": "GET /api/prompts/:id",
  "langwatch.legacy_project_key.permission": "prompts:view",
  "langwatch.legacy_project_key.route_scopes": ["legacy_project_key_prompts_read"],
};

describe("legacyProjectKeyUseSpanAttributes", () => {
  describe("given a use outside the key's scopes", () => {
    /** @scenario "The request's span records the use and its decision" */
    it("records whether the project enforced it, and no granting flag", () => {
      const attributes = legacyProjectKeyUseSpanAttributes({
        use,
        decision: { outsideScope: true, enforced: true },
      });

      expect(attributes).toEqual({
        ...useFields,
        "langwatch.legacy_project_key.outside_scope": true,
        "langwatch.legacy_project_key.enforced": true,
      });
    });
  });

  describe("given a use a scope flag granted", () => {
    /** @scenario "The request's span records the use and its decision" */
    it("records the flag, and no enforced field", () => {
      const attributes = legacyProjectKeyUseSpanAttributes({
        use,
        decision: { outsideScope: false, grantedBy: "legacy_project_key_prompts_read" },
      });

      expect(attributes).toEqual({
        ...useFields,
        "langwatch.legacy_project_key.outside_scope": false,
        "langwatch.legacy_project_key.granted_by": "legacy_project_key_prompts_read",
      });
    });
  });

  describe("given a route that asks no permission", () => {
    /** @scenario "The request's span records the use and its decision" */
    it("records the permission as none", () => {
      const attributes = legacyProjectKeyUseSpanAttributes({
        use: { ...use, permission: null },
        decision: { outsideScope: true, enforced: false },
      });

      expect(attributes["langwatch.legacy_project_key.permission"]).toBe("none");
      expect(attributes["langwatch.legacy_project_key.enforced"]).toBe(false);
    });
  });
});
