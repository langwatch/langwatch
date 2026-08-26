// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { ScimService } from "@langwatch/enterprise-scim-contract";
import { AuthzGrantsService } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { ScimWebhookApi } from "../src/api/scim-webhook/scim-webhook.api";
import { ScimDirectoryService } from "../src/services/scim-directory.service";
import { ScimGrantsService } from "../src/services/scim-grants.service";
import type { ScimRepositoryPort } from "../src/ports/scim-repository.port";

function groupsRepository(): ScimRepositoryPort {
  return {
    listGroupMemberIds: vi.fn(async () => ["user_1"]),
    tryFindGroup: vi.fn(async () => ({
      id: "group_1",
      organizationId: "org_1",
      name: "Provisioned",
      slug: "provisioned",
      scimSource: "scim",
      externalId: "external_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async () => undefined),
    listRoleBindings: vi.fn(async () => []),
    groupSlugExists: vi.fn(async () => false),
    listGroups: vi.fn(async () => ({ rows: [], total: 0 })),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    listGroupMembers: vi.fn(async () => []),
  } as ScimRepositoryPort;
}
class GrantsFake extends AuthzGrantsService {
  readonly attach = vi.fn();
  readonly update = vi.fn();
  readonly revoke = vi.fn();
  readonly replace = vi.fn();
  readonly offboard = vi.fn();
  readonly attachBindings = vi.fn(async () => []);
  readonly attachResourceGrant = vi.fn();
  readonly revokeResourceGrants = vi.fn();
  readonly changeBindingRole = vi.fn();
  readonly revokeBindings = vi.fn(async () => []);
  readonly revokeBindingsWhere = vi.fn();
  readonly offboardMember = vi.fn();
  readonly defineRole = vi.fn();
  readonly deleteRole = vi.fn();
}

class ScimServiceFake extends ScimService {
  readonly tryFindOrganizationBySsoDomain = vi.fn(async () => ({ id: "org_1" }));
  readonly createUser = vi.fn(async () => ({}));
  readonly listUsers = vi.fn(async () => ({ Resources: [{ id: "user_1" }] }));
  readonly deleteUser = vi.fn(async () => {});
  readonly generateToken: ScimService["generateToken"] = vi.fn();
  readonly listTokens: ScimService["listTokens"] = vi.fn();
  readonly revokeToken: ScimService["revokeToken"] = vi.fn();
  readonly verifyToken: ScimService["verifyToken"] = vi.fn();
  readonly getUser: ScimService["getUser"] = vi.fn();
  readonly replaceUser: ScimService["replaceUser"] = vi.fn();
  readonly updateUser: ScimService["updateUser"] = vi.fn();
  readonly listGroups: ScimService["listGroups"] = vi.fn();
  readonly getGroup: ScimService["getGroup"] = vi.fn();
  readonly createGroup: ScimService["createGroup"] = vi.fn();
  readonly replaceGroup: ScimService["replaceGroup"] = vi.fn();
  readonly updateGroup: ScimService["updateGroup"] = vi.fn();
  readonly deleteGroup: ScimService["deleteGroup"] = vi.fn();
}

describe("SCIM characterization: group PATCH membership and operation casing", () => {
  it("accepts case-insensitive add/remove operations and changes only the membership delta", async () => {
    const repo = groupsRepository();
    const grants = new GrantsFake();
    const groups = ScimDirectoryService.create({
      prisma: repo,
      grants: ScimGrantsService.create({ repository: repo, grants }),
    });
    await groups.updateGroup({
      organizationId: "org_1",
      externalScimId: "external_1",
      patchRequest: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "Add", path: "members", value: [{ value: "user_2" }] },
          { op: "REMOVE", path: "members", value: [{ value: "user_1" }] },
        ],
      },
    });
    expect(repo.addGroupMember).toHaveBeenCalledWith({
      groupId: "group_1",
      organizationId: "org_1",
      userId: "user_2",
    });
    expect(repo.removeGroupMembers).toHaveBeenCalledWith({
      groupId: "group_1",
      userIds: ["user_1"],
    });
  });
});

describe("SCIM characterization: Auth0 webhook", () => {
  it("parses create/deactivate events in Enterprise and leaves the app mount transport-only", async () => {
    const service = new ScimServiceFake();
    await ScimWebhookApi.create().handle({
      service,
      events: [
        {
          type: "sscim",
          data: {
            description: "Create user",
            details: {
              body: {
                userName: "ada@example.com",
                name: { givenName: "Ada", familyName: "Lovelace" },
              },
            },
          },
        },
        {
          type: "sscim",
          data: {
            description: "Deactivate user",
            details: { userName: "ada@example.com" },
          },
        },
      ],
    });
    expect(service.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        request: expect.objectContaining({ userName: "ada@example.com" }),
      }),
    );
    expect(service.deleteUser).toHaveBeenCalledWith({
      organizationId: "org_1",
      id: "user_1",
    });
  });
});
