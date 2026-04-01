/**
 * @vitest-environment node
 *
 * Integration tests for ScimGroupService using ScimGroupMapping.
 * Covers the SCIM group ingestion scenarios from the feature spec.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../db";
import { ScimGroupService } from "./scim-group.service";

const TEST_PREFIX = `scim-group-test-${nanoid(6)}`;

describe("ScimGroupService integration", () => {
  let service: ScimGroupService;
  let organizationId: string;
  let teamId: string;
  let userId1: string;
  let userId2: string;
  let userId3: string;

  beforeAll(async () => {
    service = ScimGroupService.create(prisma);

    // Create org
    const org = await prisma.organization.create({
      data: {
        name: `${TEST_PREFIX}-org`,
        slug: `${TEST_PREFIX}-org`,
      },
    });
    organizationId = org.id;

    // Create team
    const team = await prisma.team.create({
      data: {
        name: `${TEST_PREFIX}-team-dev`,
        slug: `${TEST_PREFIX}-team-dev`,
        organizationId,
      },
    });
    teamId = team.id;

    // Create users
    const user1 = await prisma.user.create({
      data: { name: "User 1", email: `${TEST_PREFIX}-u1@test.com` },
    });
    userId1 = user1.id;

    const user2 = await prisma.user.create({
      data: { name: "User 2", email: `${TEST_PREFIX}-u2@test.com` },
    });
    userId2 = user2.id;

    const user3 = await prisma.user.create({
      data: { name: "User 3", email: `${TEST_PREFIX}-u3@test.com` },
    });
    userId3 = user3.id;

    // Add users to organization
    await prisma.organizationUser.createMany({
      data: [
        { userId: userId1, organizationId, role: "MEMBER" },
        { userId: userId2, organizationId, role: "MEMBER" },
        { userId: userId3, organizationId, role: "MEMBER" },
      ],
    });
  });

  afterEach(async () => {
    // Clean up mappings and memberships between tests
    await prisma.scimGroupMembership.deleteMany({
      where: { scimGroupMapping: { organizationId } },
    });
    await prisma.scimGroupMapping.deleteMany({ where: { organizationId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
  });

  afterAll(async () => {
    // Clean up all test data
    await prisma.scimGroupMembership.deleteMany({
      where: { scimGroupMapping: { organizationId } },
    });
    await prisma.scimGroupMapping.deleteMany({ where: { organizationId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [userId1, userId2, userId3] } },
    });
  });

  describe("createGroup()", () => {
    describe("when Entra pushes a new group via SCIM", () => {
      it("stores it as an unmapped ScimGroupMapping", async () => {
        const result = await service.createGroup({
          organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "clienta-dev-ro",
          },
        });

        expect(result).toMatchObject({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "clienta-dev-ro",
          members: [],
        });
        expect("status" in result).toBe(false);

        // Verify in DB
        const mapping = await prisma.scimGroupMapping.findFirst({
          where: { organizationId, externalGroupName: "clienta-dev-ro" },
        });
        expect(mapping).not.toBeNull();
        expect(mapping!.teamId).toBeNull();
        expect(mapping!.role).toBeNull();
      });
    });

    describe("when Entra pushes a duplicate group", () => {
      it("returns 409 conflict", async () => {
        // Create the first mapping
        await service.createGroup({
          organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "duplicate-group",
          },
        });

        // Attempt to create duplicate
        const result = await service.createGroup({
          organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "duplicate-group",
          },
        });

        expect(result).toMatchObject({ status: "409" });
      });
    });
  });

  describe("updateGroup() via PATCH", () => {
    describe("when Entra pushes members for an unmapped group", () => {
      it("returns success without creating TeamUser or ScimGroupMembership records", async () => {
        // Create unmapped mapping
        const createResult = await service.createGroup({
          organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "unmapped-group",
          },
        });
        expect("status" in createResult).toBe(false);
        const mappingId = "id" in createResult ? createResult.id : "";

        // Add member to unmapped group
        const result = await service.updateGroup({
          externalScimId: mappingId,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        expect("status" in result).toBe(false);

        // Verify no TeamUser created
        const teamUsers = await prisma.teamUser.findMany({
          where: { teamId, userId: userId1 },
        });
        expect(teamUsers).toHaveLength(0);

        // Verify no ScimGroupMembership created
        const memberships = await prisma.scimGroupMembership.findMany({
          where: { scimGroupMappingId: mappingId },
        });
        expect(memberships).toHaveLength(0);
      });
    });

    describe("when Entra pushes members for a mapped group", () => {
      it("creates TeamUser with correct role and ScimGroupMembership", async () => {
        // Create mapping and manually link it to a team with VIEWER role
        const mapping = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `mapped-group-${nanoid(4)}`,
            externalGroupName: "mapped-group",
            teamId,
            role: TeamUserRole.VIEWER,
          },
        });

        // Add member via PATCH
        const result = await service.updateGroup({
          externalScimId: mapping.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        expect("status" in result).toBe(false);

        // Verify TeamUser created with VIEWER role
        const teamUser = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(teamUser).not.toBeNull();
        expect(teamUser!.role).toBe(TeamUserRole.VIEWER);

        // Verify ScimGroupMembership created
        const membership = await prisma.scimGroupMembership.findUnique({
          where: {
            scimGroupMappingId_userId: {
              scimGroupMappingId: mapping.id,
              userId: userId1,
            },
          },
        });
        expect(membership).not.toBeNull();
      });
    });

    describe("when Entra removes a member from a mapped group", () => {
      it("removes TeamUser if only mapping and deletes ScimGroupMembership", async () => {
        // Create mapping with team
        const mapping = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `remove-test-${nanoid(4)}`,
            externalGroupName: "remove-test",
            teamId,
            role: TeamUserRole.VIEWER,
          },
        });

        // Add user via service
        await service.updateGroup({
          externalScimId: mapping.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        // Verify user is in team
        const teamUserBefore = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(teamUserBefore).not.toBeNull();

        // Remove user via PATCH
        await service.updateGroup({
          externalScimId: mapping.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "remove", path: `members[value eq "${userId1}"]` },
            ],
          },
        });

        // Verify TeamUser removed
        const teamUserAfter = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(teamUserAfter).toBeNull();

        // Verify ScimGroupMembership removed
        const membership = await prisma.scimGroupMembership.findUnique({
          where: {
            scimGroupMappingId_userId: {
              scimGroupMappingId: mapping.id,
              userId: userId1,
            },
          },
        });
        expect(membership).toBeNull();
      });
    });
  });

  describe("replaceGroup() via PUT", () => {
    describe("when Entra replaces full member list on a mapped group", () => {
      it("adds and removes members correctly", async () => {
        // Create mapping
        const mapping = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `replace-test-${nanoid(4)}`,
            externalGroupName: "replace-test",
            teamId,
            role: TeamUserRole.MEMBER,
          },
        });

        // Add user-1 and user-2 via service
        await service.updateGroup({
          externalScimId: mapping.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              {
                op: "add",
                path: "members",
                value: [{ value: userId1 }, { value: userId2 }],
              },
            ],
          },
        });

        // Replace with user-2 and user-3
        const result = await service.replaceGroup({
          externalScimId: mapping.id,
          organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "replace-test",
            members: [{ value: userId2 }, { value: userId3 }],
          },
        });

        expect("status" in result).toBe(false);

        // user-1 removed from team
        const tu1 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(tu1).toBeNull();

        // user-2 still in team
        const tu2 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId2, teamId } },
        });
        expect(tu2).not.toBeNull();
        expect(tu2!.role).toBe(TeamUserRole.MEMBER);

        // user-3 added to team
        const tu3 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId3, teamId } },
        });
        expect(tu3).not.toBeNull();
        expect(tu3!.role).toBe(TeamUserRole.MEMBER);

        // ScimGroupMembership updated
        const memberships = await prisma.scimGroupMembership.findMany({
          where: { scimGroupMappingId: mapping.id },
        });
        const memberUserIds = memberships.map((m) => m.userId).sort();
        expect(memberUserIds).toEqual([userId2, userId3].sort());
      });
    });
  });

  describe("deleteGroup()", () => {
    describe("when Entra deletes a SCIM group", () => {
      it("removes mapping, memberships, and TeamUser", async () => {
        // Create mapping
        const mapping = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `delete-test-${nanoid(4)}`,
            externalGroupName: "delete-test",
            teamId,
            role: TeamUserRole.VIEWER,
          },
        });

        // Add user
        await service.updateGroup({
          externalScimId: mapping.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        // Delete group
        const result = await service.deleteGroup({
          externalScimId: mapping.id,
          organizationId,
        });

        expect(result).toBeNull();

        // Mapping removed
        const deletedMapping = await prisma.scimGroupMapping.findUnique({
          where: { id: mapping.id },
        });
        expect(deletedMapping).toBeNull();

        // ScimGroupMembership removed (cascade)
        const memberships = await prisma.scimGroupMembership.findMany({
          where: { scimGroupMappingId: mapping.id },
        });
        expect(memberships).toHaveLength(0);

        // TeamUser removed
        const teamUser = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(teamUser).toBeNull();
      });
    });

    describe("when deleting preserves members from other mappings", () => {
      it("keeps TeamUser and recalculates role from remaining mapping", async () => {
        // Create two mappings to the same team
        const mappingViewer = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `multi-del-viewer-${nanoid(4)}`,
            externalGroupName: "viewer-group",
            teamId,
            role: TeamUserRole.VIEWER,
          },
        });

        const mappingAdmin = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `multi-del-admin-${nanoid(4)}`,
            externalGroupName: "admin-group",
            teamId,
            role: TeamUserRole.ADMIN,
          },
        });

        // Add user-1 to both groups
        await service.updateGroup({
          externalScimId: mappingViewer.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        await service.updateGroup({
          externalScimId: mappingAdmin.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        // Verify user has ADMIN (highest) role
        const teamUserBefore = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(teamUserBefore!.role).toBe(TeamUserRole.ADMIN);

        // Delete the viewer mapping
        await service.deleteGroup({
          externalScimId: mappingViewer.id,
          organizationId,
        });

        // User still in team
        const teamUserAfter = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: userId1, teamId } },
        });
        expect(teamUserAfter).not.toBeNull();

        // Role retained as ADMIN from remaining mapping
        expect(teamUserAfter!.role).toBe(TeamUserRole.ADMIN);

        // ScimGroupMembership for viewer mapping removed
        const viewerMembership = await prisma.scimGroupMembership.findMany({
          where: { scimGroupMappingId: mappingViewer.id },
        });
        expect(viewerMembership).toHaveLength(0);

        // ScimGroupMembership for admin mapping remains
        const adminMembership = await prisma.scimGroupMembership.findUnique({
          where: {
            scimGroupMappingId_userId: {
              scimGroupMappingId: mappingAdmin.id,
              userId: userId1,
            },
          },
        });
        expect(adminMembership).not.toBeNull();
      });
    });
  });

  describe("listGroups()", () => {
    describe("when ScimGroupMappings exist", () => {
      it("returns mappings as SCIM Groups", async () => {
        await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `list-1-${nanoid(4)}`,
            externalGroupName: "group-1",
          },
        });
        await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `list-2-${nanoid(4)}`,
            externalGroupName: "group-2",
            teamId,
            role: TeamUserRole.MEMBER,
          },
        });

        const result = await service.listGroups({ organizationId });

        expect(result.totalResults).toBe(2);
        expect(result.Resources).toHaveLength(2);
        const names = result.Resources.map((r) => r.displayName).sort();
        expect(names).toEqual(["group-1", "group-2"]);
      });
    });
  });

  describe("getGroup()", () => {
    describe("when mapping exists with memberships", () => {
      it("returns SCIM Group with member data", async () => {
        const mapping = await prisma.scimGroupMapping.create({
          data: {
            organizationId,
            externalGroupId: `get-test-${nanoid(4)}`,
            externalGroupName: "get-test-group",
            teamId,
            role: TeamUserRole.VIEWER,
          },
        });

        // Add member via service
        await service.updateGroup({
          externalScimId: mapping.id,
          organizationId,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: userId1 }] },
            ],
          },
        });

        const result = await service.getGroup({
          externalScimId: mapping.id,
          organizationId,
        });

        expect("status" in result).toBe(false);
        if (!("status" in result)) {
          expect(result.displayName).toBe("get-test-group");
          expect(result.members).toHaveLength(1);
          expect(result.members[0]!.value).toBe(userId1);
        }
      });
    });
  });
});
