import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzPermission } from "@langwatch/authorization";
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type { GatewayPermissionScope, GatewayScopePermissions } from "../../app/gateway.members.ts";
import { VirtualKeyAuthorizationRepository } from "../../repositories/virtual-key-authorization.repository.ts";
import {
  type Scope,
  VirtualKeyAuthorizationService,
} from "../virtual-key-authorization.service.ts";

/** Spec: specs/ai-gateway/public-rest-api.feature, the create-but-not-manage key. */

const PROJECT: Scope = { scopeType: "PROJECT", scopeId: "proj_demo" };
const TEAM: Scope = { scopeType: "TEAM", scopeId: "team_demo" };
const OTHER_PROJECT: Scope = { scopeType: "PROJECT", scopeId: "proj_other" };

class ProjectsOnTeamDemo extends VirtualKeyAuthorizationRepository {
  async findProjectIdsForTeams() {
    return [];
  }
  async findTeamIdsInOrganization() {
    return [];
  }
  async findVirtualKeyScopes() {
    return null;
  }
  async findGuardrailIdsInProject() {
    return [];
  }
}

/** An API key holding exactly the named permissions, wherever it is asked. */
function keyHolding(held: readonly AuthzPermission[]) {
  const asked: { permission: AuthzPermission; scope: GatewayPermissionScope }[] = [];
  const permissions: GatewayScopePermissions = {
    sessionHolds: async () => false,
    apiKeyHolds: async ({ permission, scope }) => {
      asked.push({ permission, scope });
      return held.includes(permission);
    },
  };

  return {
    asked,
    ctx: {
      permissions,
      actor: {
        kind: "apiKey" as const,
        apiKeyId: "key_1",
        userId: "user_1",
        organizationId: "org_1",
      },
    },
  };
}

const service = VirtualKeyAuthorizationService.create({
  directory: new ProjectsOnTeamDemo(),
  organizations: createApiFixture<OrganizationApi>({
    getMember: async ({ userId }) => {
      throw new MemberNotFoundError(userId);
    },
    findMemberTeamIds: async () => [],
  }),
  projects: createApiFixture<ProjectApi>({
    findIdentity: async (id) => ({
      id,
      name: id,
      slug: id,
      teamId: "team_demo",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
    }),
    listIdsByOrganization: async () => [],
  }),
});

describe("assertActorCanCreateScopes", () => {
  describe("when the only scope is the caller's own project", () => {
    /** @scenario A key that can create but not manage mints a key for its own project */
    it("asks for virtualKeys:create there and nothing more", async () => {
      const { ctx, asked } = keyHolding(["virtualKeys:create"]);

      await expect(
        service.assertActorCanCreateScopes(ctx, {
          scopes: [PROJECT],
          callerProjectId: "proj_demo",
        }),
      ).resolves.toBeUndefined();
      expect(asked.map(({ permission }) => permission)).toEqual(["virtualKeys:create"]);
    });

    it("refuses naming virtualKeys:create when the caller lacks it", async () => {
      const { ctx } = keyHolding([]);

      await expect(
        service.assertActorCanCreateScopes(ctx, {
          scopes: [PROJECT],
          callerProjectId: "proj_demo",
        }),
      ).rejects.toMatchObject({
        code: "permission_denied",
        httpStatus: 403,
        meta: { permission: "virtualKeys:create", scopeType: "project" },
      });
    });
  });

  describe("when a scope reaches beyond the caller's own project", () => {
    /** @scenario A key that can create but not manage cannot mint above its project */
    it("requires virtualKeys:manage on a team scope", async () => {
      const { ctx } = keyHolding(["virtualKeys:create"]);

      await expect(
        service.assertActorCanCreateScopes(ctx, { scopes: [TEAM], callerProjectId: "proj_demo" }),
      ).rejects.toMatchObject({
        code: "permission_denied",
        meta: { permission: "virtualKeys:manage", scopeType: "team" },
      });
    });

    it("requires virtualKeys:manage on another project", async () => {
      const { ctx } = keyHolding(["virtualKeys:create"]);

      await expect(
        service.assertActorCanCreateScopes(ctx, {
          scopes: [OTHER_PROJECT],
          callerProjectId: "proj_demo",
        }),
      ).rejects.toMatchObject({
        code: "permission_denied",
        meta: { permission: "virtualKeys:manage", scopeType: "project" },
      });
    });

    it("requires virtualKeys:manage on every scope once there are several", async () => {
      const { ctx } = keyHolding(["virtualKeys:create"]);

      await expect(
        service.assertActorCanCreateScopes(ctx, {
          scopes: [PROJECT, OTHER_PROJECT],
          callerProjectId: "proj_demo",
        }),
      ).rejects.toMatchObject({
        code: "permission_denied",
        meta: { permission: "virtualKeys:manage", scopeType: "project" },
      });
    });
  });
});
