import { describe, expect, it, vi, beforeEach } from "vitest";
import { TeamUserRole } from "@prisma/client";
import { ScimGroupService } from "../scim-group.service";

const ORG_ID = "org-1";
const TEAM_ID = "team-1";
const SCIM_ID = "scim-group-1";

function buildTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    name: "Engineering",
    slug: "engineering",
    organizationId: ORG_ID,
    externalScimId: SCIM_ID,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function buildTeamUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    teamId: TEAM_ID,
    role: TeamUserRole.MEMBER,
    assignedRoleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: "user-1", email: "alice@acme.com", name: "Alice" },
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    team: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    teamUser: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    organizationUser: {
      findMany: vi.fn(),
    },
  } as unknown as Parameters<typeof ScimGroupService.create>[0];
}

describe("ScimGroupService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ScimGroupService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = ScimGroupService.create(prisma);
  });

  describe("getGroup()", () => {
    describe("when group exists", () => {
      it("returns SCIM Group representation", async () => {
        const team = buildTeam();
        const members = [buildTeamUser()];

        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(team);
        (prisma.teamUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(members);

        const result = await service.getGroup({ externalScimId: SCIM_ID, organizationId: ORG_ID });

        expect(result).toMatchObject({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          id: SCIM_ID,
          displayName: "Engineering",
          members: [{ value: "user-1", display: "alice@acme.com" }],
        });
      });
    });

    describe("when group does not exist", () => {
      it("returns 404 error", async () => {
        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.getGroup({ externalScimId: "nonexistent", organizationId: ORG_ID });

        expect(result).toMatchObject({ status: "404" });
      });
    });
  });

  describe("listGroups()", () => {
    describe("when mapped groups exist", () => {
      it("returns list of SCIM Groups", async () => {
        const team = { ...buildTeam(), members: [buildTeamUser()] };

        (prisma.team.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([team]);
        (prisma.team.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

        const result = await service.listGroups({ organizationId: ORG_ID });

        expect(result.totalResults).toBe(1);
        expect(result.Resources).toHaveLength(1);
        expect(result.Resources[0]!.displayName).toBe("Engineering");
      });
    });
  });

  describe("deleteGroup()", () => {
    describe("when group exists", () => {
      it("unlinks the team without deleting it", async () => {
        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(buildTeam());
        (prisma.team.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const result = await service.deleteGroup({ externalScimId: SCIM_ID, organizationId: ORG_ID });

        expect(result).toBeNull();
        expect(prisma.team.update).toHaveBeenCalledWith({
          where: { id: TEAM_ID },
          data: { externalScimId: null },
        });
      });
    });

    describe("when group does not exist", () => {
      it("returns 404 error", async () => {
        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.deleteGroup({ externalScimId: "nonexistent", organizationId: ORG_ID });

        expect(result).toMatchObject({ status: "404" });
      });
    });
  });

  describe("updateGroup() via PATCH", () => {
    describe("when adding members", () => {
      it("adds members as MEMBER role", async () => {
        const team = buildTeam();
        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(team);
        (prisma.organizationUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { userId: "user-2", organizationId: ORG_ID },
        ]);
        (prisma.teamUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (prisma.teamUser.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.teamUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          buildTeamUser(),
          buildTeamUser({ userId: "user-2", user: { id: "user-2", email: "bob@acme.com", name: "Bob" } }),
        ]);

        const result = await service.updateGroup({
          externalScimId: SCIM_ID,
          organizationId: ORG_ID,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: "user-2" }] },
            ],
          },
        });

        expect(prisma.teamUser.create).toHaveBeenCalledWith({
          data: { userId: "user-2", teamId: TEAM_ID, role: TeamUserRole.MEMBER },
        });
        expect(result).toMatchObject({ displayName: "Engineering" });
      });
    });

    describe("when removing members", () => {
      it("removes non-admin members", async () => {
        const team = buildTeam();
        const member = buildTeamUser({ userId: "user-2", role: TeamUserRole.MEMBER });

        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(team);
        (prisma.teamUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(member);
        (prisma.teamUser.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.teamUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([buildTeamUser()]);

        await service.updateGroup({
          externalScimId: SCIM_ID,
          organizationId: ORG_ID,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "remove", path: 'members[value eq "user-2"]' },
            ],
          },
        });

        expect(prisma.teamUser.delete).toHaveBeenCalledWith({
          where: { userId_teamId: { userId: "user-2", teamId: TEAM_ID } },
        });
      });

      it("protects the last admin from removal", async () => {
        const team = buildTeam();
        const adminMember = buildTeamUser({ userId: "admin-1", role: TeamUserRole.ADMIN });

        (prisma.team.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(team);
        (prisma.teamUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(adminMember);
        (prisma.teamUser.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
        (prisma.teamUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([adminMember]);

        await service.updateGroup({
          externalScimId: SCIM_ID,
          organizationId: ORG_ID,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "remove", path: 'members[value eq "admin-1"]' },
            ],
          },
        });

        expect(prisma.teamUser.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe("createGroup()", () => {
    describe("when matching unmapped team exists", () => {
      it("links the team and adds members", async () => {
        const unmappedTeam = buildTeam({ externalScimId: null });

        // First findFirst: check for existing mapped group with same name
        // Second findFirst: find unmapped team
        // Third findFirst: findTeamByScimId in addMembersToTeam (not called in this path)
        (prisma.team.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(null) // no existing mapped group
          .mockResolvedValueOnce(unmappedTeam); // found unmapped team
        (prisma.team.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.organizationUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { userId: "user-1", organizationId: ORG_ID },
        ]);
        (prisma.teamUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (prisma.teamUser.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.teamUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([buildTeamUser()]);

        const result = await service.createGroup({
          organizationId: ORG_ID,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Engineering",
            members: [{ value: "user-1" }],
          },
        });

        expect(prisma.team.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: TEAM_ID },
            data: { externalScimId: TEAM_ID },
          })
        );
        expect(result).toMatchObject({ displayName: "Engineering" });
      });
    });

    describe("when no matching team exists", () => {
      it("returns 404 error", async () => {
        (prisma.team.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);

        const result = await service.createGroup({
          organizationId: ORG_ID,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Nonexistent",
          },
        });

        expect(result).toMatchObject({ status: "404" });
      });
    });
  });
});
