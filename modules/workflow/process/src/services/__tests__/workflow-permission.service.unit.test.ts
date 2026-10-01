import { principalOfCredential } from "@langwatch/api/rest";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { WorkflowPermissionService } from "../workflow-permission.service.ts";

const project = {
  id: "project_1",
  name: "Project",
  slug: "project",
  teamId: "team_1",
  organizationId: "org_1",
  isPersonal: false,
  ownerUserId: null,
};
const key = {
  type: "apiKey",
  apiKeyId: "key_1",
  userId: "user_1",
  organizationId: "org_1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project,
} satisfies RestResolvedProjectCredential;
const projectScope = {
  type: "project",
  id: "project_1",
  teamId: "team_1",
  organizationId: "org_1",
};

/** The evaluation-run ceiling as the workflow door asks it: the credential's principal. */
async function ceilingAskedOf(credential: RestResolvedProjectCredential) {
  const can = vi.fn<AuthzApi["can"]>(async () => true);
  const service = WorkflowPermissionService.create({
    authz: createApiFixture<AuthzApi>({ can }, "AuthzApi"),
  });
  const principal = principalOfCredential(credential);
  if (principal === null) throw new Error("a legacy API key is asked no question");

  expect(await service.holds({ principal, project, permission: "evaluations:view" })).toBe(true);
  return can;
}

describe("WorkflowPermissionService.holds", () => {
  describe("given a project key", () => {
    /** @scenario An evaluation run is judged against an API key's own bindings */
    it("asks authz about the key principal at its project", async () => {
      const can = await ceilingAskedOf(key);

      expect(can).toHaveBeenCalledWith({
        principal: { type: "apiKey", id: "key_1" },
        permission: "evaluations:view",
        scope: projectScope,
      });
    });
  });

  describe("given a project-bound access token", () => {
    /** @scenario An evaluation run started with a project-bound access token is judged as its person */
    it("asks authz about the user principal, never a key row", async () => {
      const can = await ceilingAskedOf({
        type: "cliAccessToken",
        userId: "user_1",
        organizationId: "org_1",
        project,
      });

      expect(can).toHaveBeenCalledWith({
        principal: { type: "user", id: "user_1" },
        permission: "evaluations:view",
        scope: projectScope,
      });
    });
  });
});
