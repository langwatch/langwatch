// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ScimService,
  type ScimListResponse,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import { describe, expect, it, vi } from "vitest";
import { ScimWebhookApi } from "../../api/scim-webhook/scim-webhook.api";
import { ScimDirectoryService } from "../scim-directory.service";
import { ScimGrantsService } from "../scim-grants.service";
import type { ScimDirectoryRepository } from "../scim-directory.service";
import { GrantsFake } from "../../__tests__/support/grants-fake";
import { scimPatchRequestSchema } from "@langwatch/enterprise-scim-contract";

function groupsRepository(): ScimDirectoryRepository {
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
  };
}
/**
 * The user the webhook finds when it looks `ada@example.com` up: the deactivate
 * event carries only a userName, so the id the fake answers here is the one the
 * assertion expects `deleteUser` to be called with.
 */
const scimUser: ScimUser = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: "user_1",
  userName: "ada@example.com",
  name: { givenName: "Ada", familyName: "Lovelace" },
  emails: [{ primary: true, value: "ada@example.com", type: "work" }],
  active: true,
  meta: {
    resourceType: "User",
    created: "2024-01-01T00:00:00.000Z",
    lastModified: "2024-01-02T00:00:00.000Z",
  },
};

/** The one-result listing the userName lookup answers with. */
const scimUserList: ScimListResponse<ScimUser> = {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults: 1,
  startIndex: 1,
  itemsPerPage: 1,
  Resources: [scimUser],
};

class ScimServiceFake extends ScimService {
  readonly tryFindOrganizationBySsoDomain = vi.fn(async () => ({ id: "org_1" }));
  readonly createUser: ScimService["createUser"] = vi.fn(async () => scimUser);
  readonly listUsers: ScimService["listUsers"] = vi.fn(async () => scimUserList);
  readonly deleteUser = vi.fn(async () => {});
  // `ScimService` grew this and the fake did not follow.
  readonly revokeTokensForConnection: ScimService["revokeTokensForConnection"] = vi.fn();
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
      // Parsed, because that is the shape `updateGroup` receives: the route
      // runs `scimPatchRequestSchema.safeParse(body)` and passes `parsed.data`.
      // The mixed case is the point — SCIM's `op` is case-insensitive and the
      // schema lowercases it in a `preprocess` — but handing the raw literal
      // straight to the service skipped the very step under test, and the
      // parsed type is lowercase-only so it could not typecheck either.
      patchRequest: scimPatchRequestSchema.parse({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "Add", path: "members", value: [{ value: "user_2" }] },
          { op: "REMOVE", path: "members", value: [{ value: "user_1" }] },
        ],
      }),
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
