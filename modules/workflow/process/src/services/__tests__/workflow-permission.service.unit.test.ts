import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { WorkflowPermissionService } from "../workflow-permission.service.ts";

describe("WorkflowPermissionService", () => {
  describe("given an API key that no user owns", () => {
    /** @scenario An evaluation run is judged against an API key's own bindings */
    it("asks the authz peer about the key at its project, with a null user", async () => {
      const hasApiKeyPermission = vi.fn(async () => true);
      const service = WorkflowPermissionService.create({
        authz: createApiFixture<AuthzApi>({ hasApiKeyPermission }, "AuthzApi"),
      });

      const permitted = await service.hasApiKeyPermission({
        apiKeyId: "key_1",
        userId: null,
        organizationId: "org_1",
        projectId: "project_1",
        teamId: "team_1",
        permission: "evaluations:view",
      });

      expect(permitted).toBe(true);
      expect(hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key_1",
        userId: null,
        organizationId: "org_1",
        scope: { type: "project", id: "project_1", teamId: "team_1" },
        permission: "evaluations:view",
      });
    });
  });
});
