import { describe, expect, it, vi, beforeEach } from "vitest";
import { TeamUserRole } from "@prisma/client";
import { ScimGroupService } from "../scim-group.service";

const ORG_ID = "org-1";
const MAPPING_ID = "mapping-1";

function buildMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: MAPPING_ID,
    organizationId: ORG_ID,
    externalGroupId: "abc-123",
    externalGroupName: "Engineering",
    teamId: "team-1",
    role: TeamUserRole.MEMBER,
    customRoleId: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    ...overrides,
  };
}

function buildMembership(overrides: Record<string, unknown> = {}) {
  return {
    scimGroupMappingId: MAPPING_ID,
    userId: "user-1",
    createdAt: new Date(),
    user: { id: "user-1", email: "alice@acme.com", name: "Alice" },
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    scimGroupMapping: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    scimGroupMembership: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    teamUser: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
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
        const mapping = buildMapping();
        const memberships = [buildMembership()];

        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mapping);
        (prisma.scimGroupMembership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(memberships);

        const result = await service.getGroup({ externalScimId: MAPPING_ID, organizationId: ORG_ID });

        expect(result).toMatchObject({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          id: MAPPING_ID,
          displayName: "Engineering",
          members: [{ value: "user-1", display: "alice@acme.com" }],
        });
      });
    });

    describe("when group does not exist", () => {
      it("returns 404 error", async () => {
        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.getGroup({ externalScimId: "nonexistent", organizationId: ORG_ID });

        expect(result).toMatchObject({ status: "404" });
      });
    });
  });

  describe("listGroups()", () => {
    describe("when mapped groups exist", () => {
      it("returns list of SCIM Groups", async () => {
        const mapping = { ...buildMapping(), memberships: [buildMembership()] };

        (prisma.scimGroupMapping.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([mapping]);
        (prisma.scimGroupMapping.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

        const result = await service.listGroups({ organizationId: ORG_ID });

        expect(result.totalResults).toBe(1);
        expect(result.Resources).toHaveLength(1);
        expect(result.Resources[0]!.displayName).toBe("Engineering");
      });
    });
  });

  describe("deleteGroup()", () => {
    describe("when group exists with no memberships", () => {
      it("deletes the mapping and returns null", async () => {
        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(buildMapping());
        (prisma.scimGroupMembership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (prisma.scimGroupMembership.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.scimGroupMapping.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const result = await service.deleteGroup({ externalScimId: MAPPING_ID, organizationId: ORG_ID });

        expect(result).toBeNull();
      });
    });

    describe("when group does not exist", () => {
      it("returns 404 error", async () => {
        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.deleteGroup({ externalScimId: "nonexistent", organizationId: ORG_ID });

        expect(result).toMatchObject({ status: "404" });
      });
    });
  });

  describe("createGroup()", () => {
    describe("when no existing mapping with same name", () => {
      it("creates an unmapped ScimGroupMapping", async () => {
        const newMapping = buildMapping({ teamId: null, role: null });

        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (prisma.scimGroupMapping.create as ReturnType<typeof vi.fn>).mockResolvedValue(newMapping);

        const result = await service.createGroup({
          organizationId: ORG_ID,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Engineering",
          },
        });

        expect(result).toMatchObject({ displayName: "Engineering" });
      });
    });

    describe("when mapping with same name already exists", () => {
      it("returns 409 conflict", async () => {
        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(buildMapping());

        const result = await service.createGroup({
          organizationId: ORG_ID,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Engineering",
          },
        });

        expect(result).toMatchObject({ status: "409" });
      });
    });
  });

  describe("updateGroup() via PATCH", () => {
    describe("when adding members to a mapped group", () => {
      it("creates ScimGroupMembership and TeamUser", async () => {
        const mapping = buildMapping();
        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mapping);
        (prisma.organizationUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { userId: "user-2", organizationId: ORG_ID },
        ]);
        (prisma.scimGroupMembership.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.teamUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (prisma.teamUser.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (prisma.scimGroupMembership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          buildMembership(),
          buildMembership({ userId: "user-2", user: { id: "user-2", email: "bob@acme.com", name: "Bob" } }),
        ]);

        const result = await service.updateGroup({
          externalScimId: MAPPING_ID,
          organizationId: ORG_ID,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: "user-2" }] },
            ],
          },
        });

        expect(result).toMatchObject({
          displayName: "Engineering",
          members: expect.arrayContaining([
            expect.objectContaining({ value: "user-2" }),
          ]),
        });
      });
    });

    describe("when adding members to an unmapped group", () => {
      it("returns success without creating TeamUser records", async () => {
        const unmappedMapping = buildMapping({ teamId: null, role: null });
        (prisma.scimGroupMapping.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(unmappedMapping);
        (prisma.scimGroupMembership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await service.updateGroup({
          externalScimId: MAPPING_ID,
          organizationId: ORG_ID,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "add", path: "members", value: [{ value: "user-1" }] },
            ],
          },
        });

        expect(result).toMatchObject({ displayName: "Engineering", members: [] });
      });
    });
  });
});
